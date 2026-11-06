"""
Profit Margin (frmRptProfitMargin), ported from the decompiled EXE. Read-only.

The report is generated from designer-made definitions stored in the database:
  * `UtlProfitMargin`  (DocID, DocName, RateType, CondText)  - one definition per report "type"
  * `UtlProfitDtlFlds` (one row per source, DocType 'SALES' or 'PURCHASE'): for each of No, Date, Party, Item, ItemDesc,
    ItemGroup, UOM, AD1..AD5, SQty, SRate, SValue, PR (purchase rate), PRV (purchase value), Diff a (Text, Tbl, Fld) triple
    = the caption, the table and the column that holds it, plus `FldCond`, an admin-written WHERE fragment.

The query the EXE builds, per SALES row (UNION ALL over several):
    SELECT <Tbl.Fld AS [Text]> for every field with a table ...
      RateType STANDARD RATE : + PR / PRV taken from the sales document itself, Difference = SRate - PR, DifferenceValue = SValue - PRV
      RateType AVG RATE      : + [Purchase Rate], [Purchase Value] from a subquery v over the PURCHASE rows
                                 (AVG(PR), AVG(PRV) grouped by the item), joined on the item;  Difference = SRate - [Purchase Rate] ...
    FROM <the distinct tables> [, (v)]  WHERE 1 = 1 <FldCond>
with the placeholders @ID (the chosen item, or every active item), @FROMDATE and @TODATE in the conditions.
LAST PURCHASE RATE is not ported: the EXE's query for it names no ordering or "last" rule and would join every purchase row.

Safety: the stored table / column names must be plain identifiers and every stored condition is checked to be a harmless
boolean fragment (no statements, comments or DML); dates and the item are bound parameters.
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.captions import menu_title, tidy
from app.core.db import limit_clause

REPORT = "Profit Margin"  # menu caption (the legacy row has no form name usable here)
TABLES = ("UtlProfitMargin", "UtlProfitDtlFlds", "MstItem")
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_BAD = re.compile(r"(;|--|/\*|\*/|\b(insert|update|delete|drop|alter|create|exec|execute|truncate|merge|grant|revoke|shutdown|waitfor|openrowset|opendatasource|into|xp_\w*|sp_\w*)\b)", re.I)
MAX_ROWS = 10000

# the triples of the designer table, in the EXE's order: (output key, Text column, Tbl column, Fld column)
_FIELDS = [
    ("no", "FldNoText", "FldNoTbl", "FldNo"), ("date", "FldDateText", "FldDateTbl", "FldDate"), ("party", "FldPartyText", "FldPartyTbl", "FldParty"),
    ("item", "FldItemText", "FldItemTbl", "FldItem"), ("item_desc", "FldItemDescText", "FldItemDescTbl", "FldItemDesc"),
    ("item_group", "FldItemGroupText", "FldItemGroupTbl", "FldItemGroup"), ("uom", "FldUOMText", "FldUOMTbl", "FldUOM"),
    ("ad1", "FldAD1Text", "FldAD1Tbl", "FldAD1"), ("ad2", "FldAD2Text", "FldAD2Tbl", "FldAD2"), ("ad3", "FldAD3Text", "FldAD3Tbl", "FldAD3"),
    ("ad4", "FldAD4Text", "FldAD4Tbl", "FldAD4"), ("ad5", "FldAD5Text", "FldAD5Tbl", "FldAD5"),
    ("sqty", "FldSQtyText", "FldSQtyTbl", "FldSQty"), ("srate", "FldSRateText", "FldSRateTbl", "FldSRate"), ("svalue", "FldSValueText", "FldSValueTbl", "FldSValue"),
]
_PUR = [("pr", "FldPRText", "FldPRTbl", "FldPR"), ("prv", "FldPRVText", "FldPRVTbl", "FldPRV")]
_NUMERIC = {"sqty", "srate", "svalue", "pr", "prv", "diff", "diff_value"}


def _missing(conn: Connection) -> list[str]:
    have = {r[0].lower() for r in conn.execute(text("SELECT name FROM sys.tables"))}
    return [t for t in TABLES if t.lower() not in have]


def _ident(v: str | None, what: str) -> str:
    v = (v or "").strip()
    if not _IDENT.match(v):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The Profit Margin definition has an unsupported {what}: '{v}' (only plain table / column names are allowed)")
    return v


def _alias(v: str | None) -> str:
    return re.sub(r"[\[\]'\";]", "", (v or "").strip())[:60]


def _cond(v: str | None) -> str:
    v = (v or "").strip()
    if v and _BAD.search(v):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A condition in the Profit Margin definition is not allowed (it must be a plain filter, no statements or comments)")
    return v


def definitions(conn: Connection) -> dict:
    miss = _missing(conn)
    if miss:
        return {"available": False, "title": menu_title(conn, caption=REPORT), "missing": miss}
    rows = conn.execute(text("SELECT DocID, DocName, RateType FROM UtlProfitMargin ORDER BY DocName")).mappings().all()
    return {
        "available": True,
        "title": menu_title(conn, caption=REPORT),
        "defined": bool(rows),
        "types": [{"doc_id": int(r["DocID"]), "name": (r["DocName"] or "").strip(), "rate_type": (r["RateType"] or "").strip()} for r in rows],
    }


def items(conn: Connection, search: str = "") -> list[dict]:
    cols = {r[0].lower() for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'MstItem'"))}
    if not {"itemid", "itemcode", "itemname"} <= cols:
        return []
    sql = "SELECT ItemID, ItemCode, ItemName FROM MstItem WHERE ItemID > 0" + (" AND InActive = 'N'" if "inactive" in cols else "")
    params: dict = {}
    if search.strip():
        sql += " AND (ItemCode LIKE :q OR ItemName LIKE :q)"
        params["q"] = f"%{search.strip()}%"
    sql += f" ORDER BY ItemCode {limit_clause(100)}"
    return [{"id": int(r["ItemID"]), "code": (r["ItemCode"] or "").strip(), "name": (r["ItemName"] or "").strip()} for r in conn.execute(text(sql), params).mappings()]


def _bind(cond: str, params: dict, item_id: int | None) -> str:
    """Replace the EXE's placeholders by bound parameters (the item filter by the chosen item or every active item)."""
    cond = re.sub(r"@FROMDATE", ":from_date", cond, flags=re.I)
    cond = re.sub(r"@TODATE", ":to_date", cond, flags=re.I)
    if item_id:
        params["item_id"] = int(item_id)
        return re.sub(r"@ID", ":item_id", cond, flags=re.I)
    return re.sub(r"@ID", "SELECT ItemID FROM MstItem WHERE InActive = 'N'", cond, flags=re.I)


