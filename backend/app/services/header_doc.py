"""
A document with only a header (no detail grid), written entirely from its Doc Designer rows — Asset Entry (1262)
today. `SPECS` names the per-document pieces; every field, rule and default comes from `UtlDocDsgrFlds`
(`doc_rules.header_columns`), so a temple's own Designer edits take effect without code changes.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, update_row
from app.meta import doc_rules
from app.meta.numbering import next_doc_no, resolve_prefix


@dataclass(frozen=True)
class Spec:
    kind: str
    doc_id: int
    name: str
    short: str  # table suffix: TrnHdr<short>, columns <short>ID / <short>NO / Print<short>NO / <short>Date


SPECS = {"assets": Spec("assets", 1262, "Asset Entry", "ASSET")}


def create(conn: Connection, spec: Spec, *, fields: dict, doc_date: date, fy: FinancialYear, user_code: str) -> dict:
    s = spec.short
    assert_date_in_fy(doc_date, fy)
    cols, values = doc_rules.header_columns(conn, spec.doc_id, f"TrnHdr{s}", fields, fy=fy)
    prefixes = resolve_prefix(conn, doc_id=spec.doc_id, field_values={k: str(v) for k, v in values.items()})
    if not prefixes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No document-number prefix configured for {spec.name}")
    prefix = prefixes[0]
    doc_no = next_doc_no(
        conn, table_name=f"TrnHdr{s}", no_column=f"{s}NO", prefix=prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    cols.update(
        {
            f"{s}NO": doc_no, "Prefix": prefix, f"Print{s}NO": doc_no, f"{s}Date": doc_date,
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
        }
    )
    new_id = insert_row(conn, f"TrnHdr{s}", cols, returning=f"{s}ID")
    audit.record(conn, entity=spec.name, entity_id=new_id, action="A", user_code=user_code, details=doc_no)
    return {"id": new_id, "no": doc_no}


def list_recent(conn: Connection, spec: Spec, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    s = spec.short
    sql = f"SELECT * FROM TrnHdr{s} WHERE {s}Date BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += f" AND {s}NO LIKE :q"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY {s}ID DESC {limit_clause(top)}"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def get(conn: Connection, spec: Spec, row_id: int) -> dict:
    s = spec.short
    row = conn.execute(text(f"SELECT * FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": row_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{spec.name} not found")
    return dict(row)


def cancel(conn: Connection, spec: Spec, *, row_id: int, reason: str, user_code: str) -> None:
    s = spec.short
    row = get(conn, spec, row_id)
    if (row.get("Cancelled") or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, f"TrnHdr{s}", f"{s}ID", row_id, {"Cancelled": "Y", "ChangedBy": user_code, "ChangedOn": datetime.now()})
    audit.record(conn, entity=spec.name, entity_id=row_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, spec: Spec, *, row_id: int, user_code: str) -> None:
    s = spec.short
    get(conn, spec, row_id)
    conn.execute(text(f"DELETE FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": row_id})
    audit.record(conn, entity=spec.name, entity_id=row_id, action="D", user_code=user_code)
