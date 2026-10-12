"""
Receipt-voucher creation — port of `SaveRcptVch` (present, with small
variations, in frmTrnSeva, frmTrnDONREC and frmTrnHBE). See doc 07 §6.2.

Every Seva / Donation / Hall-booking payment that should hit the books goes
through this ONE function so the write-set (columns, GL posting, numbering)
never drifts between screens.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text as sql_text
from sqlalchemy.engine import Connection

from app.core.fy import FinancialYear
from app.legacy.tables import insert_row, update_row
from app.meta.numbering import next_receipt_no
from app.services import ledger
from app.utils.amount_in_words import amount_in_words


@dataclass
class ReceiptResult:
    receipt_id: int
    receipt_no: str


@dataclass
class VoucherLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


def create_receipt_voucher(
    conn: Connection,
    *,
    fy: FinancialYear,
    prefix: str,
    receipt_date: date,
    vch_type: str,
    narration: str,
    lines: list[VoucherLine],
    user_code: str = "",
    # UtlDocDsgrFlds (DocID 1248): same Bank/Card detail fields as Payment
    # Voucher (DocID 1224) — see payment.py's PaymentVoucherInput for the
    # real-column-type notes (CHQAMT is varchar, BANK is an int FK to
    # MstBANK). Previously hardcoded to blank/zero placeholders.
    cheque_dd_no: str | None = None,
    cheque_date: date | None = None,
    cheque_dd_amt: str | None = None,
    cheque_no: str | None = None,
    bank_id: int | None = None,
    card_no: str | None = None,
    card_amt: float | None = None,
    extra_fields: dict | None = None,
) -> ReceiptResult:
    """
    Standalone Receipt Voucher screen (DocID 1248) — a full Dr/Cr GRID like
    Payment Voucher (doc 07 §5.6), any number of lines. Deliberately separate
    from `create_receipt` above: that function is the fixed "one income
    ledger Cr, one cash/bank ledger Dr" shape Seva/Donation/Hall booking
    always use for their auto-created receipts and must keep working
    unchanged (caught 2026-09-29: generalizing the voucher SCREEN must not
    touch the 3 internal callers of create_receipt).
    """
    if len(lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in lines), 2)
    total_cr = round(sum(l.cr_amt for l in lines), 2)
    if total_cr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")
    if not (narration or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Narration should not be blank!")

    from datetime import datetime as _datetime

    receipt_no = next_receipt_no(
        conn, prefix=prefix, fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat()
    )

    receipt_id = insert_row(
        conn,
        "TrnHdrRCPTVCH",
        {
            "RCPTVCHNO": receipt_no,
            "Prefix": prefix,
            "PrintRCPTVCHNO": receipt_no,
            "RCPTVCHDate": receipt_date,
            "AddedBy": user_code,
            "AddedOn": _datetime.now(),
            "Authorised": "Y",
            "Cancelled": "N",
            "CHQDDNO": cheque_dd_no or " ",
            "CHQDT": cheque_date,
            "CHQAMT": cheque_dd_amt or " ",
            "CARDNO": card_no or "0",
            "CRDAMT": card_amt or 0,
            "CHQNO": cheque_no or " ",
            "BANK": bank_id or 0,
            "AMTINWORDS": amount_in_words(total_cr, "Rupees", "Paise"),
            "NARR": narration,
            "VCHTYP": vch_type,
            "TOTDR": total_dr,
            "TOTCR": total_cr,
            **(extra_fields or {}),
        },
        returning="RCPTVCHID",
    )

    for i, line in enumerate(lines, start=1):
        insert_row(
            conn,
            "TrnDtlRCPTVCH",
            {
                "RCPTVCHID": receipt_id,
                "SlNo": i,
                "AcLedID": line.ac_led_id,
                "RCPTVCHAmt": line.dr_amt or line.cr_amt,
                "CrAmt": line.cr_amt,
                "DrAmt": line.dr_amt,
                "AmtType": "CR" if line.cr_amt else "DR",
                "AgRefAmt": 0,
                "NewRefAmt": 0,
            },
        )

    ledger.post(
        conn,
        doc_type="RCPTVCH",
        trn_id=receipt_id,
        trn_no=receipt_no,
        trn_date=receipt_date,
        due_date=receipt_date,
        narration=narration,
        lines=[
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt)
            for l in lines
        ],
    )
    return ReceiptResult(receipt_id=receipt_id, receipt_no=receipt_no)


def create_receipt(
    conn: Connection,
    *,
    fy: FinancialYear,
    prefix: str,
    receipt_date: date,
    amount: float,
    vch_type: str,  # 'Cash' | 'Bank' | 'Card'
    narration: str,  # NARR — the source document's number, e.g. SEVANO / DONRECNO
    cr_led_id: int,  # income ledger (credited)
    dr_led_id: int,  # cash/bank ledger (debited)
    hb_id: int | None = None,
    rcpt_type: str | None = None,  # 'ADV' | 'Partial' | 'Final' (hall booking payments)
    user_code: str = "",
) -> ReceiptResult:
    receipt_no = next_receipt_no(
        conn, prefix=prefix, fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat()
    )
    amount = round(float(amount), 2)
    from app.core.config import get_settings

    now_fn = "NOW(6)" if get_settings().is_mysql else "SYSDATETIME()"
    server_now = conn.execute(sql_text(f"SELECT {now_fn}")).scalar_one()

    receipt_id = insert_row(
        conn,
        "TrnHdrRCPTVCH",
        {
            "RCPTVCHNO": receipt_no,
            "Prefix": prefix,
            "PrintRCPTVCHNO": receipt_no,
            "RCPTVCHDate": receipt_date,
            "AddedBy": user_code,
            "AddedOn": server_now,
            "Authorised": "Y",
            "Cancelled": "N",
            "CHQDDNO": " ",
            "CHQDT": None,
            "CHQAMT": " ",
            "CARDNO": "0",
            "CRDAMT": 0,
            "CHQNO": " ",
            "BANK": 0,
            "AMTINWORDS": amount_in_words(amount, "Rupees", "Paise"),
            "NARR": narration,
            "VCHTYP": vch_type,
            "TOTDR": amount,
            "TOTCR": amount,
            "HBID": hb_id,
            "RCPTTYPE": rcpt_type,
        },
        returning="RCPTVCHID",
    )

    insert_row(
        conn,
        "TrnDtlRCPTVCH",
        {"RCPTVCHID": receipt_id, "SlNo": 1, "AcLedID": cr_led_id, "RCPTVCHAmt": amount, "CrAmt": amount, "DrAmt": 0, "AmtType": "CR", "AgRefAmt": 0, "NewRefAmt": 0},
    )
    insert_row(
        conn,
        "TrnDtlRCPTVCH",
        {"RCPTVCHID": receipt_id, "SlNo": 2, "AcLedID": dr_led_id, "RCPTVCHAmt": amount, "CrAmt": 0, "DrAmt": amount, "AmtType": "DR", "AgRefAmt": 0, "NewRefAmt": 0},
    )

    ledger.post(
        conn,
        doc_type="RCPTVCH",
        trn_id=receipt_id,
        trn_no=receipt_no,
        trn_date=receipt_date,
        due_date=receipt_date,
        narration=narration,
        lines=[
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, dr_led_id), dr_amt=amount, cr_amt=0),
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, cr_led_id), dr_amt=0, cr_amt=amount),
        ],
    )
    return ReceiptResult(receipt_id=receipt_id, receipt_no=receipt_no)


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    """Standalone Receipt Voucher listing (DocID 1248) — every RCPTVCH row, not just ones auto-created by Seva/Donation/Hall."""
    from app.core.db import limit_clause

    sql = "SELECT RCPTVCHID, RCPTVCHNO, PrintRCPTVCHNO, RCPTVCHDate, NARR, TOTCR, Cancelled FROM TrnHdrRCPTVCH WHERE RCPTVCHDate BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (RCPTVCHNO LIKE :q OR NARR LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY RCPTVCHID DESC {limit_clause(top)}"
    rows = conn.execute(sql_text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def cancel_by_id(conn: Connection, *, receipt_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(sql_text("SELECT RCPTVCHNO, RCPTVCHDate, NARR, Cancelled FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id}).mappings().first()
    if row is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, "TrnHdrRCPTVCH", "RCPTVCHID", receipt_id, {"Cancelled": "Y"})
    ledger.reverse(conn, doc_type="RCPTVCH", trn_no=row["RCPTVCHNO"], trn_id=receipt_id, trn_date=row["RCPTVCHDate"], narration=f"Cancelled: {row['NARR']}")


def delete_by_id(conn: Connection, *, receipt_id: int) -> None:
    row = conn.execute(sql_text("SELECT RCPTVCHNO FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id}).mappings().first()
    if row is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt Voucher not found")
    ledger.delete_posting(conn, doc_type="RCPTVCH", trn_no=row["RCPTVCHNO"], trn_id=receipt_id)
    conn.execute(sql_text("DELETE FROM TrnDtlRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id})
    conn.execute(sql_text("DELETE FROM TrnDtlRCPTVCHBillDet WHERE RCPTVCHID = :id"), {"id": receipt_id})
    conn.execute(sql_text("DELETE FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id})


def delete_receipt_by_narr(conn: Connection, narration: str) -> None:
    """Delete a receipt (+ its GL posting) found by NARR = source document number."""
    row = conn.execute(sql_text("SELECT RCPTVCHID, RCPTVCHNO FROM TrnHdrRCPTVCH WHERE NARR = :n"), {"n": narration}).mappings().first()
    if row is None:
        return
    ledger.delete_posting(conn, doc_type="RCPTVCH", trn_no=row["RCPTVCHNO"], trn_id=row["RCPTVCHID"])
    conn.execute(sql_text("DELETE FROM TrnDtlRCPTVCH WHERE RCPTVCHID = :id"), {"id": row["RCPTVCHID"]})
    conn.execute(sql_text("DELETE FROM TrnDtlRCPTVCHBillDet WHERE RCPTVCHID = :id"), {"id": row["RCPTVCHID"]})
    conn.execute(sql_text("DELETE FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :id"), {"id": row["RCPTVCHID"]})


def void_receipt_by_narr(conn: Connection, narration: str, *, reverse_ledger: bool = True) -> None:
    """
    NEW behaviour (fixes D-06): used when the SOURCE document (seva/donation) is
    CANCELLED rather than deleted. Marks the receipt Cancelled='Y' and, if
    `reverse_ledger` is set, posts a reversing GL entry instead of silently
    leaving the original income entry live (which is what the legacy app does).
    """
    row = conn.execute(sql_text("SELECT RCPTVCHID, RCPTVCHNO, RCPTVCHDate FROM TrnHdrRCPTVCH WHERE NARR = :n AND Cancelled = 'N'"), {"n": narration}).mappings().first()
    if row is None:
        return
    update_row(conn, "TrnHdrRCPTVCH", "RCPTVCHID", row["RCPTVCHID"], {"Cancelled": "Y"})
    if reverse_ledger:
        ledger.reverse(
            conn,
            doc_type="RCPTVCH",
            trn_no=row["RCPTVCHNO"],
            trn_id=row["RCPTVCHID"],
            trn_date=row["RCPTVCHDate"],
            narration=f"Cancelled: {narration}",
        )
