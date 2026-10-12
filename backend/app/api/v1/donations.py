"""Donation Receipt Entry endpoints — see app/services/donation.py for the write-set."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import donation as donation_service

router = APIRouter(prefix="/donations", tags=["donations"])


class DonationLineRequest(BaseModel):
    amount: float
    seva_id: int | None = None
    seva_name: str | None = None


class DonationCreateRequest(BaseModel):
    prefix: str
    donor: str
    contact_no: str | None = None
    address: str | None = None
    pan_no: str | None = None
    payment_mode: str
    bank_name: str | None = None
    cheque_no: str | None = None
    cheque_date: date | None = None
    reference_no: str | None = None
    remarks: str | None = None
    ledger_id: int
    cash_bank_ledger_id: int
    amount: float
    doc_date: date
    lines: list[DonationLineRequest] | None = None
    hb_id: int | None = None
    extra_fields: dict = {}


class CancelRequest(BaseModel):
    reason: str


@router.get("")
def list_donations(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW)),
):
    return donation_service.list_recent(conn, fy=fy, search=search, top=top)


@router.get("/{donrec_id}")
def get_donation(donrec_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW))):
    return donation_service.get(conn, donrec_id)


@router.post("", status_code=201)
def create_donation(
    body: DonationCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = values.pop("lines", None)
    data = donation_service.DonationInput(
        **values, lines=[donation_service.DonationLine(**l) for l in lines] if lines else None
    )
    with with_transaction() as conn:
        return donation_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.get("/donor/lookup")
def lookup_donor(
    contact_no: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW))
):
    return donation_service.lookup_donor(conn, contact_no=contact_no)


@router.post("/{donrec_id}/cancel")
def cancel_donation(donrec_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        donation_service.cancel(conn, donrec_id=donrec_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Donation Receipt Successfully!"}


@router.delete("/{donrec_id}")
def delete_donation(donrec_id: int, user: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        donation_service.delete(conn, donrec_id=donrec_id, user_code=user.user_code)
    return {"message": "Deleted Donation Receipt Successfully!"}
