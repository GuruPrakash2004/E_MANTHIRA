"""
Record navigation for transaction documents — port of `svtModule.gMoveRecords` (First / Previous / Next / Last within
the active financial year, optionally within one document-number prefix). The table, id column and date column are read
from `UtlTransactions` (HdrTblName + DocShForm -> <SF>ID / <SF>Date), so any document works without per-doc code.
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.fy import FinancialYear

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _doc_columns(conn: Connection, doc_id: int) -> tuple[str, str, str]:
    row = conn.execute(text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if row is None or not (row["HdrTblName"] or "").strip() or not (row["DocShForm"] or "").strip():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")
    table, sf = row["HdrTblName"].strip(), row["DocShForm"].strip()
    id_col, date_col = f"{sf}ID", f"{sf}Date"
    if not all(_IDENT.match(x) for x in (table, id_col, date_col)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This document cannot be browsed")
    return table, id_col, date_col


def neighbour_id(conn: Connection, *, doc_id: int, direction: str, current: int | None, fy: FinancialYear, prefix: str = "") -> int | None:
    table, id_col, date_col = _doc_columns(conn, doc_id)
    where = f"{date_col} BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if prefix:
        where += " AND Prefix = :p"
        params["p"] = prefix
    if direction == "first":
        sql = f"SELECT MIN({id_col}) FROM {table} WHERE {where}"
    elif direction == "last":
        sql = f"SELECT MAX({id_col}) FROM {table} WHERE {where}"
    elif direction == "next" and current:
        sql = f"SELECT MIN({id_col}) FROM {table} WHERE {where} AND {id_col} > :c"
        params["c"] = current
    elif direction == "prev" and current:
        sql = f"SELECT MAX({id_col}) FROM {table} WHERE {where} AND {id_col} < :c"
        params["c"] = current
    elif direction in ("next", "prev"):  # nothing selected yet: behave like first / last
        return neighbour_id(conn, doc_id=doc_id, direction="first" if direction == "next" else "last", current=None, fy=fy, prefix=prefix)
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "direction must be first, prev, next or last")
    v = conn.execute(text(sql), params).scalar()
    return int(v) if v is not None else None
