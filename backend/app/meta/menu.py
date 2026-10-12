"""
Menu tree + rights resolution — read straight from the legacy metadata tables
(MstMenu, MstRoleRights, MstUserRights, UtlMisc), never hard-coded, per
CLAUDE.md rule 5 ("metadata is the source of truth, like the old app").
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

MENU_TYPE_NAMES = {
    1: "Masters",
    2: "Transactions",
    3: "Vouchers",
    4: "Reports",
    5: "Ac-Reports",
    6: "Tools",
    7: "Utilities",
}

# 12-char rights string positions (1-indexed, matches svtModule.chkRightsPos)
RIGHT_ADD = 1
RIGHT_EDIT = 2
RIGHT_DELETE = 3
RIGHT_PRINT = 4
RIGHT_VIEW = 5
RIGHT_AUTH = 6
RIGHT_AUTH2 = 7
RIGHT_OPT1 = 8
RIGHT_OPT2 = 9
RIGHT_OPT3 = 10
RIGHT_OPT4 = 11
RIGHT_OPT5 = 12

DEFAULT_RIGHTS = "000000000000"  # deny-by-default, same fallback as legacy


def get_menu_tree(conn: Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(
            """
            SELECT MenuItemID, MenuItemCaption, MenuItemType, DocID, FrmName,
                   MenuGroupName, Menuindex, SCKeys
            FROM MstMenu
            WHERE MenuShow = 'Y'
            ORDER BY MenuItemType, Menuindex
            """
        )
    ).mappings().all()
    return [
        {
            "menu_item_id": r["MenuItemID"],
            "caption": r["MenuItemCaption"],
            "type": MENU_TYPE_NAMES.get(r["MenuItemType"], str(r["MenuItemType"])),
            "doc_id": r["DocID"],
            "form_key": (r["FrmName"] or "").strip(),
            "group": (r["MenuGroupName"] or "").strip(),
            "shortcut": (r["SCKeys"] or "").strip(),
        }
        for r in rows
    ]


def is_user_based_rights(conn: Connection) -> bool:
    row = conn.execute(text("SELECT UserBased FROM UtlMisc")).scalar()
    return (row or "N").strip().upper() == "Y"


def resolve_menu_item_id(conn: Connection, doc_id: int) -> int | None:
    """First visible menu item that opens this DocID (there is usually exactly one)."""
    from app.core.db import limit_clause

    return conn.execute(
        text(f"SELECT MenuItemID FROM MstMenu WHERE DocID = :doc_id AND MenuShow = 'Y' ORDER BY MenuItemID {limit_clause(1)}"),
        {"doc_id": doc_id},
    ).scalar()


def get_rights_string(conn: Connection, *, user_id: int, role_id: int, user_code: str, menu_item_id: int) -> str:
    if user_code.strip().upper() == "ADMIN":
        return "1" * 12
    if is_user_based_rights(conn):
        row = conn.execute(
            text("SELECT UserRights FROM MstUserRights WHERE UserId = :uid AND MenuItemID = :mid"),
            {"uid": user_id, "mid": menu_item_id},
        ).scalar()
    else:
        row = conn.execute(
            text("SELECT RoleRights FROM MstRoleRights WHERE RoleID = :rid AND MenuItemID = :mid"),
            {"rid": role_id, "mid": menu_item_id},
        ).scalar()
    return row or DEFAULT_RIGHTS


def has_right(rights: str, position: int) -> bool:
    if len(rights) < position:
        return False
    return rights[position - 1] == "1"
