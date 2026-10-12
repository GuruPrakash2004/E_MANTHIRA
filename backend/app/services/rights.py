"""
Role rights matrix — reads/writes `MstRoleRights.RoleRights`, the same
12-char position string the legacy `frmMstRights` screen edits (CLAUDE.md
§6: "Rights string (12 chars): 1 Add, 2 Edit, 3 Delete, 4 Print, 5 View, 6
Auth, 7 Auth2, 8-12 Opt1-5"). This admin UI only ever shows/edits the first
four (Open=View, Add/Save, Edit, Delete/Cancel — the ones the reference
Softvent admin screen surfaces) and preserves whatever the legacy EXE has
set for Print/Auth/Auth2/Opt1-5 on every save.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.meta.menu import MENU_TYPE_NAMES

_LEN = 12
_POS_ADD, _POS_EDIT, _POS_DELETE, _POS_PRINT, _POS_VIEW = 0, 1, 2, 3, 4


def _decode(rights: str | None) -> dict:
    r = (rights or "").ljust(_LEN, "0")
    return {
        "open": r[_POS_VIEW] == "1",
        "add": r[_POS_ADD] == "1",
        "edit": r[_POS_EDIT] == "1",
        "delete": r[_POS_DELETE] == "1",
    }


def _encode(existing: str | None, flags: dict) -> str:
    r = list((existing or "").ljust(_LEN, "0")[:_LEN])
    r[_POS_VIEW] = "1" if flags.get("open") else "0"
    r[_POS_ADD] = "1" if flags.get("add") else "0"
    r[_POS_EDIT] = "1" if flags.get("edit") else "0"
    r[_POS_DELETE] = "1" if flags.get("delete") else "0"
    return "".join(r)


def list_rights(conn: Connection, role_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT m.MenuItemID, m.MenuItemCaption, m.MenuItemType, rr.RoleRights
            FROM MstMenu m
            LEFT JOIN MstRoleRights rr ON rr.MenuItemID = m.MenuItemID AND rr.RoleID = :role_id
            WHERE m.MenuItemCaption IS NOT NULL AND m.MenuItemCaption <> ''
            ORDER BY m.MenuItemType, m.Menuindex
            """
        ),
        {"role_id": role_id},
    ).mappings().all()
    return [
        {
            "menu_item_id": r["MenuItemID"],
            "caption": r["MenuItemCaption"],
            "type": MENU_TYPE_NAMES.get(r["MenuItemType"], str(r["MenuItemType"])),
            **_decode(r["RoleRights"]),
        }
        for r in rows
    ]


def save_rights(conn: Connection, role_id: int, items: list[dict]) -> None:
    for item in items:
        menu_item_id = item["menu_item_id"]
        existing = conn.execute(
            text("SELECT RoleRights FROM MstRoleRights WHERE RoleID = :r AND MenuItemID = :m"),
            {"r": role_id, "m": menu_item_id},
        ).scalar()
        encoded = _encode(existing, item)
        if existing is None:
            conn.execute(
                text("INSERT INTO MstRoleRights (RoleID, MenuItemID, RoleRights) VALUES (:r, :m, :v)"),
                {"r": role_id, "m": menu_item_id, "v": encoded},
            )
        else:
            conn.execute(
                text("UPDATE MstRoleRights SET RoleRights = :v WHERE RoleID = :r AND MenuItemID = :m"),
                {"r": role_id, "m": menu_item_id, "v": encoded},
            )
