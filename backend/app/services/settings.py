"""
Global Settings — grouped grid of `UtlGSettings` (doc 07 §5.9: "grouped grid
of UtlGSettings (Set Group, Setting caption, Value, Remarks), hide
HideSetting='Y' unless ADMIN"). Read/write only `SetValue`; every other
column (caption, remarks, drop-down list, data type, ...) is metadata the
legacy Designer tool owns, same boundary as the Doc Designer removal.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection


def list_settings(conn: Connection, *, is_admin: bool) -> list[dict]:
    sql = "SELECT SetGroup, SetName, SetValue, SetCaption, Remarks, HideSetting, DropDownList, Mandatory, DataType FROM UtlGSettings"
    # the legacy Global Settings screen lists only HideSetting <> 'Y' rows, for ADMIN too
    sql += " WHERE (HideSetting IS NULL OR HideSetting <> 'Y')"
    sql += " ORDER BY SetGroup, SetName"
    rows = conn.execute(text(sql)).mappings().all()
    return [
        {
            "group": (r["SetGroup"] or "").strip() or "General",
            "name": r["SetName"],
            "value": r["SetValue"] or "",
            "caption": r["SetCaption"] or r["SetName"],
            "remarks": r["Remarks"] or "",
            "hidden": (r["HideSetting"] or "N").strip().upper() == "Y",
            "dropdown_list": r["DropDownList"] or "",
            "mandatory": (r["Mandatory"] or "N").strip().upper() == "Y",
            "data_type": r["DataType"] or "",
        }
        for r in rows
    ]


def set_value(conn: Connection, *, set_group: str, set_name: str, set_value: str) -> None:
    result = conn.execute(
        text("UPDATE UtlGSettings SET SetValue = :v WHERE SetGroup = :g AND SetName = :n"),
        {"v": set_value, "g": set_group, "n": set_name},
    )
    if result.rowcount == 0:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, "Setting not found")


def save_many(conn: Connection, items: list[dict]) -> int:
    """Legacy UpdateValDtl: update the value of every edited row (matched by group + name)."""
    n = 0
    for it in items:
        set_value(conn, set_group=it["group"], set_name=it["name"], set_value=(it.get("value") or "").strip())
        n += 1
    return n


def create_setting(conn: Connection, *, group: str, name: str, caption: str, value: str, remarks: str, hide: bool) -> None:
    """Legacy "Add": a new UtlGSettings row (FldCode / SetName must be unique, caption required)."""
    from fastapi import HTTPException, status

    from app.legacy.tables import insert_row

    name, caption = (name or "").strip(), (caption or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "FldCode should not be blank!!!")
    if not caption:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "FldCaption should not be blank!!!")
    if conn.execute(text("SELECT 1 FROM UtlGSettings WHERE SetName = :n"), {"n": name}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "FldCode already exists...")
    insert_row(
        conn,
        "UtlGSettings",
        {"SetGroup": (group or "").strip(), "SetName": name, "SetValue": (value or "").strip(), "SetCaption": caption, "Remarks": (remarks or "").strip(), "HideSetting": "Y" if hide else "N"},
    )
