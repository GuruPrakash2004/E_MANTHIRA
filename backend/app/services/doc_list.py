"""
Full listing of a master / transaction document for the grid dialog (sort, per-column filter, resizable and
selectable columns happen in the browser). Everything is read from metadata, nothing per-document is hard-coded:
table + short form from `UtlTransactions`, captions / order from `UtlDocDsgrFlds`, financial-year scope from the
document's `<SF>Date` column when it has one (transactions); masters have none and list every row.
"""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import limit_clause
from app.core.fy import FinancialYear

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_ROWS = 5000


def _value(v: Any) -> Any:
    if v is None or isinstance(v, (int, float, str, bool)):
        return v.strip() if isinstance(v, str) else v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, dt.datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, dt.time):
        return v.isoformat(timespec="seconds")
    return str(v)


def list_document(conn: Connection, *, doc_id: int, fy: FinancialYear) -> dict[str, Any]:
    doc = conn.execute(text("SELECT HdrTblName, DocShForm, DocName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    table = ((doc or {}).get("HdrTblName") or "").strip()
    sf = ((doc or {}).get("DocShForm") or "").strip()
    if doc is None or not _IDENT.match(table):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")
    id_col, date_col = f"{sf}ID", f"{sf}Date"

    real_cols = {
        r[0]: r[1].lower()
        for r in conn.execute(
            text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = :t"), {"t": table}
        )
    }
    where, params, order = "1 = 1", {}, ""
    if date_col in real_cols and _IDENT.match(date_col):
        where, params = f"{date_col} BETWEEN :fs AND :fe", {"fs": fy.start_date, "fe": fy.end_date}
    if id_col in real_cols and _IDENT.match(id_col):
        order = f"ORDER BY {id_col} DESC"  # newest / last saved first, like the legacy listing (`Order by 1 desc`)
        if date_col not in real_cols:
            where += f" AND {id_col} <> 0"  # the ID-0 "none" placeholder is not a real record
    code_col = f"{sf}CODE"
    if date_col not in real_cols and code_col in real_cols and _IDENT.match(code_col):
        where += f" AND {code_col} <> '-'"  # legacy ViewForm adds `and <CODE> <> '-'` to every master listing

    fields = conn.execute(
        text(
            "SELECT FldCode, FldCaption, FldCmbTblName, FldCmbStorageFldName, FldCmbDisplayCols "
            "FROM UtlDocDsgrFlds WHERE DocID = :d ORDER BY FldSection, FldOrderBy"
        ),
        {"d": doc_id},
    ).mappings().all()
    captions = {f["FldCode"].strip(): (f["FldCaption"] or "").strip() for f in fields if (f["FldCode"] or "").strip()}
    designed = [c for c in captions if c in real_cols and captions[c]]

    keys = [c for c in real_cols if real_cols[c] not in ("image", "varbinary", "binary", "timestamp") and _IDENT.match(c)]
    if not keys:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This document cannot be listed")
    sql = f"SELECT {', '.join(keys)} FROM {table} WHERE {where} {order or 'ORDER BY (SELECT NULL)'} {limit_clause(MAX_ROWS)}"
    rows = [{k: _value(r[k]) for k in keys} for r in conn.execute(text(sql), params).mappings()]

    # Combo fields store an id; show the name the designer's combo shows (same table / display column as the entry screen).
    for f in fields:
        code, tbl = (f["FldCode"] or "").strip(), (f["FldCmbTblName"] or "").strip()
        store, disp = (f["FldCmbStorageFldName"] or "").strip(), (f["FldCmbDisplayCols"] or "").split(",")[0].strip()
        if code not in keys or not all(_IDENT.match(x) for x in (tbl, store, disp)) or real_cols[code] in ("char", "varchar", "nvarchar", "nchar"):
            continue
        try:
            names = {r[0]: _value(r[1]) for r in conn.execute(text(f"SELECT {store}, {disp} FROM {tbl}")).all()}
        except Exception:  # a combo over a table / column that is not in this database: keep the stored id
            continue
        for r in rows:
            if r[code] is not None:
                r[code] = names.get(r[code], r[code])
        real_cols[code] = "varchar"

    # Nakshatra stores its two possible rashis as ids (RASHIID1 / RASHIID2): show the names, even when the designer has no caption for them.
    if table.lower() == "mstnakshatra":
        try:
            rn = {r[0]: _value(r[1]) for r in conn.execute(text("SELECT RASHIID, RASHINAME FROM MstRASHI")).all()}
        except Exception:
            rn = {}
        for k, cap in (("RASHIID1", "Rashi 1"), ("RASHIID2", "Rashi 2")):
            if k in keys and rn and real_cols[k] in ("int", "bigint", "smallint", "tinyint"):
                for r in rows:
                    r[k] = rn.get(r[k], "") if r[k] else ""
                real_cols[k] = "varchar"
                captions[k] = captions.get(k) or cap
                if k not in designed:
                    designed.append(k)

    # Default view = the designer's captioned fields (id first); everything else stays selectable under "Select Columns".
    lead = [id_col] + ([f"{sf}CODE", f"{sf}NAME"] if date_col not in real_cols else [f"Print{sf}NO", date_col])
    lead = [c for c in lead if c in keys]
    default_visible = lead + [c for c in designed if c not in lead]
    fallback = {id_col: "ID", f"{sf}CODE": "Code", f"{sf}NAME": "Name", f"Print{sf}NO": "Doc No", date_col: "Date"}
    columns = [
        {
            "key": k,
            "label": captions.get(k) or fallback.get(k) or k,
            "type": "number" if real_cols[k] in ("int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money") else "date" if real_cols[k] in ("date", "datetime", "smalldatetime", "datetime2") else "text",
            "visible": k in default_visible,
        }
        for k in default_visible + [k for k in keys if k not in default_visible]
    ]
    return {"doc_id": doc_id, "title": (doc["DocName"] or "").strip(), "id_col": id_col if id_col in keys else keys[0], "columns": columns, "rows": rows, "truncated": len(rows) >= MAX_ROWS}
