"""
Credit Note (1250), Debit Note (1252) and Contra Voucher (1253): the same Dr/Cr account-head voucher as the Journal
Voucher (`journal.py`), each in its own tables. Their header / footer fields (VCHTYP, narration, cheque / card ...)
come from the temple's Doc Designer through `voucher_fields.header_columns`, exactly like Payment / Receipt / Journal.
One parametrised implementation instead of three copies: `SPECS` names the per-document pieces.
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
from app.meta.numbering import next_doc_no
from app.services import ledger, voucher_fields
from app.utils.amount_in_words import amount_in_words


@dataclass(frozen=True)
class Spec:
    kind: str  # URL / key
    doc_id: int
    name: str  # for audit + messages
    short: str  # table suffix, e.g. CRDNT
    doc_type: str  # ledger DocType


SPECS = {
    "credit-notes": Spec("credit-notes", 1250, "Credit Note", "CRDNT", "CRDNT"),
    "debit-notes": Spec("debit-notes", 1252, "Debit Note", "DBTNT", "DBTNT"),
    "contra": Spec("contra", 1253, "Contra Voucher", "CNTVCH", "CNTVCH"),
}


@dataclass
class VoucherLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


@dataclass
class VoucherInput:
    prefix: str
    voucher_date: date
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    lines: list[VoucherLine]


def _validate(data: VoucherInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.voucher_date, fy)
    if len(data.lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)
    if total_dr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")


def create(conn: Connection, spec: Spec, *, data: VoucherInput, fy: FinancialYear, user_code: str) -> dict:
    s = spec.short
    _validate(data, fy)
    header, values = voucher_fields.header_columns(conn, spec.doc_id, f"TrnHdr{s}", data.fields)
    narration = str(values.get("NARR") or "")
    doc_no = next_doc_no(
        conn, table_name=f"TrnHdr{s}", no_column=f"{s}NO", prefix=data.prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)
    vid = insert_row(
        conn,
        f"TrnHdr{s}",
        {
            f"{s}NO": doc_no, "Prefix": data.prefix, f"Print{s}NO": doc_no, f"{s}Date": data.voucher_date,
            "AddedBy": user_code, "AddedOn": datetime.now(), "Authorised": "Y", "Cancelled": "N",
            "AMTINWORDS": amount_in_words(total_dr, "Rupees", "Paise"), "TOTDR": total_dr, "TOTCR": total_cr,
            **header,
        },
        returning=f"{s}ID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn,
            f"TrnDtl{s}",
            {
                f"{s}ID": vid, "SlNo": i, "AcLedID": l.ac_led_id, f"{s}Amt": l.dr_amt or l.cr_amt, "CrAmt": l.cr_amt,
                "DrAmt": l.dr_amt, "AmtType": "DR" if l.dr_amt else "CR", "AgRefAmt": 0, "NewRefAmt": 0,
            },
        )
    ledger.post(
        conn, doc_type=spec.doc_type, trn_id=vid, trn_no=doc_no, trn_date=data.voucher_date, due_date=data.voucher_date,
        narration=narration,
        lines=[ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt) for l in data.lines],
    )
    audit.record(conn, entity=spec.name, entity_id=vid, action="A", user_code=user_code, details=doc_no)
    return {"voucher_id": vid, "voucher_no": doc_no, "amount": total_dr}


def list_recent(conn: Connection, spec: Spec, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    s = spec.short
    sql = f"SELECT {s}ID AS ID, {s}NO AS NO, Print{s}NO AS PrintNO, {s}Date AS VDate, NARR, TOTDR, Cancelled FROM TrnHdr{s} WHERE {s}Date BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += f" AND ({s}NO LIKE :q OR NARR LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY {s}ID DESC {limit_clause(top)}"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def cancel(conn: Connection, spec: Spec, *, voucher_id: int, reason: str, user_code: str) -> None:
    s = spec.short
    row = conn.execute(text(f"SELECT {s}NO AS NO, {s}Date AS VDate, Cancelled FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": voucher_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{spec.name} not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, f"TrnHdr{s}", f"{s}ID", voucher_id, {"Cancelled": "Y"})
    ledger.reverse(conn, doc_type=spec.doc_type, trn_no=row["NO"], trn_id=voucher_id, trn_date=row["VDate"], narration=f"Cancelled: {row['NO']}")
    audit.record(conn, entity=spec.name, entity_id=voucher_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, spec: Spec, *, voucher_id: int, user_code: str) -> None:
    s = spec.short
    row = conn.execute(text(f"SELECT {s}NO AS NO FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": voucher_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{spec.name} not found")
    ledger.delete_posting(conn, doc_type=spec.doc_type, trn_no=row["NO"], trn_id=voucher_id)
    conn.execute(text(f"DELETE FROM TrnDtl{s} WHERE {s}ID = :id"), {"id": voucher_id})
    conn.execute(text(f"DELETE FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": voucher_id})
    audit.record(conn, entity=spec.name, entity_id=voucher_id, action="D", user_code=user_code)