def run(conn: Connection, *, doc_id: int, start: date, end: date, item_id: int | None) -> dict:
    miss = _missing(conn)
    if miss:
        return {"available": False, "title": menu_title(conn, caption=REPORT), "missing": miss}
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From Date should be less than To Date....")
    d = conn.execute(text("SELECT DocName, RateType FROM UtlProfitMargin WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Please Select Valid Document.....")
    rt = (d["RateType"] or "").strip().upper()
    kind = {"STANDARD RATE": "S", "AVG RATE": "A"}.get(rt)
    if kind is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The rate type '{(d['RateType'] or '').strip()}' is not supported (LAST PURCHASE RATE is not ported)")
    det = conn.execute(text("SELECT * FROM UtlProfitDtlFlds WHERE DocID = :d ORDER BY Slno"), {"d": doc_id}).mappings().all()
    sales = [r for r in det if (r["DocType"] or "").strip().upper() == "SALES"]
    purchase = [r for r in det if (r["DocType"] or "").strip().upper() == "PURCHASE"]
    if not sales:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Select Valid Document.....")

    params: dict = {"from_date": start, "to_date": end}
    selects: list[str] = []
    out_cols: list[dict] = []
    for si, r in enumerate(sales):
        cols, tables = [], []
        this_cols: list[dict] = []

        def pair(tbl_col: str, fld_col: str):
            """(table, column) of a designer field when it is filled in, else None; both must be plain identifiers."""
            if not (r[tbl_col] or "").strip():
                return None
            return _ident(r[tbl_col], "table"), _ident(r[fld_col], "column")

        for key, tx, tb, fl in _FIELDS:
            pf = pair(tb, fl)
            if pf:
                alias = _alias(r[tx]) or tidy(pf[1])
                cols.append(f"{pf[0]}.{pf[1]} AS [{alias}]")
                tables.append(pf[0])
                this_cols.append({"key": key, "label": alias, "type": "number" if key in _NUMERIC else "text"})
        srate, svalue = pair("FldSRateTbl", "FldSRate"), pair("FldSValueTbl", "FldSValue")
        if kind == "S":
            # standard rate: the purchase rate / value are columns of the sales document itself
            pr, prv = pair("FldPRTbl", "FldPR"), pair("FldPRVTbl", "FldPRV")
            for pf, label, key in ((pr, "Purchase Rate", "pr"), (prv, "Purchase Value", "prv")):
                if pf:
                    cols.append(f"{pf[0]}.{pf[1]} AS [{label}]")
                    tables.append(pf[0])
                    this_cols.append({"key": key, "label": label, "type": "number"})
            if srate and pr:
                cols.append(f"{srate[0]}.{srate[1]} - {pr[0]}.{pr[1]} AS [Difference]")
                this_cols.append({"key": "diff", "label": "Difference", "type": "number"})
            if svalue and prv:
                cols.append(f"{svalue[0]}.{svalue[1]} - {prv[0]}.{prv[1]} AS [DifferenceValue]")
                this_cols.append({"key": "diff_value", "label": "DifferenceValue", "type": "number"})
            from_sql = ", ".join(dict.fromkeys(tables))
            extra_join = ""
        else:
            cols += ["v.[Purchase Rate]", "v.[Purchase Value]"]
            this_cols += [{"key": "pr", "label": "Purchase Rate", "type": "number"}, {"key": "prv", "label": "Purchase Value", "type": "number"}]
            if srate:
                cols.append(f"{srate[0]}.{srate[1]} - v.[Purchase Rate] AS [Difference]")
                this_cols.append({"key": "diff", "label": "Difference", "type": "number"})
            if svalue:
                cols.append(f"{svalue[0]}.{svalue[1]} - v.[Purchase Value] AS [DifferenceValue]")
                this_cols.append({"key": "diff_value", "label": "DifferenceValue", "type": "number"})
            if not purchase:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The definition has no PURCHASE source for the average rate")
            # the purchase side: AVG of the purchase rate / value per item over every PURCHASE source
            subs = []
            for pi, p in enumerate(purchase):
                it_t, it_f = _ident(p["FldItemTbl"], "table"), _ident(p["FldItem"], "column")
                pr_t, pr_f = _ident(p["FldPRTbl"], "table"), _ident(p["FldPR"], "column")
                pv_t, pv_f = _ident(p["FldPRVTbl"], "table"), _ident(p["FldPRV"], "column")
                ptables = ", ".join(dict.fromkeys([it_t, pr_t, pv_t]))
                subs.append(
                    f"SELECT {it_t}.{it_f} AS [{_alias(r['FldItemText']) or tidy(it_f)}], AVG({pr_t}.{pr_f}) AS [Purchase Rate], AVG({pv_t}.{pv_f}) AS [Purchase Value] "
                    f"FROM {ptables} WHERE 1 = 1 {_bind(_cond(p['FldCond']), params, item_id)} GROUP BY {it_t}.{it_f}"
                )
            from_sql = ", ".join(dict.fromkeys(tables)) + f", ({' UNION ALL '.join(subs)}) v"
            item_alias = _alias(r["FldItemText"]) or tidy(_ident(r["FldItem"], "column"))
            extra_join = f" AND v.[{item_alias}] = {_ident(r['FldItemTbl'], 'table')}.{_ident(r['FldItem'], 'column')}"
        selects.append(f"SELECT {', '.join(cols)} FROM {from_sql} WHERE 1 = 1 {_bind(_cond(r['FldCond']), params, item_id)}{extra_join}")
        if si == 0:
            out_cols = this_cols
    sql = " UNION ALL ".join(selects)
    result = conn.execute(text(sql), params)
    labels = [c["label"] for c in out_cols]
    names = list(result.keys())
    rows = []
    for rec in result.fetchmany(MAX_ROWS):
        row = {}
        for name, v in zip(names, rec):
            row[name] = v.date().isoformat() if hasattr(v, "date") and hasattr(v, "hour") else (float(v) if hasattr(v, "as_tuple") else v)
        rows.append(row)
    totals = {c["label"]: round(sum(float(r.get(c["label"]) or 0) for r in rows), 2) for c in out_cols if c["type"] == "number"}
    return {"available": True, "title": menu_title(conn, caption=REPORT), "type": (d["DocName"] or "").strip(), "rate_type": kind, "columns": out_cols, "labels": labels, "rows": rows, "totals": totals, "truncated": len(rows) >= MAX_ROWS}
