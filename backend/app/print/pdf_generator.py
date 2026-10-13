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


# ---- Legacy form flow: pick document -> print type -> optional parties -> Load -> tick records -> Download ----


def _ident(v: str) -> str:
    if not _IDENT_RE.match(v or ""):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unexpected table/column name metadata: {v!r}")
    return v


def printable_documents(conn: Connection) -> list[dict]:
    """Documents that have print options (UtlOption) — the legacy 'Transaction' combo — and whether they have a party."""
    rows = conn.execute(
        text("SELECT DocID, DocName, MstDocIDParty FROM UtlTransactions WHERE DocID IN (SELECT DocID FROM UtlOption) ORDER BY DocName")
    ).mappings().all()
    out = []
    for r in rows:
        party_sf = ""
        if (r["MstDocIDParty"] or 0) > 0:
            party_sf = (conn.execute(text("SELECT DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": r["MstDocIDParty"]}).scalar() or "").strip()
        out.append({"doc_id": r["DocID"], "doc_name": r["DocName"], "party_label": party_sf})
    return out


def _party_sf(conn: Connection, doc_id: int) -> str:
    pid = conn.execute(text("SELECT MstDocIDParty FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar() or 0
    if pid <= 0:
        return ""
    return _ident((conn.execute(text("SELECT DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": pid}).scalar() or "").strip())


def parties(conn: Connection, doc_id: int) -> list[dict]:
    sf = _party_sf(conn, doc_id)
    if not sf:
        return []
    rows = conn.execute(
        text(f"SELECT {sf}ID AS id, {sf}Code AS code, {sf}Name AS name FROM Mst{sf} WHERE {sf}ID > 0 AND {sf}Code NOT IN ('-', '') AND InActive = 'N' ORDER BY {sf}Code")
    ).mappings().all()
    return [dict(r) for r in rows]


def _columns(conn: Connection, table: str) -> set[str]:
    return {r[0].lower() for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": table}).all()}


def load_records(conn: Connection, *, doc_id: int, from_date, to_date, party_ids: list[int] | None = None) -> list[dict]:
    txn = conn.execute(text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if txn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")
    hdr, sf = _ident((txn["HdrTblName"] or "").strip()), _ident((txn["DocShForm"] or "").strip())
    psf = _party_sf(conn, doc_id)
    has_name = "partyname" in _columns(conn, hdr)
    party_expr = "PartyName" if (psf and has_name) else "''"
    sql = f"SELECT {sf}ID AS id, {sf}No AS doc_no, {sf}Date AS doc_date, {party_expr} AS party FROM {hdr} WHERE {sf}Date BETWEEN :f AND :t"
    params: dict = {"f": from_date, "t": to_date}
    if psf and party_ids:
        names = {f"p{i}": int(v) for i, v in enumerate(party_ids)}
        sql += f" AND {psf}ID IN (" + ",".join(f":{n}" for n in names) + ")"
        params.update(names)
    sql += " ORDER BY 2"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]
