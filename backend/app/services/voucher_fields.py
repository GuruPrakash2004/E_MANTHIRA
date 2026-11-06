"""
Header columns of a Payment / Receipt / Journal voucher, built from the temple's Doc Designer
(`UtlDocDsgrFlds` rows of the voucher's DocID) instead of a fixed set of request fields:
which fields exist, which are mandatory / hidden (e.g. cheque details only for a Bank voucher) is the Designer's call.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.engine import Connection

from app.legacy.tables import table
from app.meta import doc_rules

# Totals / words are calculated from the lines, never taken from the browser.
COMPUTED = ("TOTDR", "TOTCR", "AMTINWORDS")
# What the legacy form writes for a bank / card detail left blank (the columns are not nullable).
PLACEHOLDERS = {"CHQDDNO": " ", "CHQAMT": " ", "CHQNO": " ", "CARDNO": "0", "BANK": 0, "CRDAMT": 0}


def header_columns(conn: Connection, doc_id: int, table_name: str, fields: dict) -> tuple[dict, dict]:
    """Returns (columns to insert, effective values keyed by FldCode). Raises 422 for a broken Designer rule."""
    rows = doc_rules.load_fields(conn, doc_id)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "This voucher has no fields configured in the Doc Designer")
    values = doc_rules.effective_values(rows, {k: v for k, v in (fields or {}).items() if k not in COMPUTED})
    head = [r for r in rows if (r.get("FldSection") or "Header") in ("Header", "Footer")]
    doc_rules.validate(head, values, skip=COMPUTED)
    cols = doc_rules.column_values(head, values, table(table_name))
    out = dict(PLACEHOLDERS)
    # a blank Designer field comes back as ' ' (the EXE's blank): it must not overwrite a placeholder (CARDNO '0') or
    # a value computed from the lines (AMTINWORDS, totals)
    out.update({k: v for k, v in cols.items() if v not in ("", None) and not (isinstance(v, str) and not v.strip() and k in PLACEHOLDERS)
                and k.upper() not in COMPUTED})
    return out, values
