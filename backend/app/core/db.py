"""
Database engine + connection helpers for the legacy SQL Server schema.

Rules (see /CLAUDE.md):
  - Parameterised SQL only, via SQLAlchemy Core `text()` with bound params or
    Table/select constructs. Never string-concatenate user input into SQL.
  - Every money-document save happens inside one transaction (`with_transaction`).
  - Never write to a computed column (see legacy/computed_columns.py).
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

from app.core.config import get_settings

_engine: Engine | None = None
_engine_driver: str | None = None  # which candidate actually connected — for diagnostics/display only


def _connect_with_fallback(settings, **engine_kwargs) -> tuple[Engine, str]:
    """Tries each (driver, url) from `sqlalchemy_url_candidates` in order,
    keeping the first that can actually run a query — pyodbc first, then
    pymssql (see config.py's docstring for why). Raises the last error if
    none of them work."""
    errors: list[str] = []
    for driver_name, url_or_factory in _candidates(settings):
        engine: Engine | None = None
        try:
            url = url_or_factory() if callable(url_or_factory) else url_or_factory
            engine = create_engine(url, **engine_kwargs)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return engine, driver_name
        except Exception as exc:  # noqa: BLE001 — try the next candidate
            errors.append(f"{driver_name}: {str(exc).splitlines()[0][:200]}")
            if engine is not None:
                engine.dispose()
    raise RuntimeError(" | ".join(errors) or "no database driver available")


def _candidates(settings):
    """Candidate URLs, built lazily so a missing pyodbc/driver only fails
    that candidate (and falls through to pymssql) instead of everything."""
    if settings.is_mysql:
        return [("mysql", settings.sqlalchemy_url)]
    return [("pyodbc", lambda: settings._pyodbc_url), ("pymssql", lambda: settings._pymssql_url)]


def get_engine() -> Engine:
    global _engine, _engine_driver
    if _engine is None:
        settings = get_settings()
        _engine, _engine_driver = _connect_with_fallback(
            settings, pool_pre_ping=True, pool_size=10, max_overflow=10, pool_recycle=1800, pool_timeout=15, future=True
        )
    return _engine


def current_driver() -> str | None:
    """Which candidate driver the live engine actually connected with
    (e.g. "pyodbc" or "pymssql") — None until the first successful connect."""
    return _engine_driver


def reset_engine() -> None:
    """Drop the cached engine so the next get_engine() rebuilds from current
    settings — used after the Database Settings panel changes the DB target."""
    global _engine, _engine_driver
    from app.core import cache

    cache.clear()  # cached metadata belongs to the old database
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _engine_driver = None


def test_connection_for(settings) -> tuple[bool, str]:
    """Try a throwaway connection against the given Settings, without
    touching the live singleton engine — pyodbc first, falling back to
    pymssql (see config.py's `sqlalchemy_url_candidates`). Used to
    validate a proposed DB target before committing to it (Database
    Settings panel)."""
    try:
        engine, driver_name = _connect_with_fallback(settings, pool_pre_ping=True)
        engine.dispose()
        return True, f"Connected successfully (via {driver_name})"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:300]


def get_conn() -> Iterator[Connection]:
    """FastAPI dependency: a plain (autocommit-off, not yet begun) connection."""
    engine = get_engine()
    with engine.connect() as conn:
        yield conn


@contextmanager
def with_transaction() -> Iterator[Connection]:
    """
    One legacy 'document save' = one transaction, exactly like the old app's
    `svtConn.BeginTransaction(IsolationLevel.ReadCommitted)` ... Commit()/Rollback().
    """
    engine = get_engine()
    with engine.connect() as conn:
        # SQLAlchemy 2.0 "autobegins" a transaction on the first execute(), so
        # we just run statements and commit/rollback the connection directly
        # rather than calling conn.begin() (which would conflict with autobegin).
        if not get_settings().is_mysql:
            conn.execute(text("SET XACT_ABORT ON"))  # SQL Server only
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def limit_clause(n: int) -> str:
    """
    Portable "top N rows" SQL fragment — MySQL only understands `LIMIT n`,
    SQL Server (pre-2012 syntax aside) only understands `OFFSET 0 ROWS FETCH
    NEXT n ROWS ONLY` (no LIMIT). `n` is always an int we control (never raw
    user input), so it's safe to interpolate directly into the fragment.
    Usage: f"SELECT * FROM t ORDER BY id DESC {limit_clause(50)}"
    """
    n = int(n)
    if get_settings().is_mysql:
        return f"LIMIT {n}"
    return f"OFFSET 0 ROWS FETCH NEXT {n} ROWS ONLY"


def healthcheck() -> bool:
    with get_engine().connect() as conn:
        conn.execute(text("SELECT 1"))
    return True
