"""
Expense Entry — DocID 1260, `TrnHdrEXP` / `TrnDtlEXP` (port of the generic `frmTrnNonPartyNonItem` form).

Write-set confirmed from the decompiled form (`UpdtDocHdrDtl` / `GetDetSqlString`) and `UtlTransactions`:
  - header: doc no, Prefix, PrintEXPNO, EXPDate, AddedBy/AddedOn, Authorised ('Y' because AuthReq='N'),
    Cancelled 'N', plus the designer fields (REFNO, PAYMNTMODE, RMKS, cheque fields, TOTAMT);
  - detail: one row per grid line (SlNo, ItemSlNO + LEDID, ITEMDESC, AMOUNT, DRMKS);
  - `UtlTransactions.AccTrn = 'N'` -> NO receipt voucher and NO GL posting (unlike Seva/Donation).
Rules from `UtlDocDsgrFlds`: Payment Mode is mandatory (list Cash|Card|Online|Cheque, default Cash), Amount is
mandatory per line, cheque fields apply only when Payment Mode = Cheque, Total Amount = SUM(Amount).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, table, update_row, pad_blanks
from app.meta import doc_rules, edit_rules
from app.meta.numbering import next_doc_no, print_doc_no

DOC_ID = 1260
TABLE = "TrnHdrEXP"
NO_COLUMN = "EXPNO"


@dataclass
class ExpenseInput:
    """Header / Footer Designer fields keyed by FldCode (PAYMNTMODE, REFNO, RMKS, cheque block ...) and the Detail
    lines (LEDID, ITEMDESC, AMOUNT, DRMKS), all as configured in UtlDocDsgrFlds."""

    prefix: str
    expense_date: date
    fields: dict
    lines: list[dict]


COMPUTED = ("TOTAMT",)


def _amount(line: dict) -> float:
    try:
        return round(float(line.get("AMOUNT") or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Amount must be a number")


def _check(conn: Connection, data: ExpenseInput, fy: FinancialYear):
    """The Designer's own rules for a header + lines; returns (rows, values, head, detail, total)."""
    assert_date_in_fy(data.expense_date, fy)
    rows = doc_rules.load_fields(conn, DOC_ID)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Expense Entry has no fields configured in the Doc Designer")
    values = doc_rules.effective_values(rows, {k: v for k, v in data.fields.items() if k not in COMPUTED})
    head = [r for r in rows if (r.get("FldSection") or "Header") in ("Header", "Footer")]
    detail = [r for r in rows if r.get("FldSection") == "Detail"]
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one expense line")
    doc_rules.validate(head, values, skip=COMPUTED, fy=fy)
    doc_rules.check_duplicate_lines(detail, data.lines)
    for i, l in enumerate(data.lines, start=1):
        try:
            doc_rules.validate(detail, {**values, **l})
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f"Line {i}: {exc.detail}")
        if _amount(l) <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    total = round(sum(_amount(l) for l in data.lines), 2)
    return rows, values, head, detail, total


def _blanks(cols: dict) -> None:
    """What the EXE writes for blanks (checked on 29 legacy rows in two temples): ' ' for text, NULL for no cheque date, 0 for no amount."""
    pad_blanks(cols, keep=("CHEQUEDT", "RMKS_XML", "Prefix"))
    if not str(cols.get("CHEQUEDT") or "").strip() or str(cols["CHEQUEDT"]).startswith("1900-01-01"):
        cols["CHEQUEDT"] = None
    if cols.get("CHEQUEAMT") in (None, "", " "):
        cols["CHEQUEAMT"] = 0


def _write_lines(conn: Connection, exp_id: int, detail: list[dict], lines: list[dict]) -> None:
    for i, l in enumerate(lines, start=1):
        lv = doc_rules.effective_values(detail, l)
        dcols = doc_rules.column_values(detail, lv, table("TrnDtlEXP"))
        dcols.update({"EXPID": exp_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0, "AMOUNT": _amount(l)})
        pad_blanks(dcols, keep=("ITEMDESC_XML", "DRMKS_XML"))
        insert_row(conn, "TrnDtlEXP", dcols)


