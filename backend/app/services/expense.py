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

from dataclasses import dataclass, field
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, update_row
from app.meta.numbering import next_doc_no

DOC_ID = 1260
TABLE = "TrnHdrEXP"
NO_COLUMN = "EXPNO"
PAYMENT_MODES = ("Cash", "Card", "Online", "Cheque")


@dataclass
class ExpenseLine:
    led_id: int
    amount: float
    item_desc: str = ""
    remarks: str = ""


@dataclass
class ExpenseInput:
    prefix: str
    expense_date: date
    payment_mode: str
    lines: list[ExpenseLine]
    ref_no: str = ""
    remarks: str = ""
    cheque_no: str = ""
    cheque_date: date | None = None
    cheque_amount: float | None = None
    bank_name: str = ""
    extra_fields: dict = field(default_factory=dict)


def validate(data: ExpenseInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.expense_date, fy)
    if data.payment_mode not in PAYMENT_MODES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payment Mode is mandatory")
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one expense line")
    for l in data.lines:
        if not l.led_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Every line needs a ledger")
        if l.amount is None or l.amount <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")


def create(conn: Connection, *, data: ExpenseInput, fy: FinancialYear, user_code: str) -> dict:
    validate(data, fy)
    doc_no = next_doc_no(
        conn, table_name=TABLE, no_column=NO_COLUMN, prefix=data.prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    total = round(sum(l.amount for l in data.lines), 2)
    is_cheque = data.payment_mode == "Cheque"
    exp_id = insert_row(
        conn, TABLE,
        {
            NO_COLUMN: doc_no, "Prefix": data.prefix, "PrintEXPNO": doc_no, "EXPDate": data.expense_date,
            "AddedBy": user_code, "AddedOn": datetime.now(), "Authorised": "Y", "Cancelled": "N",
            "REFNO": data.ref_no, "PAYMNTMODE": data.payment_mode, "RMKS": data.remarks, "TOTAMT": total,
            # cheque block is hidden (and left empty) unless Payment Mode = Cheque
            "CHEQUENO": data.cheque_no if is_cheque else "",
            "CHEQUEDT": data.cheque_date if is_cheque else None,
            "CHEQUEAMT": (data.cheque_amount or 0) if is_cheque else 0,
            "BANKNAME": data.bank_name if is_cheque else "",
            **data.extra_fields,
        },
        returning="EXPID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn, "TrnDtlEXP",
            {"EXPID": exp_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0,
             "LEDID": l.led_id, "ITEMDESC": l.item_desc, "AMOUNT": l.amount, "DRMKS": l.remarks},
        )
    audit.record(conn, entity="Expense Entry", entity_id=exp_id, action="A", user_code=user_code, details=doc_no)
    return {"exp_id": exp_id, "exp_no": doc_no, "total_amt": total}


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT EXPID, EXPNO, PrintEXPNO, EXPDate, PAYMNTMODE, RMKS, TOTAMT, Cancelled FROM {TABLE} WHERE EXPDate BETWEEN :fs AND :fe"
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
