"""Menu tree + document field schema — data-driven, per CLAUDE.md rule 5."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit, cache
from app.core.db import get_conn, limit_clause, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user, require_right_from_path
from app.meta import edit_rules
from app.meta import menu as meta_menu
from app.meta import lookups as meta_lookups
from app.meta.numbering import resolve_prefix
from app.services import doc_list

router = APIRouter(prefix="/meta", tags=["meta"])


def _require_admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change menu customisation")


@router.get("/menu")
def get_menu(user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)):
    tree = meta_menu.get_menu_tree(conn)
    for item in tree:
        rights = meta_menu.get_rights_string(
            conn, user_id=user.user_id, role_id=user.role_id, user_code=user.user_code, menu_item_id=item["menu_item_id"]
        )
        item["rights"] = rights
        item["can_view"] = meta_menu.has_right(rights, meta_menu.RIGHT_VIEW)
    return [i for i in tree if i["can_view"] or user.user_code.upper() == "ADMIN"]


class MenuVisibilityRequest(BaseModel):
    show: bool


@router.get("/menu/settings")
def get_menu_settings(user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)):
    """Every menu item (shown or not) — the ADMIN-only screen that lets a client hide masters/transactions they don't use."""
    _require_admin(user)
    rows = conn.execute(
        text(
            """
            SELECT MenuItemID, MenuItemCaption, MenuItemType, DocID, MenuGroupName, Menuindex, MenuShow
            FROM MstMenu
            ORDER BY MenuItemType, Menuindex
            """
        )
    ).mappings().all()
    return [
        {
            "menu_item_id": r["MenuItemID"],
            "caption": r["MenuItemCaption"],
            "type": meta_menu.MENU_TYPE_NAMES.get(r["MenuItemType"], str(r["MenuItemType"])),
            "doc_id": r["DocID"],
            "group": (r["MenuGroupName"] or "").strip(),
            "show": (r["MenuShow"] or "N").strip().upper() == "Y",
        }
        for r in rows
    ]


