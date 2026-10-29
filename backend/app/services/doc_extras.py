"""
Amendment — port of the legacy form's Amendment panel (tsbAmmend / chkAmmendment, txtAmmNo, dtAmmDate).

The three columns (Ammendment 'Y'/'N', AmmNo, AmmDate) live on the document's header table. Nothing in this database
has them and no document has UtlTransactions.AmmReq='Y', so the feature is DORMANT here: it switches itself on only for
a document whose designer switch is on AND whose header table carries the columns (edit_rules.amendment_supported).
The web app never adds columns (CLAUDE.md rule 1).
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.meta import edit_rules


def _require(conn: Connection, doc_id: int) -> tuple[str, str, set[str]]:
    if not edit_rules.amendment_supported(conn, doc_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Amendment is not available for this document")
    return edit_rules._header_info(conn, doc_id)  # type: ignore[return-value]


def get_amendment(conn: Connection, doc_id: int, record_id: int) -> dict:
    if not edit_rules.amendment_supported(conn, doc_id):
        return {"available": False}
    tbl, sh, _ = edit_rules._header_info(conn, doc_id)  # type: ignore[misc]
    row = conn.execute(text(f"SELECT Ammendment, AmmNo, AmmDate FROM {tbl} WHERE {sh}ID = :i"), {"i": record_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found")
    return {
        "available": True,
        "amendment": str(row["Ammendment"] or "N").strip().upper() == "Y",
        "amm_no": int(row["AmmNo"] or 0),
        "amm_date": row["AmmDate"].date().isoformat() if isinstance(row["AmmDate"], datetime) else (row["AmmDate"].isoformat() if row["AmmDate"] else None),
    }


def apply_amendment(conn: Connection, *, table: str, id_col: str, record_id: int, amendment: bool, amm_date: date | None, has_authorised: bool = False, reset_auth: bool = False) -> dict:
    """Write the three columns. Ticking Amendment on a record that is not yet amended numbers it AmmNo + 1 (legacy
    chkAmmendment_CheckedChanged); unticking clears the number and date. `table` / `id_col` come from UtlTransactions."""
    cur = conn.execute(text(f"SELECT Ammendment, AmmNo FROM {table} WHERE {id_col} = :i"), {"i": record_id}).mappings().first()
    if cur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found")
    was = str(cur["Ammendment"] or "N").strip().upper() == "Y"
    if amendment:
        no = int(cur["AmmNo"] or 0) if was and int(cur["AmmNo"] or 0) > 0 else int(cur["AmmNo"] or 0) + 1
        vals = {"a": "Y", "n": no, "d": amm_date or date.today()}
    else:
        vals = {"a": "N", "n": 0, "d": None}
    extra = ", Authorised = 'N'" if has_authorised and reset_auth else ""
    conn.execute(text(f"UPDATE {table} SET Ammendment = :a, AmmNo = :n, AmmDate = :d{extra} WHERE {id_col} = :i"), {**vals, "i": record_id})
    return {"amendment": vals["a"] == "Y", "amm_no": vals["n"], "amm_date": vals["d"].isoformat() if vals["d"] else None}


def set_amendment(conn: Connection, doc_id: int, record_id: int, *, amendment: bool, amm_date: date | None, user_code: str) -> dict:
    tbl, sh, cols = _require(conn, doc_id)
    edit_rules.assert_record_editable(conn, doc_id, record_id)
    out = apply_amendment(
        conn, table=tbl, id_col=f"{sh}ID", record_id=record_id, amendment=amendment, amm_date=amm_date,
        has_authorised="authorised" in cols, reset_auth=edit_rules.auth_required(conn, doc_id),
    )
    audit.record(conn, entity=f"{tbl} amendment", entity_id=record_id, action="E", user_code=user_code, details=f"Amendment {'Y' if out['amendment'] else 'N'} no {out['amm_no']}")
    return out
