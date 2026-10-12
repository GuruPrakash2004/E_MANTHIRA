"""Seva Entry endpoints — see app/services/seva.py for the write-set."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import seva as seva_service

router = APIRouter(prefix="/sevas", tags=["sevas"])


class SevaDateIn(BaseModel):
    perform_date: date
    remarks: str = ""


class SevaCreateRequest(BaseModel):
    sannidhi_id: int
    seva_id: int
    mobile: str
    name: str
    name_kn: str | None = None
    gothra_id: int | None = None
    nakshatra_id: int | None = None
    rashi_id: int | None = None
    name2: str | None = None
    nakshatra2_id: int | None = None
    rashi2_id: int | None = None
    timing_text: str | None = None
    payment_mode: str
    bank_name: str | None = None
    cheque_no: str | None = None
    cheque_date: date | None = None
    reference_no: str | None = None
    address: str | None = None
    ledger_id: int
    cash_bank_ledger_id: int
    voucher_type: str
    rate: float
    dates: list[SevaDateIn]
    doc_date: date
    is_regular: bool = False
    prasada: bool = False
    extra_fields: dict = {}


class CancelRequest(BaseModel):
    reason: str


@router.get("/devotee")
def devotee_lookup(mobile: str, name: str | None = None, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return seva_service.lookup_devotee(conn, mobile=mobile, name=name)


@router.get("")
def list_sevas(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW)),
):
    return seva_service.list_recent(conn, fy=fy, search=search, top=top)


@router.get("/{seva_id}")
def get_seva(seva_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW))):
    return seva_service.get(conn, seva_id)


@router.post("", status_code=201)
def create_seva(
    body: SevaCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_ADD)),
):
    data = seva_service.SevaInput(
        **{**body.model_dump(exclude={"dates"}), "dates": [seva_service.SevaDate(perform_date=d.perform_date, remarks=d.remarks) for d in body.dates]}
    )
    with with_transaction() as conn:
        return seva_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.post("/{seva_id}/cancel")
def cancel_seva(seva_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        seva_service.cancel(conn, seva_id=seva_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Seva Entry Successfully!"}


@router.delete("/{seva_id}")
def delete_seva(seva_id: int, user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        seva_service.delete(conn, seva_id=seva_id, user_code=user.user_code)
    return {"message": "Deleted Seva Entry Successfully!"}
