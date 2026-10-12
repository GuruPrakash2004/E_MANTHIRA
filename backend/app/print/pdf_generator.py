"""
PDF Generator (bulk) — port of the legacy `frmUtlBulkPDFGenerator`
("PDF Generator - Bulk"): pick a document + print option + date range,
and get a PDF for every matching record in one go (the legacy form wrote
one file per record into a chosen folder; this one zips them for
download, since a web app has no local folder to write into).

Every document's header table/ID/date column follows the same
`DocShForm` convention CLAUDE.md §6 documents (`TrnHdr<ShForm>`,
`<ShForm>ID`, `<ShForm>Date`) and is confirmed per-document from
`UtlTransactions` itself (HdrTblName, DocShForm) rather than assumed —
metadata is the source of truth (CLAUDE.md rule 5), same spirit as
rpt_registry.py.
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

_IDENT_RE = re.compile(r"^[A-Za-z0-9_]+$")

MAX_RECORDS = 200  # a sane cap for a single zip download


def candidate_record_ids(conn: Connection, *, doc_id: int, from_date, to_date) -> list[int]:
    txn = conn.execute(
        text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}
    ).mappings().first()
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")

    hdr_table = (txn["HdrTblName"] or "").strip()
    shform = (txn["DocShForm"] or "").strip()
    id_col = f"{shform}ID"
    date_col = f"{shform}Date"
    for ident in (hdr_table, id_col, date_col):
        if not _IDENT_RE.match(ident):
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unexpected table/column name metadata: {ident!r}")

    sql = f"SELECT {id_col} FROM {hdr_table} WHERE {date_col} BETWEEN :fs AND :fe ORDER BY {id_col}"
    rows = conn.execute(text(sql), {"fs": from_date, "fe": to_date}).fetchall()
    ids = [r[0] for r in rows]

    if not ids:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No records found in that date range")
    if len(ids) > MAX_RECORDS:
        raise HTTPException(
            413,
            f"{len(ids)} records match — narrow the date range (max {MAX_RECORDS} per download)",
        )
    return ids
