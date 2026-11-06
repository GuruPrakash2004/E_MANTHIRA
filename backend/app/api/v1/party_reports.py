"""Receivable / payable reports (see app/services/party_reports.py). Read-only. The menu rows these screens belong to are found by
caption (the legacy EXE opens them by caption), and the user needs the View right on the one that exists in this database."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user
from app.meta import menu as meta_menu
from app.services import party_reports as svc

router = APIRouter(prefix="/party-reports", tags=["party-reports"])

# menu captions (keys) each report is reached from, per kind
CAPTIONS = {
    "party-outstanding": {"receivable": ["Party wise OutStanding"], "payable": ["Party wise OutStanding"]},
    "ageing": {"receivable": ["Customer Ageing", "Bill wise Ageing"], "payable": ["Supplier Ageing", "Bill wise Ageing"]},
    "reminder": {"receivable": ["Customer Reminder"], "payable": ["Supplier Reminder"]},
    "multi-payment": {"payable": ["Generate Multi Payment Voucher"]},
}


def _check(conn: Connection, user: CurrentUser, report: str, kind: str) -> None:
    if kind not in svc.KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown party kind")
    for cap in CAPTIONS[report][kind]:
        item = meta_menu.resolve_menu_item_by_caption(conn, cap)
        if item is not None:
            rights = meta_menu.get_rights_string(conn, user_id=user.user_id, role_id=user.role_id, user_code=user.user_code, menu_item_id=item)
            if not meta_menu.has_right(rights, meta_menu.RIGHT_VIEW):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Access Denied")
            return


class Filters(BaseModel):
    party_ids: list[int] = []
    group_ids: list[int] = []


class PartyWiseBody(Filters):
    as_on: date
    debit_over: float = 0
    credit_over: float = 0


class AgeingBody(Filters):
    as_on: date
    buckets: list[dict] = []  # [{from, to}]; the last may omit `to`
    billwise: bool = False
    debit_over: float = 0
    credit_over: float = 0


class ReminderBody(Filters):
    as_on: date
    omit_below: float = 0


@router.get("/{kind}/options")
def get_options(kind: str, report: str = "outstanding", conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    if report not in CAPTIONS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown report")
    _check(conn, user, report, kind)
    return svc.options(conn, kind, CAPTIONS[report][kind][0])


@router.get("/{kind}/parties")
def get_parties(kind: str, search: str = "", conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    return svc.parties(conn, kind, search)


@router.post("/{kind}/party-outstanding")
def party_outstanding(kind: str, body: PartyWiseBody, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _check(conn, user, "party-outstanding", kind)
    return svc.party_outstanding(conn, kind, body.as_on, body.party_ids, body.group_ids, body.debit_over, body.credit_over)


@router.post("/{kind}/ageing")
def ageing(kind: str, body: AgeingBody, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _check(conn, user, "ageing", kind)
    buckets = [{"from": b["from"], "to": b.get("to")} for b in body.buckets if b.get("from") is not None]
    return svc.ageing(conn, kind, body.as_on, body.party_ids, buckets, body.billwise, body.debit_over, body.credit_over)


@router.post("/{kind}/reminders")
def reminders(kind: str, body: ReminderBody, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _check(conn, user, "reminder", kind)
    return svc.reminders(conn, kind, body.as_on, body.party_ids, body.group_ids, body.omit_below)


class PlanBody(Filters):
    as_on: date
    max_outstanding: float = 0
    payments: dict[int, float] = {}  # AcLedID -> amount to pay now


@router.post("/payable/payment-plan")
def payment_plan(body: PlanBody, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _check(conn, user, "multi-payment", "payable")
    return svc.payment_plan(conn, body.as_on, body.party_ids, body.max_outstanding, {int(k): v for k, v in body.payments.items()})
