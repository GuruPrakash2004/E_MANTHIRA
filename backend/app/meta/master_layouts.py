"""
Built-in field layout for masters whose legacy screen has more than Code / Name + the UtlDocDsgrFlds "Header Info"
rows (Item, Supplier, State City Country). The legacy VB forms hard-code those extra controls; the web UI must not,
so they are served from here and the generic master screen just renders what it receives.

Everything is checked against the live table: a field whose column does not exist is dropped, lookups are
parameterised, and identifiers only ever come from the constants below.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import limit_clause

# DocID -> columns that differ from the <ShForm>CODE / <ShForm>NAME convention (MstSCC has no code/name pair).
META_OVERRIDES: dict[int, dict[str, str]] = {
    1106: {"code_col": "City", "name_col": "City", "inactive_rmks_col": "InActiveRem"},
}


def _lookup(table: str, value: str, label: str, *, distinct: bool = False, extra: tuple[str, ...] = (), cond: str = "") -> dict:
    return {"table": table, "value": value, "label": label, "distinct": distinct, "extra": extra, "cond": cond}


def _f(code: str, caption: str, type_: str = "text", **kw: Any) -> dict:
    return {"code": code, "caption": caption, "type": type_, "required": False, "readonly": False, "width": 0, **kw}


_ITEM_GROUP = _lookup("MstITEMGROUP", "ITEMGROUPID", "ITEMGROUPNAME")
_UOM = _lookup("MstUOM", "UOMID", "UOMNAME")
_SUPP_GROUP = _lookup("MstSUPPGROUP", "SUPPGROUPID", "SUPPGROUPNAME")
_LED_GROUP = _lookup("MstLedgroup", "LEDGROUPID", "LEDGROUPNAME")
_SCC_CITY = _lookup("MstSCC", "City", "City", extra=("State", "Country"))
_STATE_NAME = _lookup("MstSTATE", "STATENAME", "STATENAME")
_COUNTRY_NAME = _lookup("MstSCC", "Country", "Country", distinct=True, cond="Country IS NOT NULL AND Country <> ''")

LAYOUTS: dict[int, dict[str, Any]] = {
    # Item Master (frmMstITEM)
    1114: {
        "fields": [
            _f("TallyAlias", "Tally Alias", width=100),
            _f("ITEMDesc", "Description", "textarea", width=250),
            _f("HSNCode", "HSN Code", width=15),
            _f("ITEMGroupID", "ITEMGroup Mst", "lookup", required=True, lookup=_ITEM_GROUP),
            _f("ItemType", "Item Type", "list", required=True, distinct=("MstITEM", "ItemType")),
            _f("UOMID", "Uom Mst", "lookup", required=True, lookup=_UOM),
            _f("BOMItem", "BOM Item", "flag"),
            _f("NonStkable", "Non Stockable", "flag"),
        ],
        "image": True,
        "copy_from": True,
        "captions_from_misc": {"code": "ItemCaption", "name": "ItemNameCaption", "ITEMDesc": "ItemDescCaption"},
    },
    # Supplier Master (frmMstSUPP)
    1121: {
        "fields": [
            _f("SUPPAliasName", "Tally Alias", width=100),
            _f("LedGroupID", "Group Ledger", "lookup", lookup=_LED_GROUP),
            _f("SUPPGROUPID", "Supp Group", "lookup", lookup=_SUPP_GROUP),
            _f("BAdd1", "Address", required=True, width=100),
            _f("BAdd2", "", width=100),
            _f("BAdd3", "", width=100),
            _f("BAdd4", "", width=100),
            _f("City", "City", "lookup", required=True, lookup=_SCC_CITY, fills={"State": "State", "Country": "Country"}),
            _f("PinCode", "Pincode", width=6),
            _f("State", "State", required=True, readonly=True),
            _f("Country", "Country", required=True, readonly=True),
            _f("TrnWarning", "Party Notes", "textarea", width=250),
            _f("BillWiseTrack", "Bill Wise Tracking Required", "flag"),
            _f("AccBillToBillClearance", "Bill To Bill Clearance", "flag"),
            _f("CrLimitAmt", "Credit Limit Amt", "numeric"),
            _f("CrRestrict", "Restrict", "flag"),
        ],
        # Sub-screens of the legacy Supplier form that the web app does not provide yet; shown disabled, never faked.
        "panels": [
            {"key": "addresses", "label": "Multi Address"},
            {"key": "contacts", "label": "Contact Person"},
            {"key": "alerts", "label": "Alert Message"},
            {"key": "activities", "label": "Activities"},
        ],
        "copy_from": True,
        "defaults_lookup": {"LedGroupID": ("MstLedgroup", "LEDGROUPID", "LEDGROUPCODE", "Sundry Creditors")},
        "defaults_value": {"Country": "INDIA", "State": "KARNATAKA"},
    },
    # State City Country (frmMstSCC): City / State / Country only, no code/name pair, no Inactive flag.
    1106: {
        "fields": [
            _f("State", "State", "lookup", required=True, lookup=_STATE_NAME),
            _f("Country", "Country", "combo", lookup=_COUNTRY_NAME),  # free text allowed, existing countries suggested (cboCountry)
        ],
        "primary": {"caption": "City", "required": True},
        "list_subtitle_cols": ["State", "Country"],
    },
}


def _table_columns(conn: Connection, table: str) -> set[str]:
    rows = conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": table}).all()
    return {r[0] for r in rows}


def get_layout(conn: Connection, doc_id: int, table: str) -> dict[str, Any]:
    spec = LAYOUTS.get(doc_id)
    out: dict[str, Any] = {
        "fields": [], "hide_inactive": False, "list_subtitle_cols": [], "panels": [], "primary": None,
        "image": False, "copy_from": False, "code_caption": None, "name_caption": None, "defaults": {}, "options": [],
    }
    if spec is None:
        return out
    cols = {c.lower() for c in _table_columns(conn, table)}
    for f in spec["fields"]:
        if f["code"].lower() not in cols:
            continue
        item = {k: v for k, v in f.items() if k not in ("lookup", "distinct")}
        if "lookup" in f:
            item["lookup"] = True
        if "distinct" in f:
            tbl, col = f["distinct"]
            rows = conn.execute(text(f"SELECT DISTINCT {col} FROM {tbl} WHERE {col} IS NOT NULL AND {col} <> '' ORDER BY {col}")).all()
            item["options"] = [r[0] for r in rows]
        out["fields"].append(item)
    out["hide_inactive"] = spec.get("hide_inactive", False)
    out["list_subtitle_cols"] = spec.get("list_subtitle_cols", [])
    out["panels"] = spec.get("panels", [])
    out["primary"] = spec.get("primary")
    out["image"] = spec.get("image", False)
    out["copy_from"] = spec.get("copy_from", False)
    # Captions the client configured in UtlMisc (Item Code / Item Name / Description labels)
    misc = spec.get("captions_from_misc")
    if misc:
        row = conn.execute(text("SELECT TOP 1 * FROM UtlMisc")).mappings().first() or {}
        for target, col in misc.items():
            val = (row.get(col) or "").strip()
            if not val:
                continue
            if target == "code":
                out["code_caption"] = val
            elif target == "name":
                out["name_caption"] = val
            else:
                for f in out["fields"]:
                    if f["code"] == target:
                        f["caption"] = val
    # New-record defaults the legacy form applies, kept only when the value really exists in the database
    for fld, (tbl, id_col, name_col, value) in spec.get("defaults_lookup", {}).items():
        if fld.lower() in cols:
            r = conn.execute(text(f"SELECT TOP 1 {id_col} FROM {tbl} WHERE {name_col} = :v"), {"v": value}).first()
            if r:
                out["defaults"][fld] = r[0]
    for fld, value in spec.get("defaults_value", {}).items():
        col = "Country" if fld == "Country" else "State"
        if fld.lower() in cols and conn.execute(text(f"SELECT TOP 1 1 FROM MstSCC WHERE {col} = :v"), {"v": value}).first():
            out["defaults"][fld] = value
    return out


def required_fields(doc_id: int) -> list[tuple[str, str]]:
    spec = LAYOUTS.get(doc_id) or {}
    return [(f["code"], f["caption"] or f["code"]) for f in spec.get("fields", []) if f.get("required")]


def lookup_options(conn: Connection, doc_id: int, field_code: str, search: str = "") -> list[dict]:
    spec = LAYOUTS.get(doc_id) or {}
    field = next((f for f in spec.get("fields", []) if f["code"] == field_code and "lookup" in f), None)
    if field is None:
        return []
    lk = field["lookup"]
    extra_sql = "".join(f", {c}" for c in lk["extra"])
    cols = f"{lk['value']} AS value, {lk['label']} AS label{extra_sql}"
    if lk["distinct"]:
        sql = f"SELECT DISTINCT {cols} FROM {lk['table']} WHERE 1 = 1"
    else:
        sql = f"SELECT {cols} FROM {lk['table']} WHERE 1 = 1"
    if lk["cond"]:
        sql += f" AND {lk['cond']}"
    params: dict = {}
    if search:
        sql += f" AND {lk['label']} LIKE :q"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY {lk['label']} {limit_clause(200)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [{"value": r["value"], "label": r["label"], **{c: r[c] for c in lk["extra"]}} for r in rows]
