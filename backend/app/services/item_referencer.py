"""
Item Quick Referencer / History — port of legacy frmRptStkRef.

Pick an item, see its description / UOM / group (+ "BOM Available"), stock on hand (total and per location, active
financial year, from UtlStockList), the latest entry per transaction document, and the item's transaction history
between two dates (all documents, or one). The documents considered come from UtlTransactions (DocType 'Transaction'
with MstDocIDItem > 0, excluding 1186) joined to MstMenu, so a client's own document set drives the screen. Table and
column names are read from metadata and validated as identifiers before being used in SQL; values are all bound.
"""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.fy import FinancialYear

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PARTY_PREFIX = {1121: "Supp", 1112: "Cust"}


def search_items(conn: Connection, q: str = "", top: int = 50) -> list[dict]:
    like = f"%{q.strip()}%"
    rows = conn.execute(
        text(
            "SELECT TOP (:n) i.ItemID AS id, i.ItemCode AS code, i.ItemName AS name FROM MstItem i "
            "WHERE i.InActive = 'N' AND i.ItemID > 0 AND (i.ItemCode LIKE :q OR i.ItemName LIKE :q) ORDER BY i.ItemCode"
        ),
        {"n": top, "q": like},
    ).mappings().all()
    return [dict(r) for r in rows]


def _columns(conn: Connection, table: str) -> set[str]:
    if not _IDENT.match(table):
        return set()
    return {r[0].lower() for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": table}).all()}


def _docs(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT m.MenuGroupName AS grp, u.DocName, u.HdrTblName, u.DtlTblName, u.DocShForm, u.MstDocIDParty "
            "FROM UtlTransactions u JOIN MstMenu m ON u.DocID = m.DocID "
            "WHERE u.DocType = 'Transaction' AND u.MstDocIDItem > 0 AND u.DocID <> 1186 ORDER BY m.MenuGroupName, u.DocName"
        )
    ).mappings().all()
    out = []
    for r in rows:
        h, d, sf = (r["HdrTblName"] or "").strip(), (r["DtlTblName"] or "").strip(), (r["DocShForm"] or "").strip()
        if _IDENT.match(h) and _IDENT.match(d) and _IDENT.match(sf):
            out.append({"group": r["grp"], "doc_name": r["DocName"], "hdr": h, "dtl": d, "sf": sf, "party": _PARTY_PREFIX.get(int(r["MstDocIDParty"] or 0), "")})
    return out


def _history_sql(conn: Connection, doc: dict, with_uom: bool, with_range: bool) -> str:
    dcols = _columns(conn, doc["dtl"])
    sf, party = doc["sf"], doc["party"]
    qty_col = "Qty" if doc["dtl"].lower() == "trndtlsin" else f"{sf}Qty"
    cols = [f"h.{sf}No AS doc_no", f"h.{sf}Date AS doc_date"]
    cols.append(f"p.{party}Code AS party_code" if party else "'' AS party_code")
    cols.append(f"d.{qty_col} AS qty" if qty_col.lower() in dcols else "NULL AS qty")
    cols.append("d.UOMID AS uom_id" if with_uom and "uomid" in dcols else "NULL AS uom_id")
    cols.append(f"d.{sf}Rate AS rate" if f"{sf}rate".lower() in dcols else "NULL AS rate")
    sql = f"SELECT {', '.join(cols)} FROM {doc['hdr']} h JOIN {doc['dtl']} d ON h.{sf}ID = d.{sf}ID"
    if party:
        sql += f" JOIN Mst{party} p ON p.{party}ID = h.{party}ID"
    sql += " WHERE d.ItemID = :item"
    if with_range:
        sql += f" AND h.{sf}Date >= :d1 AND h.{sf}Date <= :d2"
    return sql


