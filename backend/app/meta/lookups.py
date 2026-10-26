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


_REF_RE = re.compile(r"#([A-Za-z0-9_]+)#")
_QUOTED_REF_RE = re.compile(r"`?#([A-Za-z0-9_]+)#`?")


def _field_row(conn: Connection, doc_id: int, field_code: str):
    return conn.execute(
        text("SELECT * FROM UtlDocDsgrFlds WHERE DocID = :d AND FldCode = :f"), {"d": doc_id, "f": field_code}
    ).mappings().first()


def _source(row) -> tuple[str, str, str] | None:
    table = (row["FldCmbTblName"] or "").strip()
    value_col = (row["FldCmbStorageFldName"] or "").strip()
    display_col = (row["FldCmbDisplayCols"] or "").split(",")[0].strip()
    if IDENT_RE.match(table) and IDENT_RE.match(value_col) and IDENT_RE.match(display_col):
        return table, value_col, display_col
    return None


def display_of(conn: Connection, doc_id: int, field_code: str, value) -> str:
    """What the legacy form substitutes for `#FIELD#`: the combo's display text when the field is a lookup, else the raw value."""
    if value is None or str(value).strip() == "":
        return ""
    row = _field_row(conn, doc_id, field_code)
    if row is not None and (row["FldBlnComboData"] or "N").strip().upper() == "Y":
        src = _source(row)
        if src:
            table, value_col, display_col = src
            found = conn.execute(text(f"SELECT {display_col} FROM {table} WHERE {value_col} = :v"), {"v": value}).scalar()
            return "" if found is None else str(found).strip()
    return str(value).strip()


def resolve_lookup(
    conn: Connection, *, doc_id: int, field_code: str, search: str = "", top: int = 100, ctx: dict | None = None
) -> list[dict]:
    from app.core.db import limit_clause

    row = _field_row(conn, doc_id, field_code)
    if row is None or (row["FldBlnComboData"] or "N").strip().upper() != "Y":
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{field_code} is not a lookup field for this document")

    src = _source(row)
    if src is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This field has no valid lookup source configured")
    table, value_col, display_col = src

    sql = f"SELECT {value_col} AS value, {display_col} AS label FROM {table} WHERE 1 = 1"
    params: dict = {}

    parsed = _parse_cond(row["FldCmbAddnlCond"])
    if parsed:
        col, op, val = parsed
        ref = _REF_RE.fullmatch(val)
        if ref:  # dependent combo, e.g. Rashi filtered by the chosen Nakshatra: `NAKSHATRACODE = `#NAKSHATRAID#``
            code = ref.group(1)
            val = display_of(conn, doc_id, code, (ctx or {}).get(code))
            if not val:
                return []
        if IDENT_RE.match(col) and op in ("=", "<>", ">", "<", ">=", "<="):
            sql += f" AND {col} {op} :cond_val"
            params["cond_val"] = val

    if search:
        sql += f" AND {display_col} LIKE :q"
        params["q"] = f"%{search}%"

    sql += f" ORDER BY {display_col} {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [{"value": r["value"], "label": r["label"]} for r in rows]


def resolve_pickup(conn: Connection, *, doc_id: int, field_code: str, values: dict) -> dict:
    """`FldPickUP`: the query a Designer field runs after another field changes to fill itself (e.g. Rashi from the
    chosen Nakshatra). The SQL comes only from the field's own designer row; `#CODE#` references become bound
    parameters (a combo's id is first turned into its display text, as the legacy form does)."""
    row = _field_row(conn, doc_id, field_code)
    pick = ((row["FldPickUP"] if row is not None else "") or "").strip()
    if not pick:
        return {"value": None}
    if ";" in pick or not pick.lower().startswith("select"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported pick-up query")
    params: dict = {}

    def bind(m: re.Match) -> str:
        code = m.group(1)
        params[f"pk_{code}"] = display_of(conn, doc_id, code, values.get(code))
        return f":pk_{code}"

    sql = _QUOTED_REF_RE.sub(bind, pick).replace("`", "'")  # `#X#` -> :pk_X (the legacy quote marks go with it)
    if any(not v for v in params.values()):
        return {"value": None}
    found = conn.execute(text(sql), params).first()
    if not found or found[0] is None:
        return {"value": None}
    result = found[0]
    if (row["FldBlnComboData"] or "N").strip().upper() == "Y":  # the query returns a display text: map it back to the id
        src = _source(row)
        if src:
            table, value_col, display_col = src
            vid = conn.execute(text(f"SELECT {value_col} FROM {table} WHERE {display_col} = :v"), {"v": str(result).strip()}).scalar()
            return {"value": vid}
    return {"value": result.strip() if isinstance(result, str) else result}
