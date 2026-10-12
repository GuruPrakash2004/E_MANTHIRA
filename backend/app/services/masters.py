"""
Generic master CRUD — port of `frmMstGeneral` (doc 07 §5.2). One service
handles every `TrnDocType='General'` master (Sannidhi, Seva, Gothra,
Nakshatra, Rashi, Hall, Event, Ledger Group, Ledger, ...) by reading its
column layout from `UtlTransactions` (DocShForm -> <SF>ID/<SF>CODE/<SF>NAME/
<SF>Series/<SF>NO), exactly like the legacy screen does — never hard-coded
per master (CLAUDE.md rule 5 / doc 09 finding N3).
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.legacy.tables import insert_row, next_master_id, update_row


@dataclass
class MasterMeta:
    doc_id: int
    table: str
    id_col: str
    code_col: str
    name_col: str
    series_col: str
    no_col: str
    auth_req: bool
    caption: str
    short_form: str
    file_attach_req: bool = False


def get_meta(conn: Connection, doc_id: int) -> MasterMeta:
    row = conn.execute(text("SELECT * FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")
    sf = (row["DocShForm"] or "").strip()
    if not sf:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This document has no short form (not a simple master)")
    return MasterMeta(
        doc_id=doc_id,
        table=row["HdrTblName"],
        id_col=f"{sf}ID",
        code_col=f"{sf}CODE",
        name_col=f"{sf}NAME",
        series_col=f"{sf}Series",
        no_col=f"{sf}No",
        auth_req=(row["AuthReq"] or "N").strip().upper() == "Y",
        caption=row["DocName"] or sf,
        short_form=sf,
        file_attach_req=(row["FileAttachReq"] or "N").strip().upper() == "Y",
    )


# Columns no generic list/edit screen should ever receive over the wire —
# `LoginPwd` stays 3DES-encrypted at rest (CLAUDE.md §8) but there's still no
# reason to ship it to the browser; password changes go through the dedicated
# /users/{id}/password endpoint instead (app/api/v1/users.py).
_SENSITIVE_COLUMNS = {"LoginPwd", "OTP"}


def _json_safe(row: dict) -> dict:
    """
    Drop raw binary columns (e.g. `MstUser.UserImg`) before this goes anywhere
    near `jsonable_encoder` — it calls `bytes.decode()` with no error handling
    and crashes on non-UTF-8 image bytes. Nothing in this generic API surface
    consumes binary blobs, so None is the right value, not an encoding.
    """
    return {k: (None if isinstance(v, (bytes, bytearray)) else v) for k, v in row.items() if k not in _SENSITIVE_COLUMNS}


def list_rows(conn: Connection, meta: MasterMeta, *, search: str = "", top: int = 200, include_inactive: bool = True) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT * FROM {meta.table} WHERE {meta.id_col} >= 0"
    params: dict = {}
    if search:
        sql += f" AND ({meta.code_col} LIKE :q OR {meta.name_col} LIKE :q)"
        params["q"] = f"%{search}%"
    if not include_inactive:
        sql += " AND (InActive IS NULL OR InActive <> 'Y')"
    sql += f" ORDER BY {meta.id_col} {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [_json_safe(dict(r)) for r in rows]


def get_row(conn: Connection, meta: MasterMeta, row_id: int) -> dict:
    row = conn.execute(text(f"SELECT * FROM {meta.table} WHERE {meta.id_col} = :id"), {"id": row_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{meta.caption} not found")
    return _json_safe(dict(row))


def _code_exists(conn: Connection, meta: MasterMeta, code: str, exclude_id: int | None) -> bool:
    sql = f"SELECT 1 FROM {meta.table} WHERE {meta.code_col} = :code"
    params: dict = {"code": code}
    if exclude_id is not None:
        sql += f" AND {meta.id_col} <> :id"
        params["id"] = exclude_id
    return conn.execute(text(sql), params).first() is not None


def create(conn: Connection, meta: MasterMeta, *, values: dict, user_code: str) -> dict:
    code = (values.get(meta.code_col) or "").strip()
    name = (values.get(meta.name_col) or "").strip()
    if not code:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{meta.short_form} Code should not be blank!")
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{meta.short_form} Name should not be blank!")
    if _code_exists(conn, meta, code, None):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{meta.caption} already exists..")
    if (values.get("InActive") or "N").strip().upper() == "Y" and not (values.get("InActiveRmks") or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter remarks for why the record is inactive!")

    new_id = next_master_id(conn, meta.table, meta.id_col)
    payload = {
        **values,
        meta.id_col: new_id,
        "AddedBy": user_code,
        "AddedOn": None,
        "Authorised": "N" if meta.auth_req else "Y",
    }
    if not meta.auth_req:
        payload["AuthBy"] = user_code
    from datetime import datetime

    payload["AddedOn"] = datetime.now()
    insert_row(conn, meta.table, payload)
    if meta.short_form.upper() in ("LED", "LEDGER"):
        _sync_mstacled(conn, meta, new_id, name, is_new=True)
    audit.record(conn, entity=meta.caption, entity_id=new_id, action="A", user_code=user_code, details=code)
    return get_row(conn, meta, new_id)


def _sync_mstacled(conn: Connection, meta: MasterMeta, ledger_id: int, display_name: str, *, is_new: bool) -> None:
    """Port of `frmMstGeneral.updateLed` — keeps the MstAcLed posting-account mirror in sync."""
    led_group_id = conn.execute(text(f"SELECT LedGroupID FROM {meta.table} WHERE {meta.id_col} = :id"), {"id": ledger_id}).scalar() or 0
    existing = conn.execute(
        text("SELECT AcLedID FROM MstAcLed WHERE MstDocID = :doc AND LedMstID = :lid"), {"doc": meta.doc_id, "lid": ledger_id}
    ).scalar()
    if existing is None:
        new_ac_id = next_master_id(conn, "MstAcLed", "AcLedID")
        insert_row(
            conn, "MstAcLed",
            {"AcLedID": new_ac_id, "AcLedName": display_name, "LedType": "L", "LedMstID": ledger_id, "LedGroupId": led_group_id, "MstDocID": meta.doc_id},
        )
    else:
        update_row(conn, "MstAcLed", "AcLedID", existing, {"AcLedName": display_name, "LedGroupId": led_group_id})


def update(conn: Connection, meta: MasterMeta, row_id: int, *, values: dict, user_code: str) -> dict:
    existing = get_row(conn, meta, row_id)
    code = (values.get(meta.code_col) or existing[meta.code_col] or "").strip()
    if _code_exists(conn, meta, code, row_id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{meta.caption} already exists..")
    if (values.get("InActive") or existing.get("InActive") or "N").strip().upper() == "Y" and not (
        values.get("InActiveRmks") or existing.get("InActiveRmks") or ""
    ).strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter remarks for why the record is inactive!")

    from datetime import datetime

    update_row(conn, meta.table, meta.id_col, row_id, {**values, "ChangedBy": user_code, "ChangedOn": datetime.now()})
    if meta.short_form.upper() in ("LED", "LEDGER"):
        _sync_mstacled(conn, meta, row_id, code, is_new=False)
    audit.record(conn, entity=meta.caption, entity_id=row_id, action="M", user_code=user_code, details=code)
    return get_row(conn, meta, row_id)


def delete(conn: Connection, meta: MasterMeta, row_id: int, *, user_code: str) -> None:
    get_row(conn, meta, row_id)  # 404 if missing
    if meta.short_form.upper() in ("LED", "LEDGER"):
        ac_led_id = conn.execute(
            text("SELECT AcLedID FROM MstAcLed WHERE MstDocID = :doc AND LedMstID = :lid"), {"doc": meta.doc_id, "lid": row_id}
        ).scalar()
        from app.core.db import limit_clause

        if ac_led_id and conn.execute(
            text(f"SELECT AccID FROM TrnDtlAcc WHERE AcLedID = :id ORDER BY AccID {limit_clause(1)}"), {"id": ac_led_id}
        ).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "Accounting Transaction is available.. Cannot Delete..")
        conn.execute(text("DELETE FROM MstAcLed WHERE MstDocID = :doc AND LedMstID = :lid"), {"doc": meta.doc_id, "lid": row_id})
    conn.execute(text(f"DELETE FROM {meta.table} WHERE {meta.id_col} = :id"), {"id": row_id})
    conn.execute(text("DELETE FROM UtlAttachFiles WHERE DocID = :doc AND DocValueID = :val"), {"doc": meta.doc_id, "val": str(row_id)})
    audit.record(conn, entity=meta.caption, entity_id=row_id, action="D", user_code=user_code)
