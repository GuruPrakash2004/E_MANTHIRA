"""
Receipt-voucher creation — port of `SaveRcptVch` (present, with small
variations, in frmTrnSeva, frmTrnDONREC and frmTrnHBE). See doc 07 §6.2.

Every Seva / Donation / Hall-booking payment that should hit the books goes
through this ONE function so the write-set (columns, GL posting, numbering)
never drifts between screens.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text as sql_text
from sqlalchemy.engine import Connection

from app.core.fy import FinancialYear
from app.legacy.tables import insert_row, update_row
from app.meta import edit_rules
from app.meta.numbering import next_receipt_no, print_doc_no
from app.services import ledger, voucher_fields, voucher_rules
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
    adjustments: list = field(default_factory=list)  # bill-wise adjustments (services.bill_adjust)


def _check_lines(conn: Connection, fy: FinancialYear, voucher_date: date, lines: list) -> None:
    """The legacy Receipt Voucher checks: date in the financial year, two or more lines, an amount, Dr = Cr, active heads."""
    from app.core.fy import assert_date_in_fy

    assert_date_in_fy(voucher_date, fy)
    if len(lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in lines), 2)
    total_cr = round(sum(l.cr_amt for l in lines), 2)
    if total_cr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")
    voucher_rules.check_heads(conn, lines)


def create_receipt_voucher(
    conn: Connection,
    *,
    fy: FinancialYear,
    prefix: str,
    receipt_date: date,
    fields: dict,  # Header / Footer Designer fields of DocID 1248 keyed by FldCode (VCHTYP, NARR, cheque / card ...)
    lines: list[VoucherLine],
    user_code: str = "",
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
    if not edit_rules.doc_date_editable(conn, 1248):
        receipt_date = date.today()  # AllowEditDocDate = 'N': the legacy form locks the date to the system date
    _check_lines(conn, fy, receipt_date, lines)
    total_dr = round(sum(l.dr_amt for l in lines), 2)
    total_cr = round(sum(l.cr_amt for l in lines), 2)
    header, values = voucher_fields.header_columns(conn, 1248, "TrnHdrRCPTVCH", fields)
    narration = str(values.get("NARR") or "")

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
            "PrintRCPTVCHNO": print_doc_no(conn, doc_id=1248, doc_no=receipt_no, prefix=prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year),
            "RCPTVCHDate": receipt_date,
            "AddedBy": user_code,
            "AddedOn": _datetime.now(),
            "Authorised": edit_rules.authorised_on_save(conn, 1248),
            "Cancelled": "N",
            "AMTINWORDS": amount_in_words(total_cr, "Rupees", "Paise"),
            "TOTDR": total_dr,
            "TOTCR": total_cr,
            **header,
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
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_line(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt, adjustments=getattr(l, "adjustments", None) or [])
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
    dr_parts: list[tuple[int, float]] | None = None,  # split payment: [(cash/bank ledger, amount), ...] instead of dr_led_id; one Dr line each
) -> ReceiptResult:
    parts = [(int(l), float(a)) for l, a in dr_parts] if dr_parts else [(int(dr_led_id), float(amount))]
    if any(int(cr_led_id) == l for l, _a in parts):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "The Ledger Name (income) and the Cash or Bank Account are the same ledger - choose a different Cash or Bank Account.",
        )
    receipt_no = next_receipt_no(
        conn, prefix=prefix, fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat()
    )
    amount = round(float(amount), 2)
    parts = [(l, round(a, 2)) for l, a in parts]
    if abs(sum(a for _l, a in parts) - amount) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The split amounts must add up to the receipt amount")
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
            "CHQDT": datetime(1900, 1, 1),  # legacy: 1900-01-01 for "no cheque"
            "CHQAMT": " ",
            "CARDNO": "0",
            "CRDAMT": 0,
            "CHQNO": " ",
            "BANK": 0,
            "AMTINWORDS": amount_in_words(amount, "Rupees", "Paise", raw=True),  # the EXE writes this one uncleaned
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
    for n, (dr_led, dr_amt) in enumerate(parts, start=2):  # one debit line per cash / bank ledger (a single one unless the payment is split)
        insert_row(
            conn,
            "TrnDtlRCPTVCH",
            {"RCPTVCHID": receipt_id, "SlNo": n, "AcLedID": dr_led, "RCPTVCHAmt": dr_amt, "CrAmt": 0, "DrAmt": dr_amt, "AmtType": "DR", "AgRefAmt": 0, "NewRefAmt": 0},
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
            *[ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, dr_led), dr_amt=dr_amt, cr_amt=0) for dr_led, dr_amt in parts],
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
    voucher_rules.assert_not_hall_receipt(conn, receipt_id)
    update_row(conn, "TrnHdrRCPTVCH", "RCPTVCHID", receipt_id, {"Cancelled": "Y"})
    ledger.reverse(conn, doc_type="RCPTVCH", trn_no=row["RCPTVCHNO"], trn_id=receipt_id, trn_date=row["RCPTVCHDate"], narration=f"Cancelled: {row['NARR']}")


def delete_by_id(conn: Connection, *, receipt_id: int) -> None:
    row = conn.execute(sql_text("SELECT RCPTVCHNO, RCPTVCHDate, Cancelled, Authorised FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Deletion not possible!")
    edit_rules.assert_editable(conn, 1248, doc_date=row["RCPTVCHDate"], authorised=row["Authorised"])
    voucher_rules.assert_not_hall_receipt(conn, receipt_id)
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


def update_receipt_voucher(
    conn: Connection, *, receipt_id: int, fy: FinancialYear, receipt_date: date, fields: dict, lines: list[VoucherLine], user_code: str = ""
) -> ReceiptResult:
    """Edit a saved Receipt Voucher (legacy Mode "M"): number / prefix / added-by stay, header + lines + ledger posting are rewritten."""
    from datetime import datetime as _datetime

    old = conn.execute(
        sql_text("SELECT RCPTVCHNO, RCPTVCHDate, Cancelled, Authorised FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id}
    ).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt Voucher not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, 1248, doc_date=old["RCPTVCHDate"], authorised=old["Authorised"])
    voucher_rules.assert_not_hall_receipt(conn, receipt_id)
    if not edit_rules.doc_date_editable(conn, 1248):
        receipt_date = old["RCPTVCHDate"].date() if isinstance(old["RCPTVCHDate"], _datetime) else old["RCPTVCHDate"]  # date stays as saved
    _check_lines(conn, fy, receipt_date, lines)
    header, values = voucher_fields.header_columns(conn, 1248, "TrnHdrRCPTVCH", fields)
    narration = str(values.get("NARR") or "")
    total_dr = round(sum(l.dr_amt for l in lines), 2)
    total_cr = round(sum(l.cr_amt for l in lines), 2)

    cols = {
        "RCPTVCHDate": receipt_date, "AMTINWORDS": amount_in_words(total_cr, "Rupees", "Paise"), "TOTDR": total_dr, "TOTCR": total_cr,
        "ChangedBy": user_code, "ChangedOn": _datetime.now(), **header,
    }
    if edit_rules.auth_required(conn, 1248):
        cols["Authorised"] = "N"
    update_row(conn, "TrnHdrRCPTVCH", "RCPTVCHID", receipt_id, cols)

    ledger.delete_posting(conn, doc_type="RCPTVCH", trn_no=old["RCPTVCHNO"], trn_id=receipt_id)
    conn.execute(sql_text("DELETE FROM TrnDtlRCPTVCH WHERE RCPTVCHID = :id"), {"id": receipt_id})
    for i, line in enumerate(lines, start=1):
        insert_row(
            conn,
            "TrnDtlRCPTVCH",
            {"RCPTVCHID": receipt_id, "SlNo": i, "AcLedID": line.ac_led_id, "RCPTVCHAmt": line.dr_amt or line.cr_amt, "CrAmt": line.cr_amt, "DrAmt": line.dr_amt,
             "AmtType": "CR" if line.cr_amt else "DR", "AgRefAmt": 0, "NewRefAmt": 0},
        )
    ledger.post(
        conn, doc_type="RCPTVCH", trn_id=receipt_id, trn_no=old["RCPTVCHNO"], trn_date=receipt_date, due_date=receipt_date, narration=narration,
        lines=[ledger.JournalLine(ac_led_id=ledger.acled_id_for_line(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt, adjustments=getattr(l, "adjustments", None) or []) for l in lines],
    )
    return ReceiptResult(receipt_id=receipt_id, receipt_no=old["RCPTVCHNO"])
