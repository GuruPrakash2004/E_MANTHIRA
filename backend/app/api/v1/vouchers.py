"""Payment Voucher + Receipt Voucher endpoints (standalone, not source-doc-driven)."""
from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, get_current_user, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import journal as journal_service
from app.services import payment as payment_service
from app.services import receipt as receipt_service

router = APIRouter(tags=["vouchers"])


class CancelRequest(BaseModel):
    reason: str


# ---- Payment Voucher (DocID 1224) ----


class AdjustmentRequest(BaseModel):
    """One bill-wise adjustment of a line (see services/bill_adjust.py): against a pending bill ('A') or a new reference ('N')."""

    adj_acc_id: int = 0
    amount: float
    side: str = "DR"
    adj_type: str = "A"
    new_ref_no: str = ""


class VoucherLineRequest(BaseModel):
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0
    adjustments: list[AdjustmentRequest] = []


class PaymentVoucherCreateRequest(BaseModel):
    prefix: str
    voucher_date: date
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    lines: list[VoucherLineRequest]


@router.get("/vouchers/payments")
def list_payment_vouchers(
    search: str = "",
    top: int = Query(50, le=1000),
    fy: FinancialYear = Depends(get_history_fy),
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


@router.put("/vouchers/payments/{pmtvch_id}")
def update_payment_voucher(
    pmtvch_id: int,
    body: PaymentVoucherCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(payment_service.DOC_ID, RIGHT_EDIT)),
):
    values = body.model_dump()
    lines = [payment_service.VoucherLine(**l) for l in values.pop("lines")]
    data = payment_service.PaymentVoucherInput(**values, lines=lines)
    with with_transaction() as conn:
        return payment_service.update(conn, pmtvch_id=pmtvch_id, data=data, fy=fy, user_code=user.user_code)


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
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    lines: list[VoucherLineRequest]


@router.get("/vouchers/receipts")
def list_receipt_vouchers(
    search: str = "",
    top: int = Query(50, le=1000),
    fy: FinancialYear = Depends(get_history_fy),
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
            fields=body.fields,
            lines=[receipt_service.VoucherLine(**l.model_dump()) for l in body.lines],
            user_code=user.user_code,
        )
        return {"receipt_id": r.receipt_id, "receipt_no": r.receipt_no}


@router.put("/vouchers/receipts/{receipt_id}")
def update_receipt_voucher(
    receipt_id: int,
    body: ReceiptVoucherCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(1248, RIGHT_EDIT)),
):
    with with_transaction() as conn:
        r = receipt_service.update_receipt_voucher(
            conn, receipt_id=receipt_id, fy=fy, receipt_date=body.receipt_date, fields=body.fields,
            lines=[receipt_service.VoucherLine(**l.model_dump()) for l in body.lines], user_code=user.user_code,
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


# ---- Journal Voucher (DocID 1254) — same Dr/Cr grid as Payment Voucher ----


class JournalVoucherCreateRequest(PaymentVoucherCreateRequest):
    pass


@router.get("/vouchers/journals")
def list_journal_vouchers(
    search: str = "",
    top: int = Query(50, le=1000),
    fy: FinancialYear = Depends(get_history_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(journal_service.DOC_ID, RIGHT_VIEW)),
):
    return journal_service.list_recent(conn, fy=fy, search=search, top=top)


@router.post("/vouchers/journals", status_code=201)
def create_journal_voucher(
    body: JournalVoucherCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(journal_service.DOC_ID, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [journal_service.VoucherLine(**l) for l in values.pop("lines")]
    data = journal_service.JournalVoucherInput(**values, lines=lines)
    with with_transaction() as conn:
        return journal_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.put("/vouchers/journals/{jnrvch_id}")
def update_journal_voucher(
    jnrvch_id: int,
    body: JournalVoucherCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(journal_service.DOC_ID, RIGHT_EDIT)),
):
    values = body.model_dump()
    lines = [journal_service.VoucherLine(**l) for l in values.pop("lines")]
    data = journal_service.JournalVoucherInput(**values, lines=lines)
    with with_transaction() as conn:
        return journal_service.update(conn, jnrvch_id=jnrvch_id, data=data, fy=fy, user_code=user.user_code)


@router.post("/vouchers/journals/{jnrvch_id}/cancel")
def cancel_journal_voucher(jnrvch_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(journal_service.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        journal_service.cancel(conn, jnrvch_id=jnrvch_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Journal Voucher Successfully!"}


@router.delete("/vouchers/journals/{jnrvch_id}")
def delete_journal_voucher(jnrvch_id: int, user: CurrentUser = Depends(require_right(journal_service.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        journal_service.delete(conn, jnrvch_id=jnrvch_id, user_code=user.user_code)
    return {"message": "Deleted Journal Voucher Successfully!"}


@router.get("/vouchers/pending-bills")
def pending_bills(
    ac_led_id: int, side: str = "DR", doc_id: int = 0, voucher_id: int = 0, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user),
):
    """The pending bills of a party for the Bill wise Adjustment window (legacy mSP_GetPendBills); `voucher_id` is the voucher being edited."""
    from app.services import bill_adjust

    own = 0
    if voucher_id and doc_id:
        sh = conn.execute(text("SELECT DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar()
        if sh and re.fullmatch(r"\w+", str(sh).strip()):
            own = bill_adjust.own_acc_id(conn, str(sh).strip(), voucher_id)
    return bill_adjust.pending_bills(conn, ac_led_id=ac_led_id, side=side, own_acc=own)


@router.get("/vouchers/account-heads")
def account_heads_list(
    doc_id: int = Query(...),
    side: str = Query("DR", pattern="^(?i:DR|CR|TO|BY)$"),
    search: str = Query("", max_length=100),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    """The Account Head list for one voucher line: the ledger groups this document allows for that side (UtlAccAmtTypeLedGrps) and their children."""
    from app.services import account_heads

    return account_heads.list_heads(conn, doc_id=doc_id, side=side, search=search)


@router.get("/vouchers/account-heads/{ac_led_id}")
def account_head_detail(ac_led_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """One head: name, group, balance (legacy getAcBalance) and the reason it cannot be used, if any."""
    from app.services import account_heads

    return account_heads.detail(conn, ac_led_id)


@router.get("/vouchers/{kind}/{voucher_id}")
def get_voucher(kind: str, voucher_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import voucher_view

    return voucher_view.get_voucher(conn, kind, voucher_id)