@router.put("/menu/{menu_item_id}/visibility")
def set_menu_visibility(
    menu_item_id: int,
    body: MenuVisibilityRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Toggle a menu item on/off — the whole 'this client doesn't want this master' customisation, done live."""
    _require_admin(user)
    with with_transaction() as conn:
        caption = conn.execute(text("SELECT MenuItemCaption FROM MstMenu WHERE MenuItemID = :id"), {"id": menu_item_id}).scalar()
        if caption is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Menu item not found")
        conn.execute(
            text("UPDATE MstMenu SET MenuShow = :v WHERE MenuItemID = :id"),
            {"v": "Y" if body.show else "N", "id": menu_item_id},
        )
        audit.record(
            conn, entity="MstMenu", entity_id=menu_item_id, action="E", user_code=user.user_code,
            details=f"{(caption or '').strip()} {'shown' if body.show else 'hidden'}",
        )
    meta_menu.invalidate()
    return {"message": "Updated"}


@router.post("/reload")
def reload_designer(user: CurrentUser = Depends(get_current_user)):
    """'Refresh from Doc Designer' — drop every cached copy of designer-owned metadata (doc fields, menu, rights,
    financial years) so the next read comes from the DB. Nothing re-reads on page load; this is the only refresh."""
    _require_admin(user)
    cache.clear()
    return {"message": "Refreshed from Doc Designer"}


@router.get("/prefixes/{doc_id}")
def get_prefixes(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Available document-number prefixes for a doc — port of UtlDocNoPrefix resolution."""
    return resolve_prefix(conn, doc_id=doc_id, field_values={})


@router.get("/docs/{doc_id}/rules")
def doc_rules_flags(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The document's UtlTransactions switches (authorisation, freeze, edit-limit days, date lock, copy-from, amendment...)."""
    return edit_rules.rules(conn, doc_id)


@router.get("/docs/{doc_id}/fields")
def get_doc_fields(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Field schema (captions, types, rules, lookups, formulas) for a document — port of UtlDocDsgrFlds."""

    def load():
        doc = conn.execute(text("SELECT * FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
        fields = conn.execute(
            text("SELECT * FROM UtlDocDsgrFlds WHERE DocID = :d ORDER BY FldSection, FldOrderBy"), {"d": doc_id}
        ).mappings().all()
        return {"doc": dict(doc) if doc else None, "fields": [dict(f) for f in fields]}

    # Designer-owned metadata (edited only in the legacy Designer) — 5 minute TTL.
    return cache.get_or_set(("docfields", doc_id), 300, load)


@router.get("/docs/{doc_id}/refill/{field_code}")
def get_refill(doc_id: int, field_code: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """`FldBlnRefill`: the distinct values this field already holds in the document's table (most recent first), offered
    as suggestions so staff can reuse a bank name / category instead of retyping it."""
    row = conn.execute(
        text("SELECT FldSection, FldBlnRefill FROM UtlDocDsgrFlds WHERE DocID = :d AND FldCode = :f"), {"d": doc_id, "f": field_code}
    ).mappings().first()
    if row is None or (row["FldBlnRefill"] or "N").strip().upper() != "Y":
        return []
    doc = conn.execute(text("SELECT HdrTblName, DtlTblName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if doc is None:
        return []
    tbl = ((doc["DtlTblName"] if (row["FldSection"] or "").strip() == "Detail" else doc["HdrTblName"]) or "").strip()
    if not (meta_lookups.IDENT_RE.match(tbl) and meta_lookups.IDENT_RE.match(field_code)):
        return []
    has_col = conn.execute(
        text("SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = :c"), {"t": tbl, "c": field_code}
    ).first()
    if not has_col:
        return []
    rows = conn.execute(text(f"SELECT DISTINCT LTRIM(RTRIM({field_code})) AS v FROM {tbl} WHERE {field_code} IS NOT NULL ORDER BY v {limit_clause(200)}")).fetchall()
    return [r[0] for r in rows if r[0]]


@router.get("/lookup/{doc_id}/{field_code}")
def get_lookup(
    doc_id: int,
    field_code: str,
    search: str = "",
    ctx: str = "",
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    """Options for a combo field — resolved live from UtlDocDsgrFlds.FldCmbTblName, exactly like the Windows app.
    `ctx` (JSON of the screen's current FldCode values) feeds dependent combos such as Rashi-by-Nakshatra."""
    try:
        context = json.loads(ctx) if ctx else {}
    except ValueError:
        context = {}
    return meta_lookups.resolve_lookup(conn, doc_id=doc_id, field_code=field_code, search=search, ctx=context if isinstance(context, dict) else {})


class DisplayRequest(BaseModel):
    values: dict = {}


@router.post("/docs/{doc_id}/display")
def display_values(doc_id: int, body: DisplayRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """What each field shows on screen: a lookup's id becomes its name, anything else stays as typed. `{FldCode: text}`."""
    out: dict[str, str] = {}
    for code, val in list(body.values.items())[:200]:
        if not isinstance(code, str) or not code.replace("_", "").isalnum():
            continue
        try:
            out[code] = meta_lookups.display_of(conn, doc_id, code, val)
        except Exception:  # noqa: BLE001 - a field that cannot be resolved just shows its own value
            out[code] = "" if val is None else str(val).strip()
    return out


class PickupRequest(BaseModel):
    values: dict = {}


@router.post("/docs/{doc_id}/pickup/{field_code}")
def get_pickup(doc_id: int, field_code: str, body: PickupRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """`FldPickUP`: the value a field fills itself with once the field it depends on changes (Rashi from Nakshatra)."""
    return meta_lookups.resolve_pickup(conn, doc_id=doc_id, field_code=field_code, values=body.values)


@router.get("/docs/{doc_id}/next-no")
def doc_next_no(
    doc_id: int,
    prefix: str | None = None,
    type: str | None = None,
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    """The bill no the next save of this document would get, shown while the form is filled (nothing is reserved; the number a
    save really gets is the one it returns). `prefix` = the chosen one; without it the first prefix the document's rules allow
    (`type` = the booking type some documents key their prefix on)."""
    import re

    from app.meta import numbering

    doc = conn.execute(text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    table, sf = ((doc or {}).get("HdrTblName") or "").strip(), ((doc or {}).get("DocShForm") or "").strip()
    ident = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
    if not doc or not ident.match(table) or not ident.match(sf):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This document has no bill number")
    if prefix is None:
        found = resolve_prefix(conn, doc_id=doc_id, field_values={"TYPE": type} if type else {})
        prefix = found[0] if found else ""
    doc_no = numbering.peek_doc_no(conn, table_name=table, no_column=f"{sf}NO", prefix=prefix, fy_start_year=fy.start_year)
    print_no = numbering.print_doc_no(conn, doc_id=doc_id, doc_no=doc_no, prefix=prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)
    digits = "".join(ch for ch in str(doc_no)[-5:] if ch.isdigit())
    return {"short_form": sf, "prefix": prefix, "seq": int(digits) if digits else 0, "doc_no": doc_no, "print_no": print_no}


@router.get("/nakshatra/{nakshatra_id}/rashis")
def get_nakshatra_rashis(nakshatra_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The rashi(s) a nakshatra belongs to: MstNAKSHATRA.RASHIID1 / RASHIID2 (ID 0 = none). One rashi = fill it in,
    two = the screen offers just those two (a nakshatra's four padas can span two rashis)."""
    try:
        row = conn.execute(text("SELECT RASHIID1, RASHIID2 FROM MstNAKSHATRA WHERE NAKSHATRAID = :n"), {"n": nakshatra_id}).first()
        if not row:
            return []
        ids: list[int] = []
        for v in row:
            if v and int(v) > 0 and int(v) not in ids:
                ids.append(int(v))
        if not ids:
            return []
        marks = ", ".join(f":r{i}" for i in range(len(ids)))
        names = {
            int(r[0]): (r[1] or "").strip()
            for r in conn.execute(text(f"SELECT RASHIID, RASHINAME FROM MstRASHI WHERE RASHIID IN ({marks})"), {f"r{i}": v for i, v in enumerate(ids)})
        }
        return [{"value": i, "label": names.get(i, str(i))} for i in ids]
    except Exception:  # noqa: BLE001 - a database without these columns simply has no nakshatra-to-rashi link
        return []


@router.get("/ledgers")
def get_ledgers(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """General-purpose account-head picker for voucher lines: the legacy list is `Select AcLedName from MstAcLed where InActive = 'N'`
    (frmTrnVch.initItemVsfCombo). The value is MstAcLed.AcLedID, which is what the voucher lines store; it is NOT the ledger master's
    LEDID in most temple editions (the two tables only line up in a few)."""
    sql = "SELECT AcLedID AS value, AcLedName AS label FROM MstAcLed WHERE InActive = 'N' AND AcLedID > 0"
    params: dict = {}
    if search:
        sql += " AND AcLedName LIKE :q"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY AcLedName {limit_clause(100)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [{"value": r["value"], "label": r["label"]} for r in rows]


@router.get("/docs/{doc_id}/nav")
def navigate_document(
    doc_id: int,
    direction: str,
    current: int | None = None,
    prefix: str = "",
    fy: "FinancialYear" = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    """First / previous / next / last record id of a transaction document in the active financial year."""
    from app.services import doc_nav

    return {"id": doc_nav.neighbour_id(conn, doc_id=doc_id, direction=direction, current=current, fy=fy, prefix=prefix)}


@router.get("/capabilities")
def capabilities(tables: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Which of the named tables exist in THIS database ({"MstSTAFF": false, ...}). Screens for optional legacy features
    ask this first and say "not available in this database" instead of failing; nothing is ever created here."""
    names = [t.strip() for t in tables.split(",") if t.strip()][:50]
    out: dict[str, bool] = {}
    for t in names:
        if not meta_lookups.IDENT_RE.match(t):
            out[t] = False
            continue
        out[t] = cache.get_or_set(("caps", t.lower()), 300, lambda t=t: bool(conn.execute(text("SELECT 1 FROM sys.tables WHERE name = :t"), {"t": t}).scalar()))
    return out


@router.get("/capabilities/docs")
def capability_docs(_: CurrentUser = Depends(get_current_user)):
    """For each DocID the web screens are wired to: does THIS database define that document (same header table)?
    Temples number documents alike, but an older edition can reuse an id for another document."""
    from app.core import capabilities as caps

    return {str(d): caps.doc_available(d) for d in caps.FIXED_DOC_TABLES}


@router.get("/docs/{doc_id}/list")
def list_document(
    doc_id: int,
    fy: "FinancialYear" = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right_from_path(meta_menu.RIGHT_VIEW)),
):
    """Every record of a master / transaction document (transactions: the active financial year) for the listing grid."""
    return doc_list.list_document(conn, doc_id=doc_id, fy=fy)


@router.get("/db-check")
def db_check(user: CurrentUser = Depends(get_current_user)):
    """What the start-up database check created / added / could not add (ADMIN only; see core/web_schema.py)."""
    if user.user_code.strip().upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can view the database check")
    from app.core import web_schema

    return web_schema.last_report
