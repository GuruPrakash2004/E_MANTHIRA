"""
Optional runtime override for DB connection settings, layered on top of
`.env`. Lets the "Database Settings" panel (reachable before login, since no
DB connection exists yet to gate it behind) change which SQL Server this
backend talks to without a developer editing `.env` and restarting the
process — the DB server's IP changed repeatedly during this project's
development and each time required exactly that manual fix.

Deliberate, scoped exception to CLAUDE.md rule 7 ("secrets only in .env") —
this override file (git-ignored, see .gitignore) is the one other place in
the app that holds a DB password, because `.env` can't be safely rewritten
from inside a running process without a restart, and this is required to
work without one. Nothing else in the app reads this file directly; only
`app.core.config.get_settings()` goes through it.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_OVERRIDE_PATH = Path(__file__).resolve().parent.parent.parent / "runtime_db_settings.json"

OVERRIDABLE_FIELDS = {
    "db_engine", "db_driver_odbc", "db_server", "db_port",
    "db_name", "db_user", "db_password", "db_trust_cert",
}


def load_override() -> dict[str, Any]:
    if not _OVERRIDE_PATH.exists():
        return {}
    try:
        data = json.loads(_OVERRIDE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return {k: v for k, v in data.items() if k in OVERRIDABLE_FIELDS}


def save_override(values: dict[str, Any]) -> None:
    # Replace, don't merge: the saved target is exactly what was submitted
    # (blank port/password included), never blended with older saved values.
    current = {k: v for k, v in values.items() if k in OVERRIDABLE_FIELDS}
    _OVERRIDE_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")


def effective_fields() -> dict[str, Any]:
    """Non-secret view of the currently-active settings, for the GET endpoint."""
    from app.core.config import get_settings

    s = get_settings()
    return {
        "db_engine": s.db_engine,
        "db_driver_odbc": s.db_driver_odbc,
        "db_server": s.db_server,
        "db_port": s.db_port,
        "db_name": s.db_name,
        "db_user": s.db_user,
        "db_trust_cert": s.db_trust_cert,
        "password_set": bool(s.db_password),
    }


def build_candidate(values: dict[str, Any]):
    """A Settings instance built from exactly the submitted values (over bare
    .env defaults for fields not submitted) — the previously saved override is
    deliberately NOT layered in, so a test uses only what was typed.
    WITHOUT persisting anything — used to test-connect before save."""
    from app.core.config import Settings

    # _env_file=None: ignore .env too, so nothing saved can bleed into a fresh entry.
    base = Settings(_env_file=None)
    given = {k: v for k, v in values.items() if k in OVERRIDABLE_FIELDS}
    given = {k: ("" if v is None and k != "db_port" else v) for k, v in given.items()}
    return base.model_copy(update=given)


def apply_and_reconnect(values: dict[str, Any]) -> tuple[bool, str]:
    """
    Test the proposed settings first; only persist + swap the live engine if
    the test connection succeeds. Never brick a working connection with a
    bad edit (same spirit as CLAUDE.md's "never break" rule).
    """
    from app.core.config import get_settings
    from app.core.db import reset_engine, test_connection_for
    from app.core.audit import ensure_schema
    from app.print.print_prefs import ensure_schema as ensure_print_prefs_schema

    values = {k: v for k, v in values.items() if k in OVERRIDABLE_FIELDS}
    candidate = build_candidate(values)
    ok, detail = test_connection_for(candidate)
    if not ok:
        return False, detail

    save_override(values)
    get_settings.cache_clear()
    reset_engine()

    # Best-effort: (re-)create the Web* tables on the newly-connected DB if
    # they don't exist yet. Non-fatal — the reconnect itself already succeeded.
    try:
        from app.core.db import with_transaction

        with with_transaction() as conn:
            ensure_schema(conn)
            ensure_print_prefs_schema(conn)
    except Exception as exc:  # noqa: BLE001
        return True, f"{detail} (warning: schema check failed: {exc})"

    return True, detail
