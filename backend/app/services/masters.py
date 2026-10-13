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
    inactive_rmks_col: str = "InActiveRmks"
    restrict_code_chars: str | None = None  # characters removed from the code (UtlTransactions.FldBlnRestrictSplCharCode)
    restrict_name_chars: str | None = None


def get_meta(conn: Connection, doc_id: int) -> MasterMeta:
    row = conn.execute(text("SELECT * FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")
    sf = (row["DocShForm"] or "").strip()
    if not sf:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This document has no short form (not a simple master)")
    from app.meta.master_layouts import META_OVERRIDES

    override = META_OVERRIDES.get(doc_id, {})
    return MasterMeta(
        doc_id=doc_id,
        table=row["HdrTblName"],
        id_col=f"{sf}ID",
        code_col=override.get("code_col", f"{sf}CODE"),
        name_col=override.get("name_col", f"{sf}NAME"),
        series_col=f"{sf}Series",
        no_col=f"{sf}No",
        auth_req=(row["AuthReq"] or "N").strip().upper() == "Y",
        caption=row["DocName"] or sf,
        short_form=sf,
        file_attach_req=(row["FileAttachReq"] or "N").strip().upper() == "Y",
        inactive_rmks_col=override.get("inactive_rmks_col", "InActiveRmks"),
        restrict_code_chars=(row["FldStrSplCharCode"] or "") if (row["FldBlnRestrictSplCharCode"] or "N").strip().upper() == "Y" else None,
        restrict_name_chars=(row["FldStrSplCharName"] or "") if (row["FldBlnRestrictSplCharName"] or "N").strip().upper() == "Y" else None,
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


def _alias_rmks(meta: MasterMeta, row: dict) -> dict:
    if meta.inactive_rmks_col != "InActiveRmks":
        row["InActiveRmks"] = row.get(meta.inactive_rmks_col)
    return row


def remove_spl_characters(value: str, chars: str = "") -> str:
    """svtModule.RemoveSplCharacter: strip the configured characters (default set when none configured)."""
    drop = ('"' + chars) if chars else "\"#$%&'()*+,-./\\~"
    return "".join(c for c in value if c not in drop)


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
    return [_alias_rmks(meta, _json_safe(dict(r))) for r in rows]


def get_row(conn: Connection, meta: MasterMeta, row_id: int) -> dict:
    row = conn.execute(text(f"SELECT * FROM {meta.table} WHERE {meta.id_col} = :id"), {"id": row_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{meta.caption} not found")
    return _alias_rmks(meta, _json_safe(dict(row)))


def _code_exists(conn: Connection, meta: MasterMeta, code: str, exclude_id: int | None) -> bool:
    sql = f"SELECT 1 FROM {meta.table} WHERE {meta.code_col} = :code"
    params: dict = {"code": code}
    if exclude_id is not None:
        sql += f" AND {meta.id_col} <> :id"
        params["id"] = exclude_id
    return conn.execute(text(sql), params).first() is not None


def _check_required(meta: MasterMeta, merged: dict) -> None:
    """Mandatory built-in fields of the master (see app/meta/master_layouts.py), like the legacy form's red captions."""
    from app.meta.master_layouts import required_fields

    for code, caption in required_fields(meta.doc_id):
        v = merged.get(code)
        if v is None or str(v).strip() in ("", "0"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{caption} should not be blank!")


def create(conn: Connection, meta: MasterMeta, *, values: dict, user_code: str) -> dict:
    code = (values.get(meta.code_col) or "").strip()
    name = (values.get(meta.name_col) or "").strip()
    if not code:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{meta.short_form} Code should not be blank!")
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{meta.short_form} Name should not be blank!")
    _check_required(meta, values)
    values = _prepare_values(meta, values)
    code, name = values[meta.code_col], values[meta.name_col]
    from app.services import master_extras

    if not master_extras.validate_master(conn, meta, values, None) and _code_exists(conn, meta, code, None):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{meta.caption} already exists..")
    if (values.get("InActive") or "N").strip().upper() == "Y" and not (values.get(meta.inactive_rmks_col) or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter remarks for why the record is inactive!")

    new_id = next_master_id(conn, meta.table, meta.id_col)
    payload = {
        **values,
        meta.id_col: new_id,
        "AddedBy": user_code,
        "AddedOn": None,
        "Authorised": "N" if meta.auth_req else "Y",
    }
    from datetime import datetime

    if not meta.auth_req:
        payload["AuthBy"] = user_code
        payload["AuthOn"] = datetime.now()
    payload["AddedOn"] = datetime.now()
    insert_row(conn, meta.table, payload)
    if meta.short_form.upper() in ("LED", "LEDGER"):
        _sync_mstacled(conn, meta, new_id, code, name)
    elif meta.short_form.upper() in PARTY_SHORT_FORMS:
        master_extras.sync_party_acled(conn, meta, new_id, code, name)
    audit.record(conn, entity=meta.caption, entity_id=new_id, action="A", user_code=user_code, details=code)
    return get_row(conn, meta, new_id)


PARTY_SHORT_FORMS = ("SUPP", "CUST")


def _prepare_values(meta: MasterMeta, values: dict) -> dict:
    """Trim code/name, apply the configured special-character restriction, and map the inactive-remarks column."""
    out = dict(values)
    code = str(out.get(meta.code_col) or "").strip()
    name = str(out.get(meta.name_col) or "").strip()
    if meta.restrict_code_chars is not None:
        code = remove_spl_characters(code, meta.restrict_code_chars)
    if meta.restrict_name_chars is not None:
        name = remove_spl_characters(name, meta.restrict_name_chars)
    out[meta.code_col] = code
    out[meta.name_col] = name
    if meta.inactive_rmks_col != "InActiveRmks" and "InActiveRmks" in out:
        out[meta.inactive_rmks_col] = out.pop("InActiveRmks")
    return out


def _sync_mstacled(conn: Connection, meta: MasterMeta, ledger_id: int, code: str, name: str) -> None:
    """Port of `frmMstGeneral.updateLed` — keeps the MstAcLed posting-account mirror in sync (only when vouchers exist)."""
    from app.services import master_extras

    if not master_extras.voucher_present(conn):
        return
    display_name = master_extras.ac_led_name(conn, code, name)
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
    _check_required(meta, {**existing, **values})
    values = _prepare_values(meta, {**values, **{k: values.get(k, existing.get(k)) for k in (meta.code_col, meta.name_col)}})
    code, name = values[meta.code_col], values[meta.name_col]
    if not code:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{meta.short_form} Code should not be blank!")
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{meta.short_form} Name should not be blank!")
    from app.services import master_extras

    if not master_extras.validate_master(conn, meta, {**existing, **values}, row_id) and _code_exists(conn, meta, code, row_id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{meta.caption} already exists..")
    if (values.get("InActive") or existing.get("InActive") or "N").strip().upper() == "Y" and not (
        values.get(meta.inactive_rmks_col) or existing.get(meta.inactive_rmks_col) or ""
    ).strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter remarks for why the record is inactive!")

    from datetime import datetime

    changes = {**values, "ChangedBy": user_code, "ChangedOn": datetime.now()}
    if meta.short_form.upper() in PARTY_SHORT_FORMS and meta.auth_req:
        changes.update({"Authorised": "N", "AuthBy": "", "AuthOn": None})  # an edited party needs approving again
    update_row(conn, meta.table, meta.id_col, row_id, changes)
    if meta.short_form.upper() in ("LED", "LEDGER"):
        _sync_mstacled(conn, meta, row_id, code, name)
    elif meta.short_form.upper() in PARTY_SHORT_FORMS:
        master_extras.sync_party_acled(conn, meta, row_id, code, name)
    audit.record(conn, entity=meta.caption, entity_id=row_id, action="M", user_code=user_code, details=code)
    return get_row(conn, meta, row_id)


def delete(conn: Connection, meta: MasterMeta, row_id: int, *, user_code: str) -> None:
    get_row(conn, meta, row_id)  # 404 if missing
    from app.services import master_extras

    master_extras.check_delete_ok(conn, meta, row_id)  # svtModule.blnDeleteOK: "Cannot Delete!!! Data ... exists in ..."
    if meta.short_form.upper() in PARTY_SHORT_FORMS:
        master_extras.delete_party_children(conn, meta, row_id)
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
