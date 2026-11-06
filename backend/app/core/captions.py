"""
Captions for screens that have no Doc Designer entry (legacy forms without a DocID): the heading is the REAL column name
from the database, tidied for reading, so nothing is typed into the code. `UtlGSettings.SetCaption` and the menu caption
are used first where they exist (see `menu_title` and `app.services.settings.get_setting`).
"""
from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.engine import Connection

_WORD = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+")


def tidy(column: str) -> str:
    """STAFFCode -> "Staff Code", HolidayName -> "Holiday Name", OPRefNo -> "OP Ref No", AttType -> "Att Type"."""
    words = _WORD.findall(column or "")
    return " ".join(w.capitalize() if (w.isupper() and len(w) > 3) else w for w in words)


def captions(columns: dict[str, str]) -> dict[str, str]:
    """{ "code": "STAFFCode", ... } -> { "code": "Staff Code", ... }"""
    return {k: tidy(v) for k, v in columns.items()}


def menu_title(conn: Connection, *, form_key: str | None = None, caption: str | None = None) -> str:
    """The caption of the menu row that opens a legacy screen (what the user clicked), by form name or by caption."""
    if form_key:
        row = conn.execute(
            text("SELECT TOP 1 MenuItemCaption FROM MstMenu WHERE UPPER(LTRIM(RTRIM(ISNULL(FrmName, '')))) = :f ORDER BY CASE WHEN MenuShow = 'Y' THEN 0 ELSE 1 END, MenuItemID"),
            {"f": form_key.strip().upper()},
        ).scalar()
        if row:
            return row.strip()
    if caption:
        row = conn.execute(
            text("SELECT TOP 1 MenuItemCaption FROM MstMenu WHERE UPPER(LTRIM(RTRIM(ISNULL(MenuItemCaption, '')))) = :c ORDER BY CASE WHEN MenuShow = 'Y' THEN 0 ELSE 1 END, MenuItemID"),
            {"c": caption.strip().upper()},
        ).scalar()
        if row:
            return row.strip()
    return ""
