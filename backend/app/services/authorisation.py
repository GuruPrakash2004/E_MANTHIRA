"""
Authorise Documents — port of legacy fmtUtlAuth (pending counts per document and level) + frmUtlAuthDoc (the pending
list and the Authorise action).

Which documents need authorisation comes from UtlTransactions (AuthReq='Y', NoOfAuth = number of levels, 0 means 1);
the level a user may authorise is rights position 6 (level 1), 7 (level 2), 8 ... 12 — ADMIN may authorise every level.
Level 1 flips Authorised/AuthBy/AuthOn, level n flips Authorised<n>/AuthBy<n>/AuthOn<n>, exactly as the legacy UPDATE.
"""
from __future__ import annotations

import re
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.security import CurrentUser
from app.meta import menu as meta_menu

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ORDINAL = {1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", 6: "Sixth", 7: "Seventh"}


def _ident(v: str) -> str:
    if not _IDENT.match(v or ""):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unsafe identifier in UtlTransactions: {v!r}")
    return v


def level_label(level: int) -> str:
    return _ORDINAL.get(level, f"Level {level}")


def _docs(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT t.DocID, t.DocName, t.DocShForm, t.HdrTblName, t.DocType, m.MenuItemID, t.NoOfAuth "
            "FROM UtlTransactions t, MstMenu m WHERE t.DocID = m.DocID AND t.AuthReq = 'Y' ORDER BY t.DocType, t.DocName"
        )
    ).mappings().all()
    return [
        {
            "doc_id": r["DocID"],
            "name": r["DocName"],
            "sh_form": (r["DocShForm"] or "").strip(),
            "table": (r["HdrTblName"] or "").strip(),
            "type": r["DocType"],
            "menu_id": r["MenuItemID"],
            "levels": int(r["NoOfAuth"] or 0) or 1,
        }
        for r in rows
    ]


def _level_cond(level: int, *, transaction: bool) -> str:
    cond = " AND Cancelled = 'N'" if transaction else ""
    if level == 1:
        return cond + " AND Authorised = 'N'"
    if level == 2:
        return cond + " AND Authorised = 'Y' AND Authorised2 = 'N'"
    return cond + f" AND Authorised{level - 1} = 'Y' AND Authorised{level} = 'N'"


def _may_authorise(conn: Connection, user: CurrentUser, menu_id: int, level: int) -> bool:
    if user.user_code.upper() == "ADMIN":
        return True
    rights = meta_menu.get_rights_string(conn, user_id=user.user_id, role_id=user.role_id, user_code=user.user_code, menu_item_id=menu_id)
    return meta_menu.has_right(rights, 6 if level == 1 else min(level + 5, 12))


def _count(conn: Connection, d: dict, level: int) -> int:
    sql = f"SELECT COUNT({_ident(d['sh_form'])}ID) FROM {_ident(d['table'])} WHERE 1 = 1" + _level_cond(level, transaction=d["type"].upper() == "TRANSACTION")
    return int(conn.execute(text(sql)).scalar() or 0)


def summary(conn: Connection, user: CurrentUser) -> dict:
    """One row per document needing authorisation, with the pending count for each level (None = no right at that level)."""
    docs = _docs(conn)
    max_levels = max([d["levels"] for d in docs] or [1])
    out = []
    for d in docs:
        counts = []
        for lv in range(1, max_levels + 1):
            if lv > d["levels"]:
                counts.append(None)
            elif not _may_authorise(conn, user, d["menu_id"], lv):
                counts.append(None)
            else:
                counts.append(_count(conn, d, lv))
        out.append({"doc_id": d["doc_id"], "name": d["name"], "type": d["type"], "levels": d["levels"], "counts": counts})
    return {"levels": [{"level": i, "label": level_label(i)} for i in range(1, max_levels + 1)], "documents": out}


def _doc(conn: Connection, doc_id: int) -> dict:
    for d in _docs(conn):
        if d["doc_id"] == doc_id:
            return d
    raise HTTPException(status.HTTP_404_NOT_FOUND, "This document does not need authorisation")


def _check(conn: Connection, user: CurrentUser, d: dict, level: int) -> None:
    if level < 1 or level > d["levels"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid authorisation level")
    if not _may_authorise(conn, user, d["menu_id"], level):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have the right to authorise this document at this level")


def pending(conn: Connection, user: CurrentUser, *, doc_id: int, level: int) -> dict:
    d = _doc(conn, doc_id)
    _check(conn, user, d, level)
    sf, tbl = _ident(d["sh_form"]), _ident(d["table"])
    is_master = d["type"].upper() == "MASTER"
    if is_master:
        sql = f"SELECT {sf}ID AS id, {sf}Code AS no, {sf}Name AS name, NULL AS doc_date FROM {tbl} WHERE 1 = 1" + _level_cond(level, transaction=False) + f" ORDER BY {sf}ID"
    else:
        sql = f"SELECT {sf}ID AS id, {sf}NO AS no, NULL AS name, {sf}Date AS doc_date FROM {tbl} WHERE 1 = 1" + _level_cond(level, transaction=True) + f" ORDER BY {sf}ID"
    rows = conn.execute(text(sql)).mappings().all()
    return {
        "document": d["name"],
        "type": d["type"],
        "level": level,
        "level_label": level_label(level),
        "rows": [{"id": r["id"], "no": r["no"], "name": r["name"], "date": r["doc_date"].isoformat() if r["doc_date"] else None} for r in rows],
    }


def authorise(conn: Connection, user: CurrentUser, *, doc_id: int, level: int, ids: list[int]) -> int:
    """Legacy UpdateAuthQuery for every selected row; the caller wraps this in one transaction."""
    d = _doc(conn, doc_id)
    _check(conn, user, d, level)
    if not ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select at least one document to authorise")
    sf, tbl = _ident(d["sh_form"]), _ident(d["table"])
    sfx = "" if level == 1 else str(level)
    now = datetime.now().replace(microsecond=0)
    done = 0
    for i in ids:
        # only rows still waiting at exactly this level can be authorised (stops a stale list authorising twice)
        res = conn.execute(
            text(f"UPDATE {tbl} SET Authorised{sfx} = 'Y', AuthBy{sfx} = :u, AuthOn{sfx} = :t WHERE {sf}ID = :i" + _level_cond(level, transaction=d["type"].upper() == "TRANSACTION")),
            {"u": user.user_code, "t": now, "i": int(i)},
        )
        done += res.rowcount
    return done
