"""Menu tree + document field schema — data-driven, per CLAUDE.md rule 5."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import cache
from app.core.db import get_conn, limit_clause, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user
from app.meta import menu as meta_menu
from app.meta import lookups as meta_lookups
from app.meta.numbering import resolve_prefix

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
        conn.execute(
            text("UPDATE MstMenu SET MenuShow = :v WHERE MenuItemID = :id"),
            {"v": "Y" if body.show else "N", "id": menu_item_id},
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


class PickupRequest(BaseModel):
    values: dict = {}


@router.post("/docs/{doc_id}/pickup/{field_code}")
def get_pickup(doc_id: int, field_code: str, body: PickupRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """`FldPickUP`: the value a field fills itself with once the field it depends on changes (Rashi from Nakshatra)."""
    return meta_lookups.resolve_pickup(conn, doc_id=doc_id, field_code=field_code, values=body.values)


@router.get("/ledgers")
def get_ledgers(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """General-purpose Ledger (MstLed) picker — used by voucher screens whose Dr/Cr lines aren't tied to a single doc field."""
    sql = "SELECT LEDID AS value, LEDNAME AS label FROM MstLed WHERE 1 = 1"
    params: dict = {}
    if search:
        sql += " AND LEDNAME LIKE :q"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY LEDNAME {limit_clause(100)}"
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
