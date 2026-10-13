"""Global Settings endpoints — see app/services/settings.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def get_settings_list(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    is_admin = user.user_code.upper() == "ADMIN"
    return settings_service.list_settings(conn, is_admin=is_admin)


class SetValueRequest(BaseModel):
    group: str
    name: str
    value: str


@router.put("")
def put_setting_value(body: SetValueRequest, user: CurrentUser = Depends(get_current_user)):
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change Global Settings")
    with with_transaction() as conn:
        settings_service.set_value(conn, set_group=body.group, set_name=body.name, set_value=body.value)
    return {"message": "Updated"}


class SettingItem(BaseModel):
    group: str
    name: str
    value: str = ""


@router.put("/bulk")
def put_settings_bulk(items: list[SettingItem], user: CurrentUser = Depends(get_current_user)):
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change Global Settings")
    with with_transaction() as conn:
        n = settings_service.save_many(conn, [i.model_dump() for i in items])
    return {"message": "Updated successfully.", "updated": n}


class NewSetting(BaseModel):
    group: str = ""
    name: str
    caption: str
    value: str = ""
    remarks: str = ""
    hide: bool = False


@router.post("", status_code=201)
def post_setting(body: NewSetting, user: CurrentUser = Depends(get_current_user)):
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can add a setting")
    with with_transaction() as conn:
        settings_service.create_setting(conn, group=body.group, name=body.name, caption=body.caption, value=body.value, remarks=body.remarks, hide=body.hide)
    return {"message": f"'{body.name.strip()}' added successfully."}
