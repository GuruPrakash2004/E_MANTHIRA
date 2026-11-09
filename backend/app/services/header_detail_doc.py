"""
A header + detail-lines document written entirely from its Doc Designer rows — Group Seva (1264) today: the group's
Name / Mobile (Header) and its members (Detail grid: sannidhi, seva, sevakarthru, nakshatra, gothra, rashi ...).
Which fields exist, their rules and defaults are the temple's `UtlDocDsgrFlds` rows; `SPECS` only names the tables.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, table, update_row
from app.meta import doc_rules, edit_rules
from app.meta.numbering import next_doc_no, resolve_prefix


@dataclass(frozen=True)
class Spec:
    kind: str
    doc_id: int
    name: str
    short: str  # TrnHdr<short>: <short>ID / <short>NO / Print<short>NO / <short>Date
    dtl_table: str  # detail table (its id column is <short>ID, plus SlNo / ItemSlNO / ShortClosed...)


SPECS = {"group-sevas": Spec("group-sevas", 1264, "Group Seva", "GRPSEVA", "TrnDtlGrpSeva")}


def create(conn: Connection, spec: Spec, *, fields: dict, lines: list[dict], doc_date: date, fy: FinancialYear, user_code: str) -> dict:
    s = spec.short
    assert_date_in_fy(doc_date, fy)
    if not lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one line")
    rows = doc_rules.load_fields(conn, spec.doc_id)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{spec.name} has no fields configured in the Doc Designer")
    head = [r for r in rows if (r.get("FldSection") or "Header") != "Detail"]
    detail = [r for r in rows if r.get("FldSection") == "Detail"]
    values = doc_rules.effective_values(rows, fields)
    doc_rules.validate(head, values, fy=fy)
    doc_rules.check_duplicate_lines(detail, lines)
    for i, line in enumerate(lines, start=1):
        try:
            doc_rules.validate(detail, {**values, **line})
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f"Line {i}: {exc.detail}")

    prefixes = resolve_prefix(conn, doc_id=spec.doc_id, field_values={k: str(v) for k, v in values.items()})
    if not prefixes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No document-number prefix configured for {spec.name}")
    prefix = prefixes[0]
    doc_no = next_doc_no(
        conn, table_name=f"TrnHdr{s}", no_column=f"{s}NO", prefix=prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    cols = doc_rules.column_values(head, values, table(f"TrnHdr{s}"))
    cols.update({f"{s}NO": doc_no, "Prefix": prefix, f"Print{s}NO": doc_no, f"{s}Date": doc_date,
                 "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now()})
    new_id = insert_row(conn, f"TrnHdr{s}", cols, returning=f"{s}ID")
    for i, line in enumerate(lines, start=1):
        lv = doc_rules.effective_values(detail, line)
        dcols = doc_rules.column_values(detail, lv, table(spec.dtl_table))
        dcols.update({f"{s}ID": new_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0})
        insert_row(conn, spec.dtl_table, dcols)
    audit.record(conn, entity=spec.name, entity_id=new_id, action="A", user_code=user_code, details=doc_no)
    return {"id": new_id, "no": doc_no}


def update(conn: Connection, spec: Spec, *, row_id: int, fields: dict, lines: list[dict], doc_date: date, fy: FinancialYear, user_code: str) -> dict:
    """
    Edit a saved document: the number (<short>NO / Prefix / Print<short>NO) and who/when it was added stay as they are; the header and the
    lines are rewritten for the new values. A Group Seva that Seva Entries were already made from is not rewritten (those bills point at it).
    """
    s = spec.short
    old = conn.execute(text(f"SELECT {s}NO, Print{s}NO, Cancelled, {s}Date, Authorised FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": row_id}).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{spec.name} not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, spec.doc_id, doc_date=old[f"{s}Date"], authorised=old["Authorised"])
    if s == "GRPSEVA" and conn.execute(text("SELECT TOP 1 1 FROM TrnHdrSEVA WHERE GRPSEVAID = :id"), {"id": row_id}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Seva entries were already made from this group, so it cannot be changed")
    assert_date_in_fy(doc_date, fy)
    if not lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one line")
    rows = doc_rules.load_fields(conn, spec.doc_id)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{spec.name} has no fields configured in the Doc Designer")
    head = [r for r in rows if (r.get("FldSection") or "Header") != "Detail"]
    detail = [r for r in rows if r.get("FldSection") == "Detail"]
    values = doc_rules.effective_values(rows, fields)
    doc_rules.validate(head, values, fy=fy)
    doc_rules.check_duplicate_lines(detail, lines)
    for i, line in enumerate(lines, start=1):
        try:
            doc_rules.validate(detail, {**values, **line})
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f"Line {i}: {exc.detail}")

    cols = doc_rules.column_values(head, values, table(f"TrnHdr{s}"))
    for keep in (f"{s}NO", "Prefix", f"Print{s}NO", "AddedBy", "AddedOn", "Cancelled"):
        cols.pop(keep, None)
    cols.update({f"{s}Date": doc_date, "ChangedBy": user_code, "ChangedOn": datetime.now()})
    if edit_rules.auth_required(conn, spec.doc_id):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation
    update_row(conn, f"TrnHdr{s}", f"{s}ID", row_id, cols)  # columns this database does not have are skipped by update_row
    conn.execute(text(f"DELETE FROM {spec.dtl_table} WHERE {s}ID = :id"), {"id": row_id})
    for i, line in enumerate(lines, start=1):
        lv = doc_rules.effective_values(detail, line)
        dcols = doc_rules.column_values(detail, lv, table(spec.dtl_table))
        dcols.update({f"{s}ID": row_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0})
        insert_row(conn, spec.dtl_table, dcols)
    audit.record(conn, entity=spec.name, entity_id=row_id, action="E", user_code=user_code, details=old[f"{s}NO"])
    return {"id": row_id, "no": old[f"{s}NO"]}


def list_recent(conn: Connection, spec: Spec, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    s = spec.short
    sql = f"SELECT * FROM TrnHdr{s} WHERE {s}Date BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += f" AND ({s}NO LIKE :q OR NAME LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY {s}ID DESC {limit_clause(top)}"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def get(conn: Connection, spec: Spec, row_id: int) -> dict:
    s = spec.short
    row = conn.execute(text(f"SELECT * FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": row_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{spec.name} not found")
    out = dict(row)
    out["lines"] = [dict(r) for r in conn.execute(text(f"SELECT * FROM {spec.dtl_table} WHERE {s}ID = :id ORDER BY SlNo"), {"id": row_id}).mappings().all()]
    return out


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
    conn.execute(text(f"DELETE FROM {spec.dtl_table} WHERE {s}ID = :id"), {"id": row_id})
    conn.execute(text(f"DELETE FROM TrnHdr{s} WHERE {s}ID = :id"), {"id": row_id})
    audit.record(conn, entity=spec.name, entity_id=row_id, action="D", user_code=user_code)
