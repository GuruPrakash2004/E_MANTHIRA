"""
Menu tree + rights resolution — read straight from the legacy metadata tables
(MstMenu, MstRoleRights, MstUserRights, UtlMisc), never hard-coded, per
CLAUDE.md rule 5 ("metadata is the source of truth, like the old app").
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text

from app.core import cache
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

# Legacy sidebar layout: MenuItemType -> (top-level section, section order, default sub-group heading).
# Vouchers (3) and Ac-Reports (5) share the ACCOUNTING section, exactly as the legacy menu tree shows them.
# Sub-group headings inside Masters come from MstMenu.MenuGroupName; items and their order are pure data.
MENU_SECTIONS = {
    1: ("Masters", 1, ""),
    2: ("Transactions", 2, ""),
    4: ("Reports", 3, ""),
    3: ("Accounting", 4, "Vouchers"),
    5: ("Accounting", 4, "Accounting Reports"),
    6: ("Tools", 5, ""),
    7: ("Utilities", 6, ""),
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
            "section": MENU_SECTIONS.get(r["MenuItemType"], (MENU_TYPE_NAMES.get(r["MenuItemType"], str(r["MenuItemType"])), 99, ""))[0],
            "section_order": MENU_SECTIONS.get(r["MenuItemType"], ("", 99, ""))[1],
            "subgroup": (r["MenuGroupName"] or "").strip() or MENU_SECTIONS.get(r["MenuItemType"], ("", 99, ""))[2],
            "shortcut": (r["SCKeys"] or "").strip(),
        }
        for r in rows
    ]


_RIGHTS_TTL = 30  # seconds — in-app rights edits call invalidate() so they show at once


def invalidate() -> None:
    """Call after any in-app write to MstMenu / MstRoleRights / MstUserRights / UtlMisc."""
    cache.clear("menu")
    cache.clear("rights")


def is_user_based_rights(conn: Connection) -> bool:
    def load() -> bool:
        row = conn.execute(text("SELECT UserBased FROM UtlMisc")).scalar()
        return (row or "N").strip().upper() == "Y"

    return cache.get_or_set(("rights", "userbased"), _RIGHTS_TTL, load)


def get_rights_map(conn: Connection, *, user_id: int, role_id: int) -> dict[int, str]:
    """Every menu item's rights string for this user/role in ONE query (was 2 per menu item)."""

    def load() -> dict[int, str]:
        if is_user_based_rights(conn):
            rows = conn.execute(
                text("SELECT MenuItemID, UserRights FROM MstUserRights WHERE UserId = :uid"), {"uid": user_id}
            ).all()
        else:
            rows = conn.execute(
                text("SELECT MenuItemID, RoleRights FROM MstRoleRights WHERE RoleID = :rid"), {"rid": role_id}
            ).all()
        return {int(r[0]): (r[1] or DEFAULT_RIGHTS) for r in rows}

    return cache.get_or_set(("rights", "map", user_id, role_id), _RIGHTS_TTL, load)


def resolve_menu_item_id(conn: Connection, doc_id: int) -> int | None:
    """First visible menu item that opens this DocID (there is usually exactly one)."""
    from app.core.db import limit_clause

    def load() -> int | None:
        return conn.execute(
            text(f"SELECT MenuItemID FROM MstMenu WHERE DocID = :doc_id AND MenuShow = 'Y' ORDER BY MenuItemID {limit_clause(1)}"),
            {"doc_id": doc_id},
        ).scalar()

    return cache.get_or_set(("menu", "item", doc_id), _RIGHTS_TTL, load)


def get_rights_string(conn: Connection, *, user_id: int, role_id: int, user_code: str, menu_item_id: int) -> str:
    if user_code.strip().upper() == "ADMIN":
        return "1" * 12
    return get_rights_map(conn, user_id=user_id, role_id=role_id).get(int(menu_item_id), DEFAULT_RIGHTS)


def has_right(rights: str, position: int) -> bool:
    if len(rights) < position:
        return False
    return rights[position - 1] == "1"
