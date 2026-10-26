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
from app.legacy.tables import insert_row, table
from app.meta import doc_rules
from app.meta.numbering import next_doc_no, resolve_prefix
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1280
TABLE = "TrnHdrHBE"
NO_COLUMN = "HBENO"


@dataclass
class HbeInput:
    """The screen submits Designer fields keyed by FldCode (Header / Footer / Total) and the Detail lines."""

    fields: dict
    lines: list[dict]
    receipt_date: date | None = None


# Where a Designer code differs from its TrnHdrHBE column.
ALIASES = {"CGST": "CGSTAMT", "SGST": "SGSTAMT"}
# Formulas refer to the column names; the Designer fields carrying those values are CGST / SGST.
FORMULA_NAMES = {"CGSTAMT": "CGST", "SGSTAMT": "SGST"}
# Calculated here from the lines: whatever the browser sends for them is ignored.
COMPUTED = ("TOTAMT", "TOTGSTAMT", "AMTAFTTAX", "NETPAY", "AMTINWORDS", "TOTAMTIWRDS", "ISSUEDBY")


def _num(v) -> float:
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Amounts must be numbers")


def create_hbe(conn: Connection, *, data: HbeInput, fy: FinancialYear, user_code: str) -> dict:
    rows = doc_rules.load_fields(conn, DOC_ID)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Hall Booking Entry has no fields configured in the Doc Designer")
    values = doc_rules.effective_values(rows, {k: v for k, v in data.fields.items() if k not in COMPUTED})
    head = [r for r in rows if r.get("FldSection") != "Detail"]
    detail = [r for r in rows if r.get("FldSection") == "Detail"]

    start = values.get("HBSTARTDT")
    assert_date_in_fy(doc_rules._to_date(start) if start else date.today(), fy)
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one item line")
    doc_rules.validate(head, values, skip=COMPUTED, fy=fy)
    doc_rules.check_duplicate_lines(detail, data.lines)
    for i, l in enumerate(data.lines, start=1):
        try:
            doc_rules.validate(detail, {**values, **l})
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f"Line {i}: {exc.detail}")
        if _num(l.get("AMOUNT")) <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    prefixes = resolve_prefix(conn, doc_id=DOC_ID, field_values={k: str(v) for k, v in values.items()})
    if not prefixes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No document-number prefix configured for this booking")
    prefix = prefixes[0]
    doc_no = next_doc_no(
        conn, table_name=TABLE, no_column=NO_COLUMN, prefix=prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )

    # Totals come from the Designer's formulas (TOTAMT = SVTCOLSUM(#AMOUNT#), AMTAFTTAX, NETPAY, GST ...); where this
    # temple has no formula for one of them the plain arithmetic is used.
    computed = doc_rules.compute_formulas(rows, values, doc_rules.columns_from_lines(data.lines), user_code=user_code, aliases=FORMULA_NAMES)
    final = doc_rules.apply_computed(rows, values, computed)
    total_amt = round(_num(computed["TOTAMT"]) if "TOTAMT" in computed else sum(_num(l.get("AMOUNT")) for l in data.lines), 2)
    cgst, sgst = _num(final.get("CGST")), _num(final.get("SGST"))
    tot_gst_amt = round(_num(computed["TOTGSTAMT"]) if "TOTGSTAMT" in computed else cgst + sgst, 2)
    amt_after_tax = round(_num(computed["AMTAFTTAX"]) if "AMTAFTTAX" in computed else total_amt + tot_gst_amt, 2)
    net_pay = round(
        _num(computed["NETPAY"]) if "NETPAY" in computed else amt_after_tax - _num(values.get("SDEPAMT")) - _num(values.get("ADV")), 2
    )
    amt_in_words = str(computed.get("AMTINWORDS") or amount_in_words(net_pay))
    tot_words = str(computed.get("TOTAMTIWRDS") or amount_in_words(net_pay))
    values = final  # CGST / SGST may have come from their formula

    cols = doc_rules.column_values(head, values, table(TABLE), ALIASES)
    cols.update(
        {
            NO_COLUMN: doc_no, "Prefix": prefix, "PrintHBENO": doc_no, "HBEDate": datetime.now(),
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "TOTAMT": total_amt, "TOTGSTAMT": tot_gst_amt, "AMTAFTTAX": amt_after_tax, "NETPAY": net_pay,
            "RCPDT": data.receipt_date or (doc_rules._to_date(start) if start else date.today()),
            "ISSUEDBY": user_code, "AMTINWORDS": amt_in_words, "TOTAMTIWRDS": tot_words,
        }
    )
    hbe_id = insert_row(conn, TABLE, cols, returning="HBEID")
    for i, l in enumerate(data.lines, start=1):
        lv = doc_rules.effective_values(detail, l)
        dcols = doc_rules.column_values(detail, lv, table("TrnDtlHBE"))
        dcols.update({"HBEID": hbe_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0, "AMOUNT": _num(l.get("AMOUNT"))})
        insert_row(conn, "TrnDtlHBE", dcols)

    audit.record(conn, entity="Hall Booking Entry", entity_id=hbe_id, action="A", user_code=user_code, details=doc_no)
    return {"hbe_id": hbe_id, "hbe_no": doc_no, "total_amt": total_amt, "net_pay": net_pay}


def list_hbe(conn: Connection, *, fy: FinancialYear, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = (
        f"SELECT * "  # not a fixed column list: TYPE etc. exist only in some temples' databases
        
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
