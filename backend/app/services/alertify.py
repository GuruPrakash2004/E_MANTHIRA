"""
Alertify integration: the temple software creates reminders in Alertify's own database (`alertglobe`, table `MstAlert`).

Nothing in the temple database changes. Alertify's server details are NOT temple data, so they live in a git-ignored file
(`backend/alertify_settings.json`, same idea as `runtime_db_settings.json`), with `.env` (`ALERTIFY_DB_*`) as the fallback.
An ADMIN edits them in Temple Settings > Global Settings > Alertify: server, port, database, user, password, the default alert time and the on / off switch. The password is never sent to the browser
(`password_set` only); leaving the password box blank when saving keeps the saved one.

Saving connection details tests the connection first; a wrong password can never replace a working one.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from sqlalchemy.engine import Engine

from app.core.config import Settings, get_settings

log = logging.getLogger(__name__)

_PATH = Path(__file__).resolve().parents[2] / "alertify_settings.json"
CONN_FIELDS = ("host", "port", "database", "user", "password")
FIELDS = CONN_FIELDS + ("enabled", "default_time")
DEFAULT_TIME = "11:00"  # 24-hour HH:MM
_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")

_engine: Engine | None = None


class AlertifyUnavailable(RuntimeError):
    """Alertify is off, not configured, or its server cannot be reached (the message says which)."""


# --------------------------------------------------------------------------- settings
def _env_defaults() -> dict[str, Any]:
    s = get_settings()
    return {"host": s.alertify_db_host, "port": s.alertify_db_port, "database": s.alertify_db_name, "user": s.alertify_db_user, "password": s.alertify_db_password}


def _read_file() -> dict[str, Any]:
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {k: v for k, v in data.items() if k in FIELDS} if isinstance(data, dict) else {}


def load() -> dict[str, Any]:
    """Effective settings: built-in defaults, then `.env`, then the saved file (the file wins where it has a value)."""
    out: dict[str, Any] = {"enabled": False, "default_time": DEFAULT_TIME, **_env_defaults()}
    out.update(_read_file())
    return out


def _configured(s: dict[str, Any]) -> bool:
    return all(str(s.get(k) or "").strip() for k in CONN_FIELDS)


def public() -> dict[str, Any]:
    """What the settings screen may see: everything except the password."""
    s = load()
    return {
        "enabled": bool(s["enabled"]),
        "host": s["host"],
        "port": s["port"],
        "database": s["database"],
        "user": s["user"],
        "password_set": bool(s["password"]),
        "default_time": s["default_time"] or DEFAULT_TIME,
        "configured": _configured(s),
    }


def config() -> dict[str, Any]:
    """What every signed-in screen may see: is the Alertify button available (switched on, configured)."""
    s = load()
    return {"enabled": bool(s["enabled"]), "ready": bool(s["enabled"]) and _configured(s), "default_time": s["default_time"] or DEFAULT_TIME}


def _clean(values: dict[str, Any], *, base: dict[str, Any]) -> dict[str, Any]:
    """Merge submitted values over the stored ones. A blank password keeps the stored one; everything is validated."""
    out = dict(base)
    for k in ("host", "database", "user"):
        if k in values:
            out[k] = str(values[k] or "").strip()
    if "port" in values:
        p = str(values["port"] if values["port"] is not None else "").strip()
        if not p.isdigit() or not 0 < int(p) < 65536:
            raise ValueError("Port must be a number between 1 and 65535")
        out["port"] = int(p)
    if values.get("password"):  # blank = keep the saved password
        out["password"] = str(values["password"])
    if "enabled" in values:
        out["enabled"] = bool(values["enabled"])
    if "default_time" in values:
        t = str(values["default_time"] or "").strip()
        if not _TIME.match(t):
            raise ValueError("Default time must look like 11:00 (24-hour HH:MM)")
        h, m = t.split(":")
        out["default_time"] = f"{int(h):02d}:{m}"
    return out


def _candidate(s: dict[str, Any]) -> Settings:
    """A Settings object aimed at Alertify's server (nothing saved, temple settings untouched) for the shared engine builder."""
    base = Settings(_env_file=None)
    return base.model_copy(update={"db_server": s["host"], "db_port": int(s["port"]), "db_name": s["database"], "db_user": s["user"], "db_password": s["password"]})


def test(values: dict[str, Any]) -> tuple[bool, str]:
    """Try the submitted details (blank password = the saved one) without saving anything."""
    from app.core.db import test_connection_for

    try:
        s = _clean(values, base=load())
    except ValueError as exc:
        return False, str(exc)
    missing = [k for k in ("host", "port", "database", "user", "password") if not str(s.get(k) or "").strip()]
    if missing:
        return False, "Fill in: " + ", ".join(missing)
    ok, detail = test_connection_for(_candidate(s))
    return (True, f"Connected to {s['database']} on {s['host']}:{s['port']}") if ok else (False, _friendly(detail))


def _friendly(detail: str) -> str:
    d = detail or ""
    if "18456" in d or "Login failed" in d:
        return "The server rejected the user name or password."
    if "4060" in d or "Cannot open database" in d:
        return "The login works but that database name is not available to this user."
    if "Cannot reach" in d:
        return d.split("Check the server")[0].strip()
    return d[:300]


