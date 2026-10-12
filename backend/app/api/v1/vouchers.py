"""Payment Voucher + Receipt Voucher endpoints (standalone, not source-doc-driven)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import payment as payment_service
from app.services import receipt as receipt_service

router = APIRouter(tags=["vouchers"])


class CancelRequest(BaseModel):
    reason: str


# ---- Payment Voucher (DocID 1224) ----


class VoucherLineRequest(BaseModel):
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


class PaymentVoucherCreateRequest(BaseModel):
    prefix: str
    voucher_date: date
    vch_type: str
    narration: str
    lines: list[VoucherLineRequest]
    cheque_dd_no: str | None = None
    cheque_date: date | None = None
    cheque_dd_amt: str | None = None
    cheque_no: str | None = None
    bank_id: int | None = None
    card_no: str | None = None
    card_amt: float | None = None
    extra_fields: dict = {}


@router.get("/vouchers/payments")
def list_payment_vouchers(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(payment_service.DOC_ID, RIGHT_VIEW)),
):
    return payment_service.list_recent(conn, fy=fy, search=search, top=top)


@router.post("/vouchers/payments", status_code=201)
def create_payment_voucher(
    body: PaymentVoucherCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(payment_service.DOC_ID, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [payment_service.VoucherLine(**l) for l in values.pop("lines")]
    data = payment_service.PaymentVoucherInput(**values, lines=lines)
    with with_transaction() as conn:
        return payment_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.post("/vouchers/payments/{pmtvch_id}/cancel")
def cancel_payment_voucher(pmtvch_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(payment_service.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        payment_service.cancel(conn, pmtvch_id=pmtvch_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Payment Voucher Successfully!"}


@router.delete("/vouchers/payments/{pmtvch_id}")
def delete_payment_voucher(pmtvch_id: int, user: CurrentUser = Depends(require_right(payment_service.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        payment_service.delete(conn, pmtvch_id=pmtvch_id, user_code=user.user_code)
    return {"message": "Deleted Payment Voucher Successfully!"}


# ---- Receipt Voucher (DocID 1248) ----


class ReceiptVoucherCreateRequest(BaseModel):
    prefix: str
    receipt_date: date
    vch_type: str
    narration: str
    lines: list[VoucherLineRequest]
    cheque_dd_no: str | None = None
    cheque_date: date | None = None
    cheque_dd_amt: str | None = None
    cheque_no: str | None = None
    bank_id: int | None = None
    card_no: str | None = None
    card_amt: float | None = None
    extra_fields: dict = {}


@router.get("/vouchers/receipts")
def list_receipt_vouchers(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(1248, RIGHT_VIEW)),
):
    return receipt_service.list_recent(conn, fy=fy, search=search, top=top)


@router.post("/vouchers/receipts", status_code=201)
def create_receipt_voucher(
    body: ReceiptVoucherCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(1248, RIGHT_ADD)),
):
    with with_transaction() as conn:
        r = receipt_service.create_receipt_voucher(
            conn,
            fy=fy,
            prefix=body.prefix,
            receipt_date=body.receipt_date,
            vch_type=body.vch_type,
            narration=body.narration,
            lines=[receipt_service.VoucherLine(**l.model_dump()) for l in body.lines],
            user_code=user.user_code,
            cheque_dd_no=body.cheque_dd_no,
            cheque_date=body.cheque_date,
            cheque_dd_amt=body.cheque_dd_amt,
            cheque_no=body.cheque_no,
            bank_id=body.bank_id,
            card_no=body.card_no,
            card_amt=body.card_amt,
            extra_fields=body.extra_fields,
        )
        return {"receipt_id": r.receipt_id, "receipt_no": r.receipt_no}


@router.post("/vouchers/receipts/{receipt_id}/cancel")
def cancel_receipt_voucher(receipt_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(1248, RIGHT_EDIT))):
    with with_transaction() as conn:
        receipt_service.cancel_by_id(conn, receipt_id=receipt_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Receipt Voucher Successfully!"}


@router.delete("/vouchers/receipts/{receipt_id}")
def delete_receipt_voucher(receipt_id: int, _: CurrentUser = Depends(require_right(1248, RIGHT_DELETE))):
    with with_transaction() as conn:
        receipt_service.delete_by_id(conn, receipt_id=receipt_id)
    return {"message": "Deleted Receipt Voucher Successfully!"}
