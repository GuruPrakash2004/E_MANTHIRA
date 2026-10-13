"""
Database connection settings — deliberately UNAUTHENTICATED (reachable
before login, since no DB connection exists yet to authenticate against).
See app/core/runtime_db_settings.py for the storage/reconnect mechanism
and the CLAUDE.md rule 7 exception this represents. The password is never
echoed back on GET (write-only field) as a low-cost safety default.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.print import rpt_bridge_manager
from fastapi import APIRouter

from app.core import runtime_db_settings as rds
from app.core.db import test_connection_for

router = APIRouter(prefix="/db-settings", tags=["db-settings"])


class DbSettingsIn(BaseModel):
    db_engine: str | None = None
    db_driver_odbc: str | None = None
    db_server: str | None = None
    db_port: int | None = None
    db_name: str | None = None
    db_user: str | None = None
    db_password: str | None = None
    db_trust_cert: str | None = None


@router.get("")
def get_db_settings():
    return rds.effective_fields()


@router.post("/databases")
def list_databases(body: DbSettingsIn):
    """Step 1 of the panel: connect to the SERVER only (master, using exactly
    the submitted server/user/password) and list the databases on it."""
    from sqlalchemy import text
    from app.core.db import _connect_with_fallback

    values = body.model_dump(exclude_unset=True)
    values["db_name"] = "master"
    candidate = rds.build_candidate(values)
    try:
        engine, driver = _connect_with_fallback(candidate, pool_pre_ping=True)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": str(exc)[:300], "databases": []}
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT name FROM sys.databases WHERE state = 0 "
                "AND name NOT IN ('master','tempdb','model','msdb') "
                "AND HAS_DBACCESS(name) = 1 ORDER BY name"
            )).fetchall()
    finally:
        engine.dispose()
    return {"ok": True, "detail": f"Connected to server (via {driver})", "databases": [r[0] for r in rows]}


@router.post("/test")
def test_db_settings(body: DbSettingsIn):
    candidate = rds.build_candidate(body.model_dump(exclude_unset=True))
    ok, detail = test_connection_for(candidate)
    return {"ok": ok, "detail": detail}


@router.put("")
def update_db_settings(body: DbSettingsIn):
    ok, detail = rds.apply_and_reconnect(body.model_dump(exclude_unset=True))
    if ok:
        rpt_bridge_manager.restart()  # the print bridge reads the DB settings at start; relaunch it on the new database
    return {"ok": ok, "detail": detail}
