"""Alertify endpoints (see app/services/alertify.py): settings for ADMIN, a small public config for every signed-in screen."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.security import CurrentUser, get_current_user
from app.services import alertify as svc

router = APIRouter(prefix="/alertify", tags=["alertify"])


def _admin(user: CurrentUser) -> None:
    if user.user_code.strip().upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can view or change the Alertify settings")


@router.get("/config")
def get_config(_: CurrentUser = Depends(get_current_user)):
    """Is the Alertify button available? Switched on, configured. No secrets."""
    return svc.config()


@router.get("/settings")
def get_settings(user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    return svc.public()


@router.post("/test")
def test_settings(values: dict[str, Any], user: CurrentUser = Depends(get_current_user)):
    """Try the submitted server details without saving (a blank password means the saved one)."""
    _admin(user)
    ok, message = svc.test(values)
    return {"ok": ok, "message": message}


@router.put("/settings")
def put_settings(values: dict[str, Any], user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    try:
        return svc.save(values)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


class AlertItem(BaseModel):
    due_date: str  # YYYY-MM-DD
    time: str = ""  # HH:MM, blank = the default time


class AlertIn(BaseModel):
    title: str = Field(max_length=2000)
    description: str = Field(default="", max_length=20000)
    remind_days: int = 0
    items: list[AlertItem] = Field(max_length=60)


@router.post("/alerts")
def create_alerts(body: AlertIn, _: CurrentUser = Depends(get_current_user)):
    """Create the reminders (text already filled in by the screen). Any signed-in user; needs Alertify switched on and set up."""
    cfg = svc.config()
    if not cfg["ready"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Alertify is switched off or not set up")
    try:
        return svc.create_alerts(body.title, body.description, [i.model_dump() for i in body.items], body.remind_days)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except svc.AlertifyUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
