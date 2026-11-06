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


ITEM_TYPES = ["Raw Material", "Finished Goods", "Semi Finished Goods", "Sub Assembly", "Customer Part", "Production Consumables", "Others"]
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
            _f("TallyAlias", "Tally Alias", width=100, fill_from_code=True),
            _f("ITEMDesc", "Description", "textarea", width=250),
            _f("HSNCode", "HSN Code", width=15),
            _f("ITEMGroupID", "ITEMGroup Mst", "lookup", required=True, lookup=_ITEM_GROUP),
            # cboType: the form's own seven types (not mandatory); values already saved in the master stay selectable
            _f("ItemType", "Item Type", "list", distinct=("MstITEM", "ItemType"), fixed=ITEM_TYPES),
            _f("UOMID", "Uom Mst", "lookup", required=True, lookup=_UOM),
            _f("BOMItem", "BOM Item", "flag"),
            _f("NonStkable", "Non Stockable", "flag"),
            # "Purchase Related" group box: only when UtlMisc.ItemPurRelated = 'Y'
            _f("MOQ", "MOQ", "numeric", misc_gate="ItemPurRelated"),
            _f("SPQ", "SPQ", "numeric", misc_gate="ItemPurRelated"),
            # "Stock Related" group box: only when UtlMisc.ItemStockRelated = 'Y'
            _f("ReOrderItem", "Re-Order Item", "flag", misc_gate="ItemStockRelated"),
            _f("ROL", "ROL", "numeric", misc_gate="ItemStockRelated", show_if={"field": "ReOrderItem", "eq": "Y"}),
            _f("ROQ", "ROQ", "numeric", misc_gate="ItemStockRelated", show_if={"field": "ReOrderItem", "eq": "Y"}),
            _f("CRITICALLEVEL", "Critical Level", "numeric", misc_gate="ItemStockRelated"),
            _f("MAXLEVEL", "Max Level", "numeric", misc_gate="ItemStockRelated"),
            _f("BinNo", "Bin No", width=20, misc_gate="ItemStockRelated"),
            _f("LotWiseItem", "Lot Wise Item", "flag", misc_gate="ItemStockRelated"),
            _f("LotType", "Lot Numbering", "list", misc_gate="ItemStockRelated", show_if={"field": "LotWiseItem", "eq": "Y"}, fixed=[{"value": "A", "label": "Auto"}, {"value": "M", "label": "Manual"}]),
            _f("ShelfLifeItem", "Shelf Life Item", "flag", misc_gate="ItemStockRelated", show_if={"field": "LotWiseItem", "eq": "Y"}),
        ],
        "image": True,
        "copy_from": True,
        "captions_from_misc": {"code": "ItemCaption", "name": "ItemNameCaption", "ITEMDesc": "ItemDescCaption"},
    },
    # Supplier Master (frmMstSUPP)
    1121: {
        "fields": [
            _f("SUPPAliasName", "Tally Alias", width=100, fill_from_code=True),
            _f("LedGroupID", "Group Ledger", "lookup", lookup=_LED_GROUP),
            _f("SUPPGROUPID", "Supp Group", "lookup", lookup=_SUPP_GROUP),
            _f("BAdd1", "Address", placeholder="Address line 1 - building / street", required=True, width=100),
            _f("BAdd2", "", placeholder="Address line 2 - area / locality", width=100),
            _f("BAdd3", "", placeholder="Address line 3 - city / district", width=100),
            _f("BAdd4", "", placeholder="Address line 4 - state / PIN code", width=100),
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
    # Customer Master (MstCUST): same layout idea as the Supplier master (code fills the name and alias when they are blank)
    1112: {
        "fields": [
            _f("CUSTAliasName", "Tally Alias", width=100, fill_from_code=True),
            _f("LedGroupID", "Group Ledger", "lookup", lookup=_LED_GROUP),
            _f("BAdd1", "Address", placeholder="Address line 1 - building / street", width=50),
            _f("BAdd2", "", placeholder="Address line 2 - area / locality", width=50),
            _f("BAdd3", "", placeholder="Address line 3 - city / district", width=50),
            _f("BAdd4", "", placeholder="Address line 4 - state / PIN code", width=50),
            _f("City", "City", "lookup", lookup=_SCC_CITY, fills={"State": "State", "Country": "Country"}),
            _f("PinCode", "Pincode", width=6),
            _f("State", "State", readonly=True),
            _f("Country", "Country", readonly=True),
            _f("MOBNO", "Mobile No", width=50),
            _f("GSTNO", "GST No", width=15),
            _f("BillWiseTrack", "Bill Wise Tracking Required", "flag"),
            _f("AccBillToBillClearance", "Bill To Bill Clearance", "flag"),
        ],
        "copy_from": True,
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
    misc_row = None
    for f in spec["fields"]:
        if f["code"].lower() not in cols:
            continue
        gate = f.get("misc_gate")
        if gate:  # a group box the client switched on in UtlMisc (Item: stock related / purchase related)
            if misc_row is None:
                misc_row = conn.execute(text("SELECT TOP 1 * FROM UtlMisc")).mappings().first() or {}
            if str(misc_row.get(gate) or "N").strip().upper() != "Y":
                continue
        item = {k: v for k, v in f.items() if k not in ("lookup", "distinct", "misc_gate", "fixed")}
        if f.get("fixed") and "distinct" not in f:
            item["options"] = list(f["fixed"])
        if "lookup" in f:
            item["lookup"] = True
        if "distinct" in f:
            tbl, col = f["distinct"]
            rows = conn.execute(text(f"SELECT DISTINCT {col} FROM {tbl} WHERE {col} IS NOT NULL AND {col} <> '' ORDER BY {col}")).all()
            fixed = list(f.get("fixed") or [])
            item["options"] = fixed + [r[0].strip() for r in rows if r[0].strip() and r[0].strip() not in fixed]
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


def normalise_values(doc_id: int, values: dict) -> dict:
    """What the legacy form writes when a dependent control is hidden (frmMstItem save): no re-order level without
    Re-Order Item, no lot type / shelf life without Lot Wise Item. Lot type is stored as one letter (A / M)."""
    if doc_id != 1114:
        return values
    out = dict(values)
    yes = lambda k: str(out.get(k) or "N").strip().upper() == "Y"  # noqa: E731
    if "ReOrderItem" in out and not yes("ReOrderItem"):
        out["ROL"] = 0
        out["ROQ"] = 0
    if "LotWiseItem" in out:
        if yes("LotWiseItem"):
            lt = str(out.get("LotType") or "").strip()
            out["LotType"] = lt.upper() if lt.upper() in ("A", "M") else "A"
        else:
            out["LotType"] = ""
            out["ShelfLifeItem"] = "N"
    return out


def check_values(conn: Connection, doc_id: int, values: dict) -> None:
    """Item Master: the Item Type, when filled, must be one of the form's types or one already saved ("Not a valid ItemType!")."""
    if doc_id != 1114:
        return
    from fastapi import HTTPException, status

    t = str(values.get("ItemType") or "").strip()
    if not t or t in ITEM_TYPES:
        return
    if conn.execute(text("SELECT TOP 1 1 FROM MstITEM WHERE ItemType = :t"), {"t": t}).first() is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Not a valid ItemType!")
