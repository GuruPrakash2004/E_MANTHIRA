"""
Payment Voucher service — port of `frmTrnVch` (Payment variant, DocID 1224).

Legacy screen (doc 07 §5.6) is a full Dr/Cr GRID — any number of account-head
lines, each independently Dr or Cr, not a fixed "one ledger paid, one cash/
bank ledger" pair. Previously hardcoded to exactly 2 lines (caught 2026-09-29
against a client complaint that the web app doesn't match the Windows app);
`lines` now accepts any number, same "Debit and Credit totals are NOT
matching!" balance rule the legacy form enforces.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, update_row
from app.meta import edit_rules
from app.meta.numbering import next_doc_no
from app.services import ledger, voucher_fields, voucher_rules
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1224
TABLE = "TrnHdrPMTVCH"
NO_COLUMN = "PMTVCHNO"


@dataclass
class VoucherLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


@dataclass
class PaymentVoucherInput:
    """The voucher's Header / Footer Designer fields keyed by FldCode (VCHTYP, NARR, cheque / card details ...)
    plus the Dr/Cr account-head lines."""

    prefix: str
    voucher_date: date
    fields: dict
    lines: list[VoucherLine]


def validate(data: PaymentVoucherInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.voucher_date, fy)
    if len(data.lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)
    if total_dr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")


def create(conn: Connection, *, data: PaymentVoucherInput, fy: FinancialYear, user_code: str) -> dict:
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
            "PrintPMTVCHNO": doc_no,
            "PMTVCHDate": data.voucher_date,
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "Authorised": edit_rules.authorised_on_save(conn, DOC_ID),
            "Cancelled": "N",
            "AMTINWORDS": amount_in_words(total_dr, "Rupees", "Paise"),
            "TOTDR": total_dr,
            "TOTCR": total_cr,
            **header,
        },
        returning="PMTVCHID",
    )

    for i, line in enumerate(data.lines, start=1):
        insert_row(
            conn,
            "TrnDtlPMTVCH",
            {
                "PMTVCHID": pmt_id,
                "SlNo": i,
                "AcLedID": line.ac_led_id,
                "PMTVCHAmt": line.dr_amt or line.cr_amt,
                "CrAmt": line.cr_amt,
                "DrAmt": line.dr_amt,
                "AmtType": "DR" if line.dr_amt else "CR",
                "AgRefAmt": 0,
                "NewRefAmt": 0,
            },
        )

    ledger.post(
        conn,
        doc_type="PMTVCH",
        trn_id=pmt_id,
        trn_no=doc_no,
        trn_date=data.voucher_date,
        due_date=data.voucher_date,
        narration=narration,
        lines=[
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt)
            for l in data.lines
        ],
    )

    audit.record(conn, entity="Payment Voucher", entity_id=pmt_id, action="A", user_code=user_code, details=doc_no)
    return {"pmtvch_id": pmt_id, "pmtvch_no": doc_no, "amount": total_dr}


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = "SELECT PMTVCHID, PMTVCHNO, PrintPMTVCHNO, PMTVCHDate, NARR, TOTDR, Cancelled FROM TrnHdrPMTVCH WHERE PMTVCHDate BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (PMTVCHNO LIKE :q OR NARR LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY PMTVCHID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def cancel(conn: Connection, *, pmtvch_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT PMTVCHNO, PMTVCHDate, Cancelled FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, "TrnHdrPMTVCH", "PMTVCHID", pmtvch_id, {"Cancelled": "Y"})
    ledger.reverse(conn, doc_type="PMTVCH", trn_no=row["PMTVCHNO"], trn_id=pmtvch_id, trn_date=row["PMTVCHDate"], narration=f"Cancelled: {row['PMTVCHNO']}")
    audit.record(conn, entity="Payment Voucher", entity_id=pmtvch_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, pmtvch_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT PMTVCHNO, PMTVCHDate, Cancelled, Authorised FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Deletion not possible!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=row["PMTVCHDate"], authorised=row["Authorised"])
    ledger.delete_posting(conn, doc_type="PMTVCH", trn_no=row["PMTVCHNO"], trn_id=pmtvch_id)
    conn.execute(text("DELETE FROM TrnDtlPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id})
    conn.execute(text("DELETE FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id})
    audit.record(conn, entity="Payment Voucher", entity_id=pmtvch_id, action="D", user_code=user_code)


def update(conn: Connection, *, pmtvch_id: int, data: PaymentVoucherInput, fy: FinancialYear, user_code: str) -> dict:
    """
    Edit a saved payment voucher (legacy Mode "M"). The number, prefix and who/when it was added stay; the header, the
    lines and the ledger posting are rewritten for the new values, in one transaction.
    """
    old = conn.execute(
        text("SELECT PMTVCHNO, PrintPMTVCHNO, PMTVCHDate, Cancelled, Authorised FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id}
    ).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment Voucher not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=old["PMTVCHDate"], authorised=old["Authorised"])
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.voucher_date = old["PMTVCHDate"].date() if isinstance(old["PMTVCHDate"], datetime) else old["PMTVCHDate"]  # date stays as saved
    validate(data, fy)
    voucher_rules.check_heads(conn, data.lines)
    header, values = voucher_fields.header_columns(conn, DOC_ID, TABLE, data.fields)
    narration = str(values.get("NARR") or "")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)

    cols = {
        "PMTVCHDate": data.voucher_date, "AMTINWORDS": amount_in_words(total_dr, "Rupees", "Paise"), "TOTDR": total_dr, "TOTCR": total_cr,
        "ChangedBy": user_code, "ChangedOn": datetime.now(), **header,
    }
    if edit_rules.auth_required(conn, DOC_ID):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation (legacy: Authorised = 'N' on edit)
    update_row(conn, TABLE, "PMTVCHID", pmtvch_id, cols)

    ledger.delete_posting(conn, doc_type="PMTVCH", trn_no=old["PMTVCHNO"], trn_id=pmtvch_id)
    conn.execute(text("DELETE FROM TrnDtlPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id})
    for i, line in enumerate(data.lines, start=1):
        insert_row(
            conn,
            "TrnDtlPMTVCH",
            {"PMTVCHID": pmtvch_id, "SlNo": i, "AcLedID": line.ac_led_id, "PMTVCHAmt": line.dr_amt or line.cr_amt, "CrAmt": line.cr_amt, "DrAmt": line.dr_amt,
             "AmtType": "DR" if line.dr_amt else "CR", "AgRefAmt": 0, "NewRefAmt": 0},
        )
    ledger.post(
        conn, doc_type="PMTVCH", trn_id=pmtvch_id, trn_no=old["PMTVCHNO"], trn_date=data.voucher_date, due_date=data.voucher_date, narration=narration,
        lines=[ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt) for l in data.lines],
    )
    audit.record(conn, entity="Payment Voucher", entity_id=pmtvch_id, action="E", user_code=user_code, details=old["PMTVCHNO"])
    return {"pmtvch_id": pmtvch_id, "pmtvch_no": old["PMTVCHNO"], "amount": total_dr}
