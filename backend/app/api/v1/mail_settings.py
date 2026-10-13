"""Email (SMTP) settings — visible and editable by ADMIN only (see app/services/mail.py)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import mail as mail_service

router = APIRouter(prefix="/mail-settings", tags=["mail-settings"])


def _admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can view or change the Email settings")


@router.get("")
def get_mail_settings(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    return mail_service.get_settings(conn)


@router.put("")
def put_mail_settings(values: dict[str, Any], user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    if values.get("port") not in (None, "") and not str(values["port"]).strip().isdigit():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Port must be a number")
    with with_transaction() as conn:
        mail_service.save_settings(conn, values)
        return mail_service.get_settings(conn)


class TestBody(BaseModel):
    to: str


@router.post("/test")
def send_test_mail(body: TestBody, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    if "@" not in body.to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a valid e-mail address")
    mail_service.send_mail(conn, [body.to.strip()], "e-Mandira test mail", "This is a test mail from e-Mandira Pranali. Your SMTP settings work.")
    return {"message": f"Test mail sent to {body.to.strip()}"}


@router.get("/sms-providers")
def get_sms_providers(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    from app.services import doc_messages

    return doc_messages.provider_rows(conn)


@router.put("/sms-providers")
def put_sms_providers(rows: list[dict[str, Any]], user: CurrentUser = Depends(get_current_user)):
    _admin(user)
    from app.services import doc_messages

    with with_transaction() as conn:
        return doc_messages.save_providers(conn, rows)
