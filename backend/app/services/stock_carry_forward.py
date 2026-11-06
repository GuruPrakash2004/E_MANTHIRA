"""Stock Carry Forward - port of the legacy `frmStkFinYrWriting` (Company Master > Financial Year(s) > Stock Carry Forward).

For the LATEST financial year the routine
  1. deletes that year's opening rows from `UtlStockList` (DocType 'OP', dated the year's first day) and clears `TrnQOH`;
  2. rewrites `MstOpBalance` for the year (FinYear = last two digits of the start year): per location and item the closing quantity
     of the previous year (`StkMultiplier * Qty` of every `UtlStockList` row dated within the previous year), the rate taken by the
     Inventory valuation method (S = the item's standard-rate field, P = last purchase rate, otherwise the stock row's own rate),
     negative quantities carry a rate of 0;
  3. writes those balances back as the year's 'OP' rows in `UtlStockList` (DocID = FinYear), which is where the stock reports
     read the opening from;
  4. rebuilds `TrnQOH` (quantity on hand per item and location) from the year's rows.
All in ONE transaction. Only the carry-forward itself is automated; nothing else in the books changes.

One deliberate difference: the legacy routine only looks at the previous year, so it assumes it was also run at the start of that
year. When the previous year has no opening rows while older stock exists, every earlier movement is carried forward instead, so
stock received in earlier years is not lost.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.services.stock_reports import _gsetting


def _years(conn: Connection) -> tuple[date, date, date | None]:
    rows = conn.execute(text("SELECT yrFdate, yrTdate FROM MstCompFinYear ORDER BY yrFdate")).all()
    if not rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "There is no Fin Year....")
    cur_from, cur_to = rows[-1][0].date(), rows[-1][1].date()
    prev_from = rows[-2][0].date() if len(rows) > 1 else None
    return cur_from, cur_to, prev_from


def carry_forward(conn: Connection, *, user_code: str) -> dict:
    cur_from, cur_to, prev_from = _years(conn)
    fin = cur_from.year % 100  # FinYear / the DocID of the opening rows: the last two digits of the start year
    last_to = cur_from - timedelta(days=1)
    last_from = prev_from or date(cur_from.year - 1, cur_from.month, cur_from.day)

    val = (_gsetting(conn, "Inventory", "VaulationMethod", "S") or "S").upper()
    rate_expr, join = "u.Rate", ""
    if val == "S":
        col = _gsetting(conn, "Inventory", "ItemStdRate", "ItemStdRate")
        cols = {r[0].lower(): r[0] for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'MstItem'")).all()}
        if col.lower() not in cols:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Field {col} not present in item Master. Change in Global Settings > Inventory > ItemStdRate")
        rate_expr, join = f"ISNULL(i.[{cols[col.lower()]}], 0)", "JOIN MstItem i ON i.ItemID = u.ItemID"
    elif val == "P":
        rate_expr = (
            "ISNULL((SELECT TOP 1 l.Rate FROM UtlStockList l WHERE u.ItemID = l.ItemID AND l.ValuationReq = 'N' AND l.StkMultiplier = 1 "
            "AND l.Rate > 0 AND l.DocDate <= :last_to ORDER BY l.DocID DESC, l.RowID DESC), 0)"
        )

    # the previous year had its own opening written: use exactly its rows (legacy); otherwise everything earlier except opening rows
    chained = conn.execute(text("SELECT TOP 1 1 FROM UtlStockList WHERE DocType = 'OP' AND DocDate = :d"), {"d": last_from}).first() is not None
    earlier = conn.execute(text("SELECT TOP 1 1 FROM UtlStockList WHERE DocDate < :d"), {"d": last_from}).first() is not None
    if chained or not earlier:
        window = "u.DocDate BETWEEN :last_from AND :last_to"
    else:
        window = "u.DocDate <= :last_to AND u.DocType <> 'OP'"
    params = {"cur_from": cur_from, "cur_to": cur_to, "last_from": last_from, "last_to": last_to, "fin": fin}

    # 1. clear this year's opening rows and the on-hand table
    conn.execute(text("DELETE FROM UtlStockList WHERE DocDate = :cur_from AND DocType = 'OP'"), {"cur_from": cur_from})
    conn.execute(text("DELETE FROM TrnQOH"))

    # 2. MstOpBalance
    conn.execute(text("DELETE FROM MstOpBalance WHERE FinYear = :fin"), {"fin": fin})
    conn.execute(
        text(
            "INSERT INTO MstOpBalance (FinYear, LocID, ItemID, RcptDate, RcptRef, OpQty, OpRate, Remarks) "
            "SELECT :fin, LocID, ItemID, :cur_from, '', SUM(Qty), AVG(Rate), 'Stock Carry Forward' FROM ("
            f"  SELECT u.LocID, u.ItemID, u.StkMultiplier * u.Qty AS Qty, {rate_expr} AS Rate FROM UtlStockList u {join} WHERE {window}"
            ") a GROUP BY LocID, ItemID HAVING SUM(Qty) <> 0"
        ),
        params,
    )
    conn.execute(text("UPDATE MstOpBalance SET OpRate = 0 WHERE OpQty < 0 AND FinYear = :fin"), {"fin": fin})

    # 3. the opening rows the stock reports read
    conn.execute(
        text(
            "INSERT INTO UtlStockList (UTDocID, DocID, DocName, DocType, DocNo, DocDate, ItemID, ItemSlno, LocID, StkMultiplier, Qty, Rate, Particulars, ValuationReq, StkRate, ReVal) "
            "SELECT 0, FinYear, 'Opening Balance', 'OP', '-', :cur_from, ItemID, 0, LocID, 1, SUM(OpQty), AVG(OpRate), '', 'N', AVG(OpRate), 'Y' "
            "FROM MstOpBalance WHERE FinYear = :fin GROUP BY ItemID, LocID, FinYear"
        ),
        {"cur_from": cur_from, "fin": fin},
    )
    items = conn.execute(text("SELECT COUNT(*) FROM MstOpBalance WHERE FinYear = :fin"), {"fin": fin}).scalar() or 0

    # 4. quantity on hand (legacy rewriteQOH deletes it once more first: writing the opening rows above already touched it)
    conn.execute(text("DELETE FROM TrnQOH"))
    conn.execute(
        text(
            "INSERT INTO TrnQOH (ItemID, LocID, CLBal) SELECT ItemID, LocID, SUM(Qty) FROM ("
            " SELECT ItemID, LocID, StkMultiplier * Qty AS Qty FROM UtlStockList WHERE DocDate BETWEEN :cur_from AND :cur_to"
            ") a GROUP BY ItemID, LocID HAVING SUM(Qty) <> 0"
        ),
        {"cur_from": cur_from, "cur_to": cur_to},
    )
    audit.record(conn, entity="Stock Carry Forward", entity_id=fin, action="M", user_code=user_code, details=f"FY {cur_from:%Y}-{cur_to:%y}: {items} balances carried forward")
    return {"fin_year": fin, "from_date": cur_from.isoformat(), "to_date": cur_to.isoformat(), "balances": int(items), "all_earlier_stock": not (chained or not earlier)}
