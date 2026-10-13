"""Per-document Options endpoints (Send EMAIL / Send SMS and the option list) — see app/services/doc_messages.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user

from app.services import doc_messages as svc

router = APIRouter(prefix="/doc-actions", tags=["doc-actions"])


@router.get("/{doc_id}/options")
def options(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.get_options(conn, doc_id)


@router.get("/sms-providers")
def providers(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.sms_providers(conn)


@router.get("/{doc_id}/email-templates")
def email_templates(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.email_templates(conn, doc_id)


class PrepareBody(BaseModel):
    template: str


@router.post("/{doc_id}/{record_id}/email/prepare")
def email_prepare(doc_id: int, record_id: int, body: PrepareBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.email_prepare(conn, doc_id, record_id, body.template)


class EmailBody(BaseModel):
    to: str
    cc: str = ""
    subject: str = ""
    body: str


@router.post("/{doc_id}/{record_id}/email/send")
def email_send(doc_id: int, record_id: int, body: EmailBody, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        n = svc.email_send(conn, to=body.to, cc=body.cc, subject=body.subject, body=body.body)
    return {"message": "Email Sent....", "recipients": n}


@router.get("/{doc_id}/sms-templates")
def sms_templates(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.sms_templates(conn, doc_id)


@router.post("/{doc_id}/{record_id}/sms/prepare")
def sms_prepare(doc_id: int, record_id: int, body: PrepareBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.sms_prepare(conn, doc_id, record_id, body.template)


class SmsBody(BaseModel):
    mobile: str
    text: str
    provider: str = ""


@router.post("/{doc_id}/{record_id}/sms/send")
def sms_send(doc_id: int, record_id: int, body: SmsBody, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        n = svc.sms_send(conn, mobile=body.mobile, message=body.text, provider=body.provider)
    return {"message": "Message Sent.", "sent": n}
