"""
Stock Ledger Report and Stock Balance Report — ports of legacy frmRptStockLed and frmRptStockBal.

Both read the stock list (UtlStockList: Qty * StkMultiplier, DocType 'OP' = opening balance of the financial year, whose
DocID is the financial-year id). Nothing is written: the legacy balance report fills a per-user scratch table (RptStk);
here the same figures are computed in one query per measure.

Ledger: per item - opening (OP rows + movements before the From date within the year), then each movement with a running
balance, and a total of receipts / issues. Balance: per item - opening qty, receipts, issues, closing qty, and optionally
values by the client's valuation method (Inventory/VaulationMethod: S standard rate, P last purchase, W weighted average).
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.fy import FinancialYear

_VAL_NAMES = {"S": "Standard", "P": "Last Purchase", "W": "Weighted Avg", "MW": "Moving Weighted Avg", "FC": "FIFO - Consolidated", "FD": "FIFO - Docwise"}


def _gsetting(conn: Connection, group: str, name: str, default: str = "") -> str:
    v = conn.execute(
        text("SELECT TOP 1 SetValue FROM UtlGSettings WHERE UPPER(SetGroup) = UPPER(:g) AND UPPER(SetName) = UPPER(:n)"), {"g": group, "n": name}
    ).scalar()
    return (v or default).strip() if v is not None else default


def _check_range(fy: FinancialYear, d1: date, d2: date) -> None:
    if d1 < fy.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"From date cannot be less than {fy.start_date:%d/%m/%Y}")
    if d2 > fy.end_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"To date cannot be greater than {fy.end_date:%d/%m/%Y}")
    if d2 < d1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid Date Range!")


def _in(prefix: str, ids: list[int], params: dict) -> str:
    names = []
    for i, v in enumerate(ids):
        n = f"{prefix}{i}"
        params[n] = int(v)
        names.append(f":{n}")
    return ",".join(names)


def locations(conn: Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(text("SELECT LocID AS id, LocName AS name FROM MstLoc WHERE LocID > 0 AND InActive = 'N' ORDER BY LocName")).mappings().all()]


def item_groups(conn: Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(text("SELECT ItemGroupID AS id, ItemGroupName AS name FROM MstItemGroup WHERE ItemGroupID > 0 ORDER BY ItemGroupName")).mappings().all()]


def items_in_groups(conn: Connection, group_ids: list[int]) -> list[int]:
    params: dict = {}
    sql = f"SELECT ItemID FROM MstItem WHERE ItemID > 0 AND ItemGroupID IN ({_in('g', group_ids, params)})"
    return [r[0] for r in conn.execute(text(sql), params).all()]


# ---------------------------------------------------------------- Stock Ledger


def ledger(conn: Connection, *, fy: FinancialYear, from_date: date, to_date: date, item_ids: list[int], loc_id: int | None = None) -> dict:
    _check_range(fy, from_date, to_date)
    if not item_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select at least one item")
    params: dict = {"d1": from_date, "d2": to_date, "fs": fy.start_date, "fyid": fy.id}
    loc = ""
    if loc_id:
        loc = " AND s.LocID = :loc"
        params["loc"] = int(loc_id)
    items = _in("i", item_ids, params)
    sql = f"""
        SELECT a.ItemID, i.ItemCode, i.ItemName, u.UOMCODE AS UomCode, a.DocDate, a.DocName, a.DocType, a.ItemSlNo,
               SUM(a.DQty) AS DQty, AVG(a.StkRate) AS StkRate, a.Particulars, a.DocNo
        FROM (
            SELECT s.ItemID, :d1 AS DocDate, 'OP' AS DocName, 'OP' AS DocType, 0 AS ItemSlNo, SUM(s.Qty * s.StkMultiplier) AS DQty,
                   AVG(s.StkRate) AS StkRate, 'OP' AS Particulars, '' AS DocNo
            FROM UtlStockList s WHERE s.DocType = 'OP'{loc} AND s.DocID = :fyid AND s.ItemID IN ({items}) GROUP BY s.ItemID
            UNION ALL
            SELECT s.ItemID, :d1, 'OP', 'OP', 0, SUM(s.Qty * s.StkMultiplier), AVG(s.StkRate), 'OP', ''
            FROM UtlStockList s WHERE s.DocType <> 'OP'{loc} AND s.DocDate >= :fs AND s.DocDate < :d1 AND s.ItemID IN ({items}) GROUP BY s.ItemID
            UNION ALL
            SELECT s.ItemID, s.DocDate, s.DocName, s.DocType, s.ItemSlNo, s.Qty * s.StkMultiplier, s.StkRate, s.Particulars, s.DocNo
            FROM UtlStockList s WHERE s.DocType <> 'OP'{loc} AND s.DocDate >= :d1 AND s.DocDate <= :d2 AND s.ItemID IN ({items})
        ) a
        JOIN MstItem i ON a.ItemID = i.ItemID JOIN MstUOM u ON i.UOMID = u.UOMID
        GROUP BY a.ItemID, i.ItemCode, i.ItemName, u.UOMCODE, a.DocDate, a.DocName, a.DocType, a.ItemSlNo, a.Particulars, a.DocNo
        ORDER BY i.ItemCode, a.DocDate, a.DocType
    """
    out: list[dict] = []
    cur_item, bal, rec, iss = None, 0.0, 0.0, 0.0
    cur_code = cur_name = cur_uom = ""

    def close_item():
        if cur_item is not None:
            out.append({"_kind": "subtotal", "item_code": cur_code, "item_name": cur_name, "uom": cur_uom, "receipts": rec, "issues": iss, "balance": bal, "particulars": "Total"})

    for r in conn.execute(text(sql), params).mappings().all():
        if r["ItemID"] != cur_item:
            close_item()
            cur_item, bal, rec, iss = r["ItemID"], 0.0, 0.0, 0.0
            cur_code, cur_name, cur_uom = r["ItemCode"], r["ItemName"], r["UomCode"]
        q = float(r["DQty"] or 0)
        bal += q
        if q >= 0:
            rec += q
        else:
            iss += -q
        out.append(
            {
                "item_code": r["ItemCode"], "item_name": r["ItemName"], "uom": r["UomCode"], "doc_date": r["DocDate"], "doc_type": r["DocName"], "doc_no": r["DocNo"],
                "particulars": r["Particulars"], "receipts": q if q >= 0 else None, "issues": -q if q < 0 else None, "rate": r["StkRate"], "balance": bal,
            }
        )
    close_item()
    return {"rows": out, "count": sum(1 for r in out if "_kind" not in r)}


# ---------------------------------------------------------------- Stock Balance


def balance_info(conn: Connection) -> dict:
    m = _gsetting(conn, "Inventory", "VaulationMethod", "S") or "S"
    return {"valuation": m, "valuation_name": _VAL_NAMES.get(m, m)}


def balance(
    conn: Connection,
    *,
    fy: FinancialYear,
    from_date: date,
    to_date: date,
    loc_id: int | None = None,
    item_ids: list[int] | None = None,
    group_ids: list[int] | None = None,
    show_value: bool = False,
    hide_zero: bool = True,
) -> dict:
    """Legacy "OP Rcpt Issue Balance": per item - opening, receipts, issues, closing (+ values)."""
    _check_range(fy, from_date, to_date)
    val = (_gsetting(conn, "Inventory", "VaulationMethod", "S") or "S").upper()
    params: dict = {"d1": from_date, "d2": to_date, "fs": fy.start_date, "fyid": fy.id}
    loc = ""
    if loc_id:
        loc = " AND s.LocID = :loc"
        params["loc"] = int(loc_id)
    flt = ""
    if item_ids:
        flt += f" AND i.ItemID IN ({_in('i', item_ids, params)})"
    if group_ids:
        flt += f" AND i.ItemGroupID IN ({_in('g', group_ids, params)})"

    rate_expr = "0"
    if show_value:
        if val == "S":
            col = _gsetting(conn, "Inventory", "ItemStdRate", "ItemStdRate")
            cols = {r[0].lower(): r[0] for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'MstItem'")).all()}
            if col.lower() not in cols:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Field {col} not present in item Master. Change in Global Settings > Inventory > ItemStdRate")
            rate_expr = f"ISNULL(i.[{cols[col.lower()]}], 0)"
        elif val == "P":
            rate_expr = (
                "ISNULL((SELECT TOP 1 r.Rate FROM UtlStockList r WHERE r.DocDate <= :d2 AND r.ValuationReq = 'N' AND r.StkMultiplier = 1 AND r.Rate > 0 "
                "AND r.ItemID = t.ItemID ORDER BY r.DocID DESC, r.RowID DESC), 0)"
            )
        elif val == "W":
            rate_expr = "ISNULL((SELECT AVG(r.Rate) FROM UtlStockList r WHERE r.DocDate <= :d2 AND r.ValuationReq = 'N' AND r.StkMultiplier = 1 AND r.ItemID = t.ItemID), 0)"
        # any other method (MW / FC / FD / unknown): the legacy report leaves the rate at 0, so values show 0.00

    having = "HAVING ISNULL(SUM(x.OpQty), 0) + ISNULL(SUM(x.RQty), 0) + ISNULL(SUM(x.IQty), 0) <> 0" if hide_zero else ""
    sql = f"""
        SELECT t.ItemGroupName, t.ItemCode, t.ItemName, t.UomCode, t.OpQty, t.RQty, t.IQty, {rate_expr} AS Rate
        FROM (
            SELECT g.ItemGroupName, i.ItemCode, i.ItemName, u.UOMCODE AS UomCode, i.ItemID,
                   ISNULL(SUM(x.OpQty), 0) AS OpQty, ISNULL(SUM(x.RQty), 0) AS RQty, ISNULL(SUM(x.IQty), 0) AS IQty
            FROM MstItem i
            JOIN MstItemGroup g ON i.ItemGroupID = g.ItemGroupID
            JOIN MstUOM u ON i.UOMID = u.UOMID
            JOIN (
                SELECT s.ItemID, s.Qty * s.StkMultiplier AS OpQty, 0 AS RQty, 0 AS IQty FROM UtlStockList s WHERE s.DocType = 'OP' AND s.DocID = :fyid{loc}
                UNION ALL
                SELECT s.ItemID, s.Qty * s.StkMultiplier, 0, 0 FROM UtlStockList s WHERE s.DocType <> 'OP' AND s.DocDate >= :fs AND s.DocDate < :d1{loc}
                UNION ALL
                SELECT s.ItemID, 0, s.Qty * s.StkMultiplier, 0 FROM UtlStockList s WHERE s.DocType <> 'OP' AND s.StkMultiplier = 1 AND s.DocDate BETWEEN :d1 AND :d2{loc}
                UNION ALL
                SELECT s.ItemID, 0, 0, s.Qty * s.StkMultiplier FROM UtlStockList s WHERE s.DocType <> 'OP' AND s.StkMultiplier = -1 AND s.DocDate BETWEEN :d1 AND :d2{loc}
            ) x ON x.ItemID = i.ItemID
            WHERE i.NonStkable <> 'Y'{flt}
            GROUP BY g.ItemGroupName, i.ItemID, i.ItemCode, i.ItemName, u.UOMCODE
            {having}
        ) t
        JOIN MstItem i ON i.ItemID = t.ItemID
        ORDER BY t.ItemGroupName, t.ItemCode
    """
    rows = []
    for r in conn.execute(text(sql), params).mappings().all():
        op, rc, iss = float(r["OpQty"]), float(r["RQty"]), -float(r["IQty"])
        cl = op + rc - iss
        rate = float(r["Rate"] or 0)
        row = {"group": r["ItemGroupName"], "item_code": r["ItemCode"], "item_name": r["ItemName"], "uom": r["UomCode"], "op_qty": op, "rcpt_qty": rc, "issue_qty": iss, "closing_qty": cl}
        if show_value:
            row.update(op_value=op * rate, rcpt_value=rc * rate, issue_value=iss * rate, closing_value=cl * rate)
        rows.append(row)
    return {"rows": rows, "valuation": val, "valuation_name": _VAL_NAMES.get(val, val), "count": len(rows)}
