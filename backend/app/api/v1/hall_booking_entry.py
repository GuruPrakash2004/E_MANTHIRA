"""Hall Booking Entry endpoints — see app/services/hall_booking_entry.py (DocID 1280, distinct from Hall Booking/1281)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_VIEW
from app.services import hall_booking_entry as hbe

router = APIRouter(prefix="/hall-booking-entry", tags=["hall-booking-entry"])


class HbeLineRequest(BaseModel):
    name_of_hall: str
    amount: float
    rate: float = 0
    hrs: float = 0


class HbeCreateRequest(BaseModel):
    type: str
    hb_start_dt: date
    hb_end_dt: date
    start_time: str = ""
    end_time: str = ""
    name_of_func: str = ""
    contact_person: str = ""
    contact_no: str
    mobile_no: str = ""
    address: str = ""
    payment_mode: str = "Cash"
    reference_no: str = ""
    email_id: str = ""
    pan: str = ""
    cgst: float = 0
    sgst: float = 0
    security_deposit_amt: float = 0
    advance_amt: float = 0
    bank: str = ""
    cash_cheque_no: str = ""
    receipt_date: date | None = None
    remarks: str = ""
    issued_by: str = ""
    lines: list[HbeLineRequest]


@router.get("")
def list_hbe(
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_VIEW)),
):
    return hbe.list_hbe(conn, fy=fy, top=top)


@router.get("/{hbe_id}")
def get_hbe(hbe_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_VIEW))):
    return hbe.get_hbe(conn, hbe_id=hbe_id)


@router.post("", status_code=201)
def create_hbe(body: HbeCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_ADD))):
    values = body.model_dump()
    lines = [hbe.HbeLine(**l) for l in values.pop("lines")]
    data = hbe.HbeInput(**values, lines=lines)
    with with_transaction() as conn:
        return hbe.create_hbe(conn, data=data, fy=fy, user_code=user.user_code)


@router.delete("/{hbe_id}")
def delete_hbe(hbe_id: int, user: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        hbe.delete_hbe(conn, hbe_id=hbe_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}
