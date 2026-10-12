"""Hall Booking endpoints — see app/services/hall.py (includes the fixed overlap check)."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_EDIT, RIGHT_VIEW
from app.services import hall as hall_service

router = APIRouter(prefix="/halls", tags=["halls"])


@router.get("")
def list_halls(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    rows = conn.execute(text("SELECT HALLID, HALLCODE, HALLNAME FROM MstHALL WHERE InActive = 'N' AND HALLID > 0 ORDER BY HALLNAME")).mappings().all()
    return [dict(r) for r in rows]


@router.get("/{hall_id}/availability")
def availability(hall_id: int, from_date: date = Query(...), months: int = 6, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return hall_service.availability_calendar(conn, hall_id=hall_id, from_date=from_date, months=months)


class HallBookingCreateRequest(BaseModel):
    booking_type: str
    hall_id: int | None = None
    function_name: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    start_time_text: str | None = None
    end_time_text: str | None = None
    contact_person: str | None = None
    contact_no: str
    mobile: str | None = None
    address: str | None = None
    email: str | None = None
    pan: str | None = None
    remarks: str | None = None
    amount: float
    cgst_pct: float = 0
    sgst_pct: float = 0
    deposit: float = 0
    ledger_id: int
    cash_bank_ledger_id: int
    doc_date: date | None = None
    extra_fields: dict = {}


class PaymentRequest(BaseModel):
    amount: float
    mode: str
    reference: str | None = None
    receipt_type: str
    ledger_id: int
    cash_bank_ledger_id: int
    receipt_date: date | None = None


class CancelRequest(BaseModel):
    reason: str


@router.get("/bookings")
def list_bookings(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(hall_service.DOC_ID, RIGHT_VIEW)),
):
    sql = "SELECT HBID, HBNO, PrintHBNO, HBDate, TYPE, NMEOFFUNC, NETPAY, BALAMT, Cancelled FROM TrnHdrHB WHERE HBDate BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (HBNO LIKE :q OR NMEOFFUNC LIKE :q OR CONTACTNO LIKE :q)"
        params["q"] = f"%{search}%"
    from app.core.db import limit_clause

    sql += f" ORDER BY HBID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("/bookings/{hb_id}")
def get_booking(hb_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(hall_service.DOC_ID, RIGHT_VIEW))):
    return hall_service.get(conn, hb_id)


@router.post("/bookings", status_code=201)
def create_booking(body: HallBookingCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(hall_service.DOC_ID, RIGHT_ADD))):
    data = hall_service.HallBookingInput(**body.model_dump())
    with with_transaction() as conn:
        return hall_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.post("/bookings/{hb_id}/payments", status_code=201)
def add_payment(hb_id: int, body: PaymentRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(hall_service.DOC_ID, RIGHT_ADD))):
    data = hall_service.PaymentInput(**body.model_dump())
    with with_transaction() as conn:
        return hall_service.add_payment(conn, hb_id=hb_id, data=data, fy=fy, user_code=user.user_code)


@router.post("/bookings/{hb_id}/cancel")
def cancel_booking(hb_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(hall_service.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        hall_service.cancel(conn, hb_id=hb_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Hall Booking Successfully!"}
