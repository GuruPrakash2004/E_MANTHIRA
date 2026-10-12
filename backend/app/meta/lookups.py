"""
Generic combo-field lookup resolver — port of how `frmMstGeneral`/every
legacy entry screen fills a dropdown from `UtlDocDsgrFlds.FldCmbTblName`
(+ FldCmbStorageFldName / FldCmbDisplayCols / FldCmbAddnlCond).

This is the piece that makes the web app as customisable as the legacy one:
which fields are combo-driven, which table/column feeds them, and any extra
filter condition all live in the SAME `UtlDocDsgrFlds` row the Windows app
reads — nothing here is hard-coded per document (CLAUDE.md rule 5).
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_COND_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*(=|<>|>=|<=|>|<)\s*(.+)$")


def _parse_cond(cond: str | None) -> tuple[str, str, str] | None:
    """Parses the legacy `Col=`Val`` / `Col>0` mini-condition syntax used in FldCmbAddnlCond."""
    cond = (cond or "").strip()
    if not cond:
        return None
    m = _COND_RE.match(cond)
    if not m:
        return None
    col, op, val = m.groups()
    return col, op, val.strip().strip("`").strip()


def resolve_lookup(conn: Connection, *, doc_id: int, field_code: str, search: str = "", top: int = 100) -> list[dict]:
    from app.core.db import limit_clause

    row = conn.execute(
        text("SELECT * FROM UtlDocDsgrFlds WHERE DocID = :d AND FldCode = :f"), {"d": doc_id, "f": field_code}
    ).mappings().first()
    if row is None or (row["FldBlnComboData"] or "N").strip().upper() != "Y":
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{field_code} is not a lookup field for this document")

    table = (row["FldCmbTblName"] or "").strip()
    value_col = (row["FldCmbStorageFldName"] or "").strip()
    display_col = (row["FldCmbDisplayCols"] or "").split(",")[0].strip()
    if not (IDENT_RE.match(table) and IDENT_RE.match(value_col) and IDENT_RE.match(display_col)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This field has no valid lookup source configured")

    sql = f"SELECT {value_col} AS value, {display_col} AS label FROM {table} WHERE 1 = 1"
    params: dict = {}

    parsed = _parse_cond(row["FldCmbAddnlCond"])
    if parsed:
        col, op, val = parsed
        if IDENT_RE.match(col) and op in ("=", "<>", ">", "<", ">=", "<="):
            sql += f" AND {col} {op} :cond_val"
            params["cond_val"] = val

    if search:
        sql += f" AND {display_col} LIKE :q"
        params["q"] = f"%{search}%"

    sql += f" ORDER BY {display_col} {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [{"value": r["value"], "label": r["label"]} for r in rows]