def save(values: dict[str, Any]) -> dict[str, Any]:
    """Validate and store. Changed connection details must connect first; switching on needs a complete configuration."""
    global _engine
    stored = load()
    new = _clean(values, base=stored)
    conn_changed = any(new[k] != stored[k] for k in CONN_FIELDS)
    if conn_changed and _configured(new):
        ok, msg = test(new)
        if not ok:
            raise ValueError(msg)
    if new["enabled"] and not _configured(new):
        raise ValueError("Fill in the server, port, database, user name and password before switching Alertify on")
    if conn_changed:
        if _engine is not None:
            _engine.dispose()
        _engine = None
    _PATH.write_text(json.dumps({k: new[k] for k in FIELDS}, indent=2), encoding="utf-8")
    return public()


# --------------------------------------------------------------------------- the second engine
def get_engine() -> Engine:
    """The Alertify engine (built on first use, kept separate from the temple engine). Raises AlertifyUnavailable with a plain message."""
    global _engine
    if _engine is not None:
        return _engine
    from app.core.db import DatabaseUnavailable, _connect_with_fallback

    s = load()
    if not _configured(s):
        raise AlertifyUnavailable("Alertify is not configured: set the server details in Temple Settings")
    try:
        _engine, _driver = _connect_with_fallback(_candidate(s), pool_pre_ping=True, pool_size=2, max_overflow=2, pool_recycle=900, pool_timeout=8, future=True)
    except DatabaseUnavailable as exc:
        raise AlertifyUnavailable(_friendly(str(exc))) from exc
    return _engine


def reset_engine() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


# --------------------------------------------------------------------------- creating alerts
# How Alertify stores an alert it creates by hand (read from its own rows, e.g. ALERTID 830 / 836; MstAlert has no triggers and
# the alarm child tables TrnDtlAlarm / trnDtlAlertAlarm / TrnDtlAlarmRecur stay empty for these):
#   ALERTID identity, Title nvarchar(255), NoteMsg + RMKS = the description (same text), AlarmSet='Y', IsAlarmReq='Y',
#   PlaySound='Y', AlarmDateTime = DueOn = the moment it rings, REMDAYS = the "notify me on (days)" number,
#   WebCreatedBy = the Alertify user it belongs to ('ADMIN'). Every other column keeps its table default.
TITLE_MAX = 255
TEXT_MAX = 4000
OWNER = "ADMIN"


def _clip(text_: str, n: int) -> str:
    return (text_ or "").strip()[:n]


def create_alerts(title: str, description: str, items: list[dict], remind_days: int = 0, now=None) -> dict:
    """One alert per item {due_date 'YYYY-MM-DD', time 'HH:MM'}, all in ONE transaction.
    Alerts that already exist (same title, same moment) are skipped and reported, never duplicated.
    Raises ValueError for unusable input and AlertifyUnavailable when the server cannot be reached."""
    from datetime import datetime

    from sqlalchemy import text

    title = _clip(title, TITLE_MAX)
    description = _clip(description, TEXT_MAX)
    if not title:
        raise ValueError("The alert needs a title")
    if not items:
        raise ValueError("There is no date to set the alert on")
    now = now or datetime.now()
    moments: list[datetime] = []
    skipped: list[dict] = []
    for it in items:
        try:
            due = datetime.strptime(f"{it['due_date']} {it.get('time') or DEFAULT_TIME}", "%Y-%m-%d %H:%M")
        except (KeyError, ValueError, TypeError):
            raise ValueError("A date or time is not valid")
        if due not in moments:  # past moments are allowed: the user may record an alert for an earlier date
            moments.append(due)
    created: list[dict] = []
    if moments:
        eng = get_engine()
        try:
            with eng.begin() as con:
                for due in sorted(moments):
                    dup = con.execute(
                        text("SELECT TOP 1 ALERTID FROM MstAlert WHERE Title = :t AND DueOn = :d AND AlarmSet = 'Y' AND WebCreatedBy = :o"),
                        {"t": title, "d": due, "o": OWNER},
                    ).scalar()
                    if dup:
                        skipped.append({"due": due.strftime("%Y-%m-%d %H:%M"), "reason": "already exists", "id": int(dup)})
                        continue
                    new_id = con.execute(
                        text(
                            "INSERT INTO MstAlert (Title, NoteMsg, RMKS, AlarmSet, IsAlarmReq, PlaySound, AlarmDateTime, DueOn, REMDAYS, WebCreatedBy) "
                            "OUTPUT INSERTED.ALERTID VALUES (:t, :m, :m, 'Y', 'Y', 'Y', :d, :d, :r, :o)"
                        ),
                        {"t": title, "m": description, "d": due, "r": max(0, min(int(remind_days or 0), 32000)), "o": OWNER},
                    ).scalar()
                    created.append({"id": int(new_id), "due": due.strftime("%Y-%m-%d %H:%M")})
        except AlertifyUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 - the bill is already saved; give a plain message
            log.warning("Alertify insert failed: %s", exc)
            raise AlertifyUnavailable(_friendly(str(exc))) from exc
    return {"created": created, "skipped": skipped}