def create(conn: Connection, *, data: ExpenseInput, fy: FinancialYear, user_code: str) -> dict:
    rows, values, head, detail, total = _check(conn, data, fy)

    doc_no = next_doc_no(
        conn, table_name=TABLE, no_column=NO_COLUMN, prefix=data.prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    cols = doc_rules.column_values(head, values, table(TABLE))
    cols.update(
        {
            NO_COLUMN: doc_no, "Prefix": data.prefix, "PrintEXPNO": print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=data.prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year),
            "EXPDate": data.expense_date,
            "AddedBy": user_code, "AddedOn": datetime.now(), "Authorised": "Y", "Cancelled": "N", "TOTAMT": total,
        }
    )
    _blanks(cols)
    exp_id = insert_row(conn, TABLE, cols, returning="EXPID")
    _write_lines(conn, exp_id, detail, data.lines)
    audit.record(conn, entity="Expense Entry", entity_id=exp_id, action="A", user_code=user_code, details=doc_no)
    return {"exp_id": exp_id, "exp_no": doc_no, "total_amt": total}


def update(conn: Connection, *, exp_id: int, data: ExpenseInput, fy: FinancialYear, user_code: str) -> dict:
    """
    Edit a saved expense: the number (EXPNO / Prefix / PrintEXPNO) and who/when it was added stay as they are; the header and the lines
    are rewritten for the new values. Nothing is posted to the ledger for an Expense Entry (AccTrn = 'N'), so that is all there is.
    """
    old = conn.execute(text(f"SELECT {NO_COLUMN}, PrintEXPNO, Cancelled, EXPDate, Authorised FROM {TABLE} WHERE EXPID = :id"), {"id": exp_id}).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense Entry not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=old["EXPDate"], authorised=old["Authorised"])
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.expense_date = old["EXPDate"].date() if isinstance(old["EXPDate"], datetime) else old["EXPDate"]  # date stays as saved

    rows, values, head, detail, total = _check(conn, data, fy)
    cols = doc_rules.column_values(head, values, table(TABLE))
    for keep in (NO_COLUMN, "Prefix", "PrintEXPNO", "AddedBy", "AddedOn", "Cancelled"):
        cols.pop(keep, None)
    cols.update({"EXPDate": data.expense_date, "ChangedBy": user_code, "ChangedOn": datetime.now(), "TOTAMT": total})
    if edit_rules.auth_required(conn, DOC_ID):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation
    _blanks(cols)
    update_row(conn, TABLE, "EXPID", exp_id, cols)  # columns this database does not have are skipped by update_row
    conn.execute(text("DELETE FROM TrnDtlEXP WHERE EXPID = :id"), {"id": exp_id})
    _write_lines(conn, exp_id, detail, data.lines)
    audit.record(conn, entity="Expense Entry", entity_id=exp_id, action="E", user_code=user_code, details=old[NO_COLUMN])
    return {"exp_id": exp_id, "exp_no": old[NO_COLUMN], "print_no": old["PrintEXPNO"] or old[NO_COLUMN], "total_amt": total}


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT * FROM {TABLE} WHERE EXPDate BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (EXPNO LIKE :q OR RMKS LIKE :q OR REFNO LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY EXPID DESC {limit_clause(top)}"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def get(conn: Connection, *, exp_id: int) -> dict:
    hdr = conn.execute(text(f"SELECT * FROM {TABLE} WHERE EXPID = :id"), {"id": exp_id}).mappings().first()
    if hdr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense Entry not found")
    lines = conn.execute(text("SELECT * FROM TrnDtlEXP WHERE EXPID = :id ORDER BY SlNo"), {"id": exp_id}).mappings().all()
    return {"header": dict(hdr), "lines": [dict(l) for l in lines]}


def cancel(conn: Connection, *, exp_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text(f"SELECT Cancelled FROM {TABLE} WHERE EXPID = :id"), {"id": exp_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense Entry not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    # No GL / receipt was ever posted for an Expense Entry (AccTrn = 'N'), so cancelling is only the flag.
    update_row(conn, TABLE, "EXPID", exp_id, {"Cancelled": "Y", "ChangedBy": user_code, "ChangedOn": datetime.now()})
    audit.record(conn, entity="Expense Entry", entity_id=exp_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, exp_id: int, user_code: str) -> None:
    if conn.execute(text(f"SELECT 1 FROM {TABLE} WHERE EXPID = :id"), {"id": exp_id}).first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense Entry not found")
    conn.execute(text("DELETE FROM TrnDtlEXP WHERE EXPID = :id"), {"id": exp_id})
    conn.execute(text(f"DELETE FROM {TABLE} WHERE EXPID = :id"), {"id": exp_id})
    audit.record(conn, entity="Expense Entry", entity_id=exp_id, action="D", user_code=user_code)
