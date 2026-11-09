"""
Journal Voucher service — port of `frmTrnVch` (Journal variant, DocID 1254).

Legacy screen (doc 07 §5.6) is a full Dr/Cr GRID — any number of account-head
lines, each independently Dr or Cr, not a fixed "one ledger paid, one cash/
bank ledger" pair. Previously hardcoded to exactly 2 lines (caught 2026-09-29
against a client complaint that the web app doesn't match the Windows app);
`lines` now accepts any number, same "Debit and Credit totals are NOT
matching!" balance rule the legacy form enforces.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, update_row
from app.meta import edit_rules
from app.meta.numbering import next_doc_no, print_doc_no
from app.services import ledger, voucher_fields, voucher_rules
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1254
TABLE = "TrnHdrJNRVCH"
NO_COLUMN = "JNRVCHNO"


@dataclass
class VoucherLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0
    adjustments: list = field(default_factory=list)  # bill-wise adjustments (services.bill_adjust)


@dataclass
class JournalVoucherInput:
    """The voucher's Header / Footer Designer fields keyed by FldCode (VCHTYP, NARR, cheque / card details ...)
    plus the Dr/Cr account-head lines."""

    prefix: str
    voucher_date: date
    fields: dict
    lines: list[VoucherLine]


def validate(data: JournalVoucherInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.voucher_date, fy)
    if len(data.lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)
    if total_dr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")


def create(conn: Connection, *, data: JournalVoucherInput, fy: FinancialYear, user_code: str) -> dict:
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.voucher_date = date.today()  # AllowEditDocDate = 'N': the legacy form locks the date to the system date
    validate(data, fy)
    voucher_rules.check_heads(conn, data.lines)
    header, values = voucher_fields.header_columns(conn, DOC_ID, TABLE, data.fields)
    narration = str(values.get("NARR") or "")

    doc_no = next_doc_no(
        conn,
        table_name=TABLE,
        no_column=NO_COLUMN,
        prefix=data.prefix,
        fy_start_year=fy.start_year,
        fy_start_date=fy.start_date.isoformat(),
        fy_end_date=fy.end_date.isoformat(),
    )
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)

    pmt_id = insert_row(
        conn,
        TABLE,
        {
            NO_COLUMN: doc_no,
            "Prefix": data.prefix,
            "PrintJNRVCHNO": print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=data.prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year),
            "JNRVCHDate": data.voucher_date,
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "Authorised": edit_rules.authorised_on_save(conn, DOC_ID),
            "Cancelled": "N",
            "AMTINWORDS": amount_in_words(total_dr, "Rupees", "Paise"),
            "TOTDR": total_dr,
            "TOTCR": total_cr,
            **header,
        },
        returning="JNRVCHID",
    )

    for i, line in enumerate(data.lines, start=1):
        insert_row(
            conn,
            "TrnDtlJNRVCH",
            {
                "JNRVCHID": pmt_id,
                "SlNo": i,
                "AcLedID": line.ac_led_id,
                "JNRVCHAmt": line.dr_amt or line.cr_amt,
                "CrAmt": line.cr_amt,
                "DrAmt": line.dr_amt,
                "AmtType": "DR" if line.dr_amt else "CR",
                "AgRefAmt": 0,
                "NewRefAmt": 0,
            },
        )

    ledger.post(
        conn,
        doc_type="JNRVCH",
        trn_id=pmt_id,
        trn_no=doc_no,
        trn_date=data.voucher_date,
        due_date=data.voucher_date,
        narration=narration,
        lines=[
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_line(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt, adjustments=getattr(l, "adjustments", None) or [])
            for l in data.lines
        ],
    )

    audit.record(conn, entity="Journal Voucher", entity_id=pmt_id, action="A", user_code=user_code, details=doc_no)
    return {"jnrvch_id": pmt_id, "jnrvch_no": doc_no, "amount": total_dr}


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = "SELECT JNRVCHID, JNRVCHNO, PrintJNRVCHNO, JNRVCHDate, NARR, TOTDR, Cancelled FROM TrnHdrJNRVCH WHERE JNRVCHDate BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (JNRVCHNO LIKE :q OR NARR LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY JNRVCHID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def cancel(conn: Connection, *, jnrvch_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT JNRVCHNO, JNRVCHDate, Cancelled FROM TrnHdrJNRVCH WHERE JNRVCHID = :id"), {"id": jnrvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journal Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, "TrnHdrJNRVCH", "JNRVCHID", jnrvch_id, {"Cancelled": "Y"})
    ledger.reverse(conn, doc_type="JNRVCH", trn_no=row["JNRVCHNO"], trn_id=jnrvch_id, trn_date=row["JNRVCHDate"], narration=f"Cancelled: {row['JNRVCHNO']}")
    audit.record(conn, entity="Journal Voucher", entity_id=jnrvch_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, jnrvch_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT JNRVCHNO, JNRVCHDate, Cancelled, Authorised FROM TrnHdrJNRVCH WHERE JNRVCHID = :id"), {"id": jnrvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journal Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Deletion not possible!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=row["JNRVCHDate"], authorised=row["Authorised"])
    ledger.delete_posting(conn, doc_type="JNRVCH", trn_no=row["JNRVCHNO"], trn_id=jnrvch_id)
    conn.execute(text("DELETE FROM TrnDtlJNRVCH WHERE JNRVCHID = :id"), {"id": jnrvch_id})
    voucher_rules.delete_bill_det(conn, "TrnDtlJNRVCH", "JNRVCHID", jnrvch_id)
    conn.execute(text("DELETE FROM TrnHdrJNRVCH WHERE JNRVCHID = :id"), {"id": jnrvch_id})
    audit.record(conn, entity="Journal Voucher", entity_id=jnrvch_id, action="D", user_code=user_code)


def update(conn: Connection, *, jnrvch_id: int, data: JournalVoucherInput, fy: FinancialYear, user_code: str) -> dict:
    """Edit a saved journal voucher (legacy Mode "M"): number / prefix / added-by stay; header, lines and ledger posting are rewritten."""
    old = conn.execute(text("SELECT JNRVCHNO, JNRVCHDate, Cancelled, Authorised FROM TrnHdrJNRVCH WHERE JNRVCHID = :id"), {"id": jnrvch_id}).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journal Voucher not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=old["JNRVCHDate"], authorised=old["Authorised"])
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.voucher_date = old["JNRVCHDate"].date() if isinstance(old["JNRVCHDate"], datetime) else old["JNRVCHDate"]  # date stays as saved
    validate(data, fy)
    voucher_rules.check_heads(conn, data.lines)
    header, values = voucher_fields.header_columns(conn, DOC_ID, TABLE, data.fields)
    narration = str(values.get("NARR") or "")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)

    cols = {
        "JNRVCHDate": data.voucher_date, "AMTINWORDS": amount_in_words(total_dr, "Rupees", "Paise"), "TOTDR": total_dr, "TOTCR": total_cr,
        "ChangedBy": user_code, "ChangedOn": datetime.now(), **header,
    }
    if edit_rules.auth_required(conn, DOC_ID):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation (legacy: Authorised = 'N' on edit)
    update_row(conn, TABLE, "JNRVCHID", jnrvch_id, cols)

    ledger.delete_posting(conn, doc_type="JNRVCH", trn_no=old["JNRVCHNO"], trn_id=jnrvch_id)
    conn.execute(text("DELETE FROM TrnDtlJNRVCH WHERE JNRVCHID = :id"), {"id": jnrvch_id})
    voucher_rules.delete_bill_det(conn, "TrnDtlJNRVCH", "JNRVCHID", jnrvch_id)
    for i, line in enumerate(data.lines, start=1):
        insert_row(
            conn,
            "TrnDtlJNRVCH",
            {"JNRVCHID": jnrvch_id, "SlNo": i, "AcLedID": line.ac_led_id, "JNRVCHAmt": line.dr_amt or line.cr_amt, "CrAmt": line.cr_amt, "DrAmt": line.dr_amt,
             "AmtType": "DR" if line.dr_amt else "CR", "AgRefAmt": 0, "NewRefAmt": 0},
        )
    ledger.post(
        conn, doc_type="JNRVCH", trn_id=jnrvch_id, trn_no=old["JNRVCHNO"], trn_date=data.voucher_date, due_date=data.voucher_date, narration=narration,
        lines=[ledger.JournalLine(ac_led_id=ledger.acled_id_for_line(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt, adjustments=getattr(l, "adjustments", None) or []) for l in data.lines],
    )
    audit.record(conn, entity="Journal Voucher", entity_id=jnrvch_id, action="E", user_code=user_code, details=old["JNRVCHNO"])
    return {"jnrvch_id": jnrvch_id, "jnrvch_no": old["JNRVCHNO"], "amount": total_dr}
