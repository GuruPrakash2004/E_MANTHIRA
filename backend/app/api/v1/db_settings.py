"""
Database connection settings — deliberately UNAUTHENTICATED (reachable
before login, since no DB connection exists yet to authenticate against).
See app/core/runtime_db_settings.py for the storage/reconnect mechanism
and the CLAUDE.md rule 7 exception this represents. The password is never
echoed back on GET (write-only field) as a low-cost safety default.
"""
from __future__ import annotations

from pydantic import BaseModel
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


@router.post("/test")
def test_db_settings(body: DbSettingsIn):
    candidate = rds.build_candidate(body.model_dump())
    ok, detail = test_connection_for(candidate)
    return {"ok": ok, "detail": detail}


@router.put("")
def update_db_settings(body: DbSettingsIn):
    ok, detail = rds.apply_and_reconnect(body.model_dump())
    return {"ok": ok, "detail": detail}
