"""
Hall Booking Entry — DocID 1280, table `TrnHdrHBE`/`TrnDtlHBE`. Confirmed
distinct from the already-built Hall Booking (DocID 1281/`TrnHdrHB`, which
posts to the GL via a LEDID/LEDGER ac-head pair): this screen's schema has
no ledger columns at all, just a flat receipt — amount, GST, advance,
security deposit, net pay — so it's a standalone receipt, not a voucher-
generating document. `UtlDocDsgrFlds` confirms the real field layout used
below (Header/Detail/Footer/Total sections, read from the live DB).

The `TYPE` field selects which of the two real `UtlDocNoPrefix` rows for
this DocID applies — this one form covers two purposes:
  - 'HALL BOOKING'  -> prefix HB (a hall receipt without the full GL flow)
  - 'CARPUS FUND'   -> prefix CF (a corpus-fund donation receipt)

Zero real rows in this client's data (confirmed: `SELECT COUNT(*) FROM
TrnHdrHBE` = 0) — built anyway per explicit request, faithfully against the
real schema, same spirit as `app/services/inventory.py`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row
from app.meta.numbering import next_doc_no
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1280
TABLE = "TrnHdrHBE"
NO_COLUMN = "HBENO"


def _prefix_for_type(doc_type: str) -> str:
    return "CF" if (doc_type or "").strip().upper() == "CARPUS FUND" else "HB"


@dataclass
class HbeLine:
    name_of_hall: str
    amount: float
    rate: float = 0
    hrs: float = 0


@dataclass
class HbeInput:
    type: str  # 'HALL BOOKING' | 'CARPUS FUND'
    hb_start_dt: date
    hb_end_dt: date
    start_time: str = ""
    end_time: str = ""
    name_of_func: str = ""
    contact_person: str = ""
    contact_no: str = ""
    mobile_no: str = ""
    address: str = ""
    payment_mode: str = "Cash"
    reference_no: str = ""
    email_id: str = ""
    pan: str = ""
    cgst: float = 0
    sgst: float = 0
    security_deposit_amt: float = 0
    advance_amt: float = 0
    bank: str = ""
    cash_cheque_no: str = ""
    receipt_date: date | None = None
    remarks: str = ""
    issued_by: str = ""
    lines: list[HbeLine] = None


def create_hbe(conn: Connection, *, data: HbeInput, fy: FinancialYear, user_code: str) -> dict:
    assert_date_in_fy(data.hb_start_dt, fy)
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one item line")
    for l in data.lines:
        if l.amount <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if not data.contact_no:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Contact Number is mandatory")

    prefix = _prefix_for_type(data.type)
    doc_no = next_doc_no(
        conn, table_name=TABLE, no_column=NO_COLUMN, prefix=prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )

    total_amt = round(sum(l.amount for l in data.lines), 2)
    tot_gst_amt = round((data.cgst or 0) + (data.sgst or 0), 2)
    amt_after_tax = round(total_amt + tot_gst_amt, 2)
    net_pay = round(amt_after_tax - (data.security_deposit_amt or 0) - (data.advance_amt or 0), 2)
    amt_in_words = amount_in_words(net_pay)

    hbe_id = insert_row(
        conn, TABLE,
        {
            NO_COLUMN: doc_no, "Prefix": prefix, "PrintHBENO": doc_no, "HBEDate": datetime.now(),
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "TYPE": data.type, "NMEOFFUNC": data.name_of_func,
            "HBSTARTDT": data.hb_start_dt, "STTIME": data.start_time, "HBENDDT": data.hb_end_dt, "ENDTIME": data.end_time,
            "CONPRS": data.contact_person, "CONTACTNO": data.contact_no,
            # SECCONTNO is `numeric` in the real DB despite its "Mobile No" caption.
            "SECCONTNO": int(data.mobile_no) if (data.mobile_no or "").strip().isdigit() else 0,
            "ADDRESS": data.address, "PAYMNTMODE": data.payment_mode, "REFNO": data.reference_no,
            "EMAILID": data.email_id, "PAN": data.pan,
            "TOTAMT": total_amt, "CGSTAMT": data.cgst or 0, "SGSTAMT": data.sgst or 0, "TOTGSTAMT": tot_gst_amt,
            "AMTAFTTAX": amt_after_tax, "SDEPAMT": data.security_deposit_amt or 0, "ADV": data.advance_amt or 0,
            "NETPAY": net_pay, "BANK": data.bank, "CASHCHEQ": data.cash_cheque_no,
            "RCPDT": data.receipt_date or data.hb_start_dt, "RMKS": data.remarks, "ISSUEDBY": data.issued_by or user_code,
            "AMTINWORDS": amt_in_words, "TOTAMTIWRDS": amt_in_words,
        },
        returning="HBEID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn, "TrnDtlHBE",
            {
                "HBEID": hbe_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0,
                "NAMEOFHALL": l.name_of_hall, "AMOUNT": l.amount, "RATE": l.rate or 0, "HRS": l.hrs or 0,
            },
        )

    audit.record(conn, entity="Hall Booking Entry", entity_id=hbe_id, action="A", user_code=user_code, details=doc_no)
    return {"hbe_id": hbe_id, "hbe_no": doc_no, "total_amt": total_amt, "net_pay": net_pay}


def list_hbe(conn: Connection, *, fy: FinancialYear, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = (
        f"SELECT HBEID, HBENO, PrintHBENO, HBEDate, TYPE, NMEOFFUNC, CONTACTNO, TOTAMT, NETPAY, Cancelled "
        f"FROM {TABLE} WHERE HBEDate BETWEEN :fs AND :fe ORDER BY HBEID DESC {limit_clause(top)}"
    )
    rows = conn.execute(text(sql), {"fs": fy.start_date, "fe": fy.end_date}).mappings().all()
    return [dict(r) for r in rows]


def get_hbe(conn: Connection, *, hbe_id: int) -> dict:
    hdr = conn.execute(text(f"SELECT * FROM {TABLE} WHERE HBEID = :id"), {"id": hbe_id}).mappings().first()
    if hdr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall Booking Entry not found")
    lines = conn.execute(
        text("SELECT * FROM TrnDtlHBE WHERE HBEID = :id ORDER BY SlNo"), {"id": hbe_id}
    ).mappings().all()
    return {"header": dict(hdr), "lines": [dict(l) for l in lines]}


def delete_hbe(conn: Connection, *, hbe_id: int, user_code: str) -> None:
    row = conn.execute(text(f"SELECT {NO_COLUMN} FROM {TABLE} WHERE HBEID = :id"), {"id": hbe_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall Booking Entry not found")
    conn.execute(text("DELETE FROM TrnDtlHBE WHERE HBEID = :id"), {"id": hbe_id})
    conn.execute(text(f"DELETE FROM {TABLE} WHERE HBEID = :id"), {"id": hbe_id})
    audit.record(conn, entity="Hall Booking Entry", entity_id=hbe_id, action="D", user_code=user_code)
