"""
Bulk Master/Transaction Update — port of the legacy "Bulk Master Update"
utility (doc 07 §5.9): `UtlMstTrnBulkUpdate` definitions -> filter grid ->
edit -> update. 5 real definitions in this client's data, 4 of them for
bulk-marking `TrnHdrSEVA.PRASADA` across many sevas at once ("Prasada",
"Prasada Issue", "Prasada Update", "prasad update") — a genuinely
heavily-used feature, not idle cruft.

Column format (legacy, `^`-joined column entries, each comma-separated):
  StorageCols: ColName,Editable(Y/N),Visible(Y/N),Searchable(Y/N),?,?,?,DataType
  FilterCols:  ColName,?,?,DataType,
Only `Editable='Y'` columns are ever written, and only after being checked
against the table's real writable (non-computed) columns — same safety net
as `legacy/tables.py::insert_row`/`update_row` (CLAUDE.md rule 3).
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import limit_clause
from app.legacy.tables import table as reflect_table
from app.legacy.tables import writable_columns

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _check_ident(name: str) -> str:
    if not _IDENT_RE.match(name or ""):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unsafe identifier in bulk-update definition: {name!r}")
    return name


def _parse_storage_cols(raw: str) -> list[dict]:
    cols = []
    for part in (raw or "").split("^"):
        f = part.split(",")
        if len(f) < 8 or not f[0]:
            continue
        cols.append(
            {
                "name": f[0],
                "editable": f[1].strip().upper() == "Y",
                "visible": f[2].strip().upper() == "Y",
                "data_type": f[7].strip().upper() or "TEXT",
            }
        )
    return cols


def _parse_filter_cols(raw: str) -> list[dict]:
    cols = []
    for part in (raw or "").split("^"):
        f = part.split(",")
        if not f or not f[0]:
            continue
        cols.append({"name": f[0], "data_type": (f[3].strip().upper() if len(f) > 3 and f[3] else "TEXT")})
    return cols


def list_definitions(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT RowID, DocName, TblName FROM UtlMstTrnBulkUpdate ORDER BY DocName")).mappings().all()
    return [{"row_id": r["RowID"], "doc_name": r["DocName"], "table": r["TblName"]} for r in rows]


def get_definition(conn: Connection, row_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM UtlMstTrnBulkUpdate WHERE RowID = :id"), {"id": row_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bulk update definition not found")
    return {
        "row_id": row_id,
        "doc_name": row["DocName"],
        "table": row["TblName"],
        "key_field": (row["KeyFields"] or "").strip(),
        "columns": _parse_storage_cols(row["StorageCols"]),
        "filters": _parse_filter_cols(row["FilterCols"]),
    }


def list_rows(conn: Connection, *, row_id: int, filters: dict[str, str]) -> list[dict]:
    defn = get_definition(conn, row_id)
    tbl = _check_ident(defn["table"])
    key = _check_ident(defn["key_field"])
    visible = [c for c in defn["columns"] if c["visible"]]
    if not visible:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This bulk-update definition has no visible columns")
    select_list = ", ".join(_check_ident(c["name"]) for c in visible)

    sql = f"SELECT {select_list} FROM {tbl} WHERE 1 = 1"
    params: dict = {}
    filterable = {f["name"]: f for f in defn["filters"]}
    for i, (col_name, value) in enumerate(filters.items()):
        if not value or col_name not in filterable:
            continue
        col = _check_ident(col_name)
        p = f"p{i}"
        if filterable[col_name]["data_type"] == "NUMERIC":
            sql += f" AND {col} = :{p}"
            params[p] = value
        elif filterable[col_name]["data_type"] == "DATE":
            sql += f" AND CAST({col} AS date) = :{p}"
            params[p] = value
        else:
            sql += f" AND {col} LIKE :{p}"
            params[p] = f"%{value}%"
    sql += f" ORDER BY {key} DESC {limit_clause(500)}"

    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def save_rows(conn: Connection, *, row_id: int, rows: list[dict], user_code: str) -> int:
    defn = get_definition(conn, row_id)
    tbl_name = _check_ident(defn["table"])
    key = _check_ident(defn["key_field"])

    # Cross-check against the table's REAL writable columns — never trust the
    # definition alone to decide what's safe to write (CLAUDE.md rule 3).
    real_writable = writable_columns(reflect_table(tbl_name))
    editable_cols = [_check_ident(c["name"]) for c in defn["columns"] if c["editable"] and c["name"] in real_writable]
    if not editable_cols:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This bulk-update definition has no editable, writable columns")

    updated = 0
    for r in rows:
        key_val = r.get(key)
        if key_val is None:
            continue
        set_cols = [c for c in editable_cols if c in r]
        if not set_cols:
            continue
        set_clause = ", ".join(f"{c} = :{c}" for c in set_cols)
        params = {c: r[c] for c in set_cols}
        params["_key"] = key_val
        result = conn.execute(text(f"UPDATE {tbl_name} SET {set_clause} WHERE {key} = :_key"), params)
        updated += result.rowcount
    return updated
