"""Stock Balance Report, "OP << document wise >> Balance" - port of the legacy `frmRptStockBal.ViewClDetailed`.

One row per item (grouped by item group), one column per document type that moved stock in the period (PB, SA, ISS ... in the
order: stock-in documents first, then stock-out ones), between the opening quantity and the closing quantity:

    OP Qty | <DocType> Qty ... | Cl Qty        (+ the matching "Value" columns when values are asked for)

* OP    = the year's opening rows (UtlStockList DocType 'OP', DocID = the two-digit year) + every other movement of the year
          before the From date;
* <DT>  = Sum(Qty * StkMultiplier) of that document type inside the period, so a stock adjustment that reduces stock shows a
          negative quantity and one that adds stock a positive one (the Adjust Type of Stock Adjustment Entry decides the sign
          when the stock row is written: StkMultiplier = 1 for Add, -1 for Reduce);
* Cl    = OP + all document columns.
The grand total covers the document columns and the closing quantity (the legacy grid does not total the opening column).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.fy import FinancialYear
from app.services.stock_reports import _check_range, _gsetting, _in, _VAL_NAMES


def _company_header(conn: Connection) -> str:
    row = conn.execute(text("SELECT CompName, Address1, Address2, Address3, Address4, Address5 FROM MstComp WHERE CompID = 1")).mappings().first()
    if not row:
        return ""
    # legacy svtModule.initVsfForHdrs: gCompName + ",  " + Add1 + Add2 + Add3 + Add4 + Add5 (the address lines are joined as they are)
    addr = "".join(str(row.get(k) or "") for k in ("Address1", "Address2", "Address3", "Address4", "Address5"))
    return f"{str(row['CompName'] or '').strip()},  {addr}"


def balance_docwise(
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
    _check_range(fy, from_date, to_date)
    params: dict = {"d1": from_date, "d2": to_date, "fs": fy.start_date, "fyid": fy.start_date.year % 100}
    loc = ""
    if loc_id:
        loc = " AND s.LocID = :loc"
        params["loc"] = int(loc_id)
    flt = ""
    if item_ids:
        flt += f" AND i.ItemID IN ({_in('i', item_ids, params)})"
    if group_ids:
        flt += f" AND i.ItemGroupID IN ({_in('g', group_ids, params)})"

    # the document types that moved stock in the period: stock-in first (StkMultiplier desc), then by name; one column per type
    order = conn.execute(
        text(f"SELECT DISTINCT s.DocType, s.StkMultiplier FROM UtlStockList s WHERE s.DocDate BETWEEN :d1 AND :d2 AND s.DocType <> 'OP'{loc} ORDER BY s.StkMultiplier DESC, s.DocType"),
        params,
    ).all()
    doc_types: list[str] = []
    for dt, _mult in order:
        dt = str(dt).strip()
        if dt not in doc_types:
            doc_types.append(dt)

    sql = f"""
        SELECT i.ItemGroupID, g.ItemGroupName, i.ItemCode, i.ItemName, u.UOMCODE AS UomCode, i.ItemID, a.DocType, SUM(a.DocQty) AS DQty
        FROM (
            SELECT s.ItemID, 'OP' AS DocType, SUM(s.Qty * s.StkMultiplier) AS DocQty FROM UtlStockList s
            WHERE s.DocID = :fyid AND s.DocType = 'OP'{loc} GROUP BY s.ItemID
            UNION ALL
            SELECT s.ItemID, 'OP', SUM(s.Qty * s.StkMultiplier) FROM UtlStockList s
            WHERE s.DocType <> 'OP' AND s.DocDate >= :fs AND s.DocDate < :d1{loc} GROUP BY s.ItemID
            UNION ALL
            SELECT s.ItemID, s.DocType, SUM(s.Qty * s.StkMultiplier) FROM UtlStockList s
            WHERE s.DocType <> 'OP' AND s.DocDate BETWEEN :d1 AND :d2{loc} GROUP BY s.ItemID, s.DocType
        ) a
        JOIN MstItem i ON i.ItemID = a.ItemID
        JOIN MstItemGroup g ON g.ItemGroupID = i.ItemGroupID
        JOIN MstUOM u ON u.UOMID = i.UOMID
        WHERE i.NonStkable <> 'Y'{flt}
        GROUP BY i.ItemGroupID, g.ItemGroupName, i.ItemCode, i.ItemName, u.UOMCODE, i.ItemID, a.DocType
        ORDER BY g.ItemGroupName, i.ItemCode
    """
    by_item: dict[int, dict] = {}
    for r in conn.execute(text(sql), params).mappings().all():
        it = by_item.setdefault(
            int(r["ItemID"]),
            {"item_id": int(r["ItemID"]), "group": r["ItemGroupName"], "item_code": r["ItemCode"], "item_name": r["ItemName"], "uom": r["UomCode"], "op_qty": 0.0, "docs": {}},
        )
        q = float(r["DQty"] or 0)
        if str(r["DocType"]).strip() == "OP":
            it["op_qty"] += q
        else:
            it["docs"][str(r["DocType"]).strip()] = it["docs"].get(str(r["DocType"]).strip(), 0.0) + q

    rates: dict[int, float] = {}
    if show_value and by_item:
        # legacy: the item's inward rate where valuation is not pending, as of the To date
        for item_id, rate in conn.execute(
            text(
                "SELECT i.ItemID, ISNULL((SELECT TOP 1 u.Rate FROM UtlStockList u WHERE u.ItemID = i.ItemID AND u.StkMultiplier = 1 AND u.DocDate <= :d2 AND u.ValuationReq = 'N' ORDER BY u.RowID DESC), 0) "
                "FROM MstItem i WHERE i.ItemID IN (" + ",".join(str(int(k)) for k in by_item) + ")"
            ),
            {"d2": to_date},
        ).all():
            rates[int(item_id)] = float(rate or 0)

    rows = []
    for it in by_item.values():
        cl = it["op_qty"] + sum(it["docs"].values())
        if hide_zero and abs(cl) < 0.000001:
            continue
        row = {**it, "cl_qty": cl}
        if show_value:
            rate = rates.get(it["item_id"], 0.0)
            row["rate"] = rate
            row["op_value"] = abs(it["op_qty"] * rate)
            row["doc_values"] = {k: abs(v * rate) for k, v in it["docs"].items()}
            row["cl_value"] = abs(cl * rate)
        rows.append(row)

    totals = {"docs": {dt: sum(r["docs"].get(dt, 0.0) for r in rows) for dt in doc_types}, "cl_qty": sum(r["cl_qty"] for r in rows)}
    if show_value:
        totals["doc_values"] = {dt: sum(r["doc_values"].get(dt, 0.0) for r in rows) for dt in doc_types}
        totals["cl_value"] = sum(r["cl_value"] for r in rows)

    loc_name = ""
    if loc_id:
        loc_name = str(conn.execute(text("SELECT LocName FROM MstLoc WHERE LocID = :l"), {"l": int(loc_id)}).scalar() or "")
    val = (_gsetting(conn, "Inventory", "VaulationMethod", "S") or "S").upper()
    return {
        "mode": "docwise",
        "company": _company_header(conn),
        "title": "Stock Balance Report" + (f" - {loc_name}" if loc_name else " - "),
        "period": f"Period From {from_date:%d/%m/%Y} To {to_date:%d/%m/%Y}",
        "doc_types": doc_types,
        "rows": rows,
        "totals": totals,
        "valuation": val,
        "valuation_name": _VAL_NAMES.get(val, val),
        "count": len(rows),
    }