def item_info(conn: Connection, item_id: int, fy: FinancialYear) -> dict | None:
    it = conn.execute(
        text(
            "SELECT i.ItemID, i.ItemCode, i.ItemName, u.UOMCODE AS uom, g.ItemGroupCode AS grp FROM MstItem i "
            "LEFT JOIN MstUOM u ON u.UOMID = i.UOMID LEFT JOIN MstItemGroup g ON g.ItemGroupID = i.ItemGroupID WHERE i.ItemID = :i"
        ),
        {"i": item_id},
    ).mappings().first()
    if it is None:
        return None
    p = {"i": item_id, "s": fy.start_date, "e": fy.end_date}
    qoh = conn.execute(
        text("SELECT ISNULL(SUM(StkMultiplier * Qty), 0) FROM UtlStockList q JOIN MstLoc l ON q.LocID = l.LocID WHERE q.ItemID = :i AND q.DocDate BETWEEN :s AND :e"), p
    ).scalar()
    by_loc = conn.execute(
        text(
            "SELECT l.LocName AS location, ROUND(SUM(StkMultiplier * Qty), 2) AS qoh FROM UtlStockList q JOIN MstLoc l ON q.LocID = l.LocID "
            "WHERE q.ItemID = :i AND q.DocDate BETWEEN :s AND :e GROUP BY l.LocName ORDER BY 1"
        ),
        p,
    ).mappings().all()
    has_bom = bool(conn.execute(text("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'MstHdrBOM'")).scalar()) and bool(
        conn.execute(text("SELECT COUNT(*) FROM MstHdrBOM WHERE BOMItemID = :i"), {"i": item_id}).scalar()
    )
    last = []
    for d in _docs(conn):
        sql = _history_sql(conn, d, False, True).replace("SELECT ", "SELECT TOP 1 ", 1) + f" ORDER BY h.{d['sf']}No DESC"
        row = conn.execute(text(sql), {"item": item_id, "d1": fy.start_date, "d2": fy.end_date}).mappings().first()
        if row:
            info = f"NO:{row['doc_no']}, {row['doc_date']}"
            if row["party_code"]:
                info += f", {row['party_code']}"
            if row["qty"] is not None:
                info += f", Qty : {row['qty']}"
            if row["rate"] is not None:
                info += f", Rate:{row['rate']}"
            last.append({"group": d["group"], "doc_name": d["doc_name"], "info": info})
    op = conn.execute(
        text("SELECT TOP 1 FinYear, RcptDate, OPQty, OPRate FROM MstOPBalance WHERE RcptDate BETWEEN :s AND :e AND ItemID = :i"), p
    ).mappings().first() if _columns(conn, "MstOPBalance") else None
    if op:
        last.append({"group": "OP", "doc_name": "OP", "info": f"FinYear: {op['FinYear']}, {op['RcptDate']}, Qty : {op['OPQty']}, Rate: {op['OPRate']}"})
    return {
        "item_id": it["ItemID"], "code": it["ItemCode"], "name": it["ItemName"], "uom": it["uom"] or "", "group": it["grp"] or "",
        "fy_start": fy.start_date.isoformat(), "bom_available": has_bom, "qoh": float(qoh or 0), "by_location": [dict(r) for r in by_loc], "last_transactions": last,
        "docs": [d["doc_name"] for d in _docs(conn)],
    }


def history(conn: Connection, item_id: int, d1: date, d2: date, doc_name: str | None = None) -> list[dict]:
    out: list[dict] = []
    for d in _docs(conn):
        if doc_name and d["doc_name"] != doc_name:
            continue
        sql = _history_sql(conn, d, True, True) + f" ORDER BY h.{d['sf']}No DESC"
        rows = conn.execute(text(sql), {"item": item_id, "d1": d1, "d2": d2}).mappings().all()
        uoms: dict = {}
        for r in rows:
            uom = ""
            if r["uom_id"] is not None:
                if r["uom_id"] not in uoms:
                    uoms[r["uom_id"]] = conn.execute(text("SELECT UomCode FROM MstUOM WHERE UomID = :u"), {"u": r["uom_id"]}).scalar() or ""
                uom = uoms[r["uom_id"]]
            out.append({"doc_name": d["doc_name"], "doc_no": r["doc_no"], "doc_date": r["doc_date"], "party_code": r["party_code"] or "", "qty": r["qty"], "uom": uom, "rate": r["rate"]})
    if not doc_name or doc_name == "OP":
        if _columns(conn, "MstOPBalance"):
            for r in conn.execute(
                text("SELECT FinYear, RcptDate, OPQty, OPRate FROM MstOPBalance WHERE RcptDate >= :d1 AND RcptDate <= :d2 AND ItemID = :i"), {"d1": d1, "d2": d2, "i": item_id}
            ).mappings().all():
                out.append({"doc_name": "OP", "doc_no": r["FinYear"], "doc_date": r["RcptDate"], "party_code": "", "qty": r["OPQty"], "uom": "", "rate": r["OPRate"]})
    return out
