"""Donation Receipt Entry endpoints — see app/services/donation.py for the write-set."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import donation as donation_service

router = APIRouter(prefix="/donations", tags=["donations"])


class DonationCreateRequest(BaseModel):
    prefix: str
    doc_date: date
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    lines: list[dict]  # Detail Designer fields keyed by FldCode, one dict per line


class CancelRequest(BaseModel):
    reason: str


@router.get("")
def list_donations(
    search: str = "",
    top: int = Query(50, le=1000),
    fy: FinancialYear = Depends(get_history_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW)),
):
    return donation_service.list_recent(conn, fy=fy, search=search, top=top)


@router.get("/donors")
def donor_history(
    name: str = "", top: int = Query(0, ge=0, le=500), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW))
):
    return donation_service.donor_history(conn, name=name, top=top)


@router.get("/last")
def last_donation(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW))):
    return donation_service.last_entry(conn)


@router.get("/{donrec_id}")
def get_donation(donrec_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_VIEW))):
    return donation_service.get(conn, donrec_id)


@router.post("", status_code=201)
def create_donation(
    body: DonationCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(donation_service.DOC_ID, RIGHT_ADD)),
):
    data = donation_service.DonationInput(prefix=body.prefix, doc_date=body.doc_date, fields=body.fields, lines=body.lines)
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
