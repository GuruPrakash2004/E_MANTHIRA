"""
Daily Sales Report (frmRptDSR) and Product Sales Summary Report (frmRptPdtSLS) - the trading module's sales-invoice
reports. They read the delivery-challan / sales-invoice tables (TrnHdrSINVDCT, TrnDtlSINVDCT, views vwSInvDtl /
vwSInvDtlFree) and master tables MstCust / MstSp. A client database without that module (like the temple's) simply
has no such tables; the screens then report the database error exactly as the legacy program does
("Invalid object name 'TrnHdrSINVDCT'.  Error in SQL: ...").
Only Trip No, the date range and (Daily Sales) "Select Sales Person" change the legacy queries; the other check boxes on
the legacy forms (customer / supplier / make / region / zone ...) do nothing there either.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import DBAPIError


def _run(conn: Connection, sql: str, params: dict | None = None) -> list[dict]:
    try:
        res = conn.execute(text(sql), params or {})
        return [dict(r) for r in res.mappings().all()]
    except DBAPIError as exc:
        msg = str(getattr(exc, "orig", exc))
        if "Invalid object name" in msg:
            name = msg.split("Invalid object name", 1)[1].split(".")[0].strip(" '\"")
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Invalid object name '{name}'.\nError in SQL: {' '.join(sql.split())}"
            ) from exc
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Error in SQL: {msg}") from exc


def trips(conn: Connection) -> list[str]:
    return [str(r["TripNO"]) for r in _run(conn, "SELECT DISTINCT TripNO FROM TrnHdrSINVDCT ORDER BY 1") if r["TripNO"] is not None]


def _check_trip(conn: Connection, trip: str) -> None:
    if trip and not _run(conn, "SELECT TOP 1 1 AS x FROM TrnHdrSINVDCT WHERE TripNo = :t", {"t": trip.strip()}):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Select Valid TripNo")


def daily_sales(conn: Connection, *, d1: date, d2: date, trip: str = "", by_user: bool = False) -> dict:
    if d1 > d2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From date Should Be less than To Date!")
    trip = (trip or "").strip()
    _check_trip(conn, trip)
    params: dict = {"d1": d1, "d2": d2 + timedelta(days=1)}
    cond = ""
    if trip and by_user:
        cond += " AND h.BILLTYPE = 'CREDIT'"
    if trip:
        cond += " AND h.TripNO = :trip"
        params["trip"] = trip
    items = [
        r["ITEMCODE"]
        for r in _run(
            conn,
            "SELECT DISTINCT i.ITEMCODE FROM TrnHdrSINVDCT h, TrnDtlSINVDCT d, MstITEM i WHERE h.SINVDCTID = d.SINVDCTID AND d.ITEMID = i.ITEMID "
            f"AND h.SINVDCTDate >= :d1 AND h.SINVDCTDate < :d2{cond} ORDER BY i.ITEMCODE",
            params,
        )
    ]
    if not items:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "NO Items available for this SINVNO")
    head = _run(
        conn,
        "SELECT SINVDCTNO, Cancelled, CustName, GstNO, SUM(CGSTAmt) AS GST, NETTOTRNDOFF, ToTGST, SPCODE FROM TrnHdrSINVDCT h, TrnDtlSINVDCT d, MstCust c, MstSp s "
        "WHERE h.custid = c.Custid AND h.SINVDCTID = d.SINVDCTID AND s.SPID = h.SPID "
        f"AND h.SINVDCTDate >= :d1 AND h.SINVDCTDate < :d2{cond} GROUP BY SINVDCTNO, Cancelled, CustName, GstNO, NETTOTRNDOFF, ToTGST, SPCODE ORDER BY SINVDCTNO",
        params,
    )
    qty: dict[str, dict[str, float]] = {}
    for r in _run(
        conn,
        "SELECT h.SINVDCTNO AS no, i.ItemCode AS code, SUM(d.SINVDCTQty) AS q FROM TrnHdrSINVDCT h, TrnDtlSINVDCT d, MstItem i "
        f"WHERE h.SINVDCTID = d.SINVDCTID AND d.ITEMID = i.ITEMID AND h.SINVDCTDate >= :d1 AND h.SINVDCTDate < :d2{cond} GROUP BY h.SINVDCTNO, i.ItemCode",
        params,
    ):
        qty.setdefault(r["no"], {})[str(r["code"]).upper()] = float(r["q"] or 0)
    rows = []
    for h in head:
        rows.append(
            {
                "inv_no": h["SINVDCTNO"],
                "cancelled": h["Cancelled"],
                "customer": h["CustName"],
                "gst_no": h["GstNO"],
                "gst": float(h["GST"] or 0),
                "net_total": float(h["NETTOTRNDOFF"] or 0),
                "sales_person": h["SPCODE"] if by_user else None,
                "vat": float(h["ToTGST"] or 0) if (trip and by_user) else None,
                "credit": float(h["NETTOTRNDOFF"] or 0) if (trip and by_user) else None,
                "items": {c: qty.get(h["SINVDCTNO"], {}).get(str(c).upper()) for c in items},
            }
        )
    return {"item_codes": items, "rows": rows, "show_user": by_user, "show_credit": bool(trip and by_user), "count": len(rows)}


def product_sales(conn: Connection, *, d1: date, d2: date, trip: str = "") -> dict:
    if d1 > d2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From date Should Be less than To Date!")
    trip = (trip or "").strip()
    _check_trip(conn, trip)
    params: dict = {"d1": d1, "d2": d2 + timedelta(days=1)}
    t = ""
    if trip:
        t = " AND h.TripNo = :trip"
        params["trip"] = trip
    dates = " AND Cancelled = 'N' AND SInvDCTDate >= :d1 AND SInvDCTDate < :d2"
    sql = (
        "SELECT ItemCode AS code, ItemName AS product, SUM(Qty) AS inv_qty, SUM(FreeQty) AS free_qty, "
        "CASE WHEN SUM(Qty) > 0 THEN SUM(ItemAmt) / SUM(Qty) ELSE 0 END AS rate, SUM(ItemAmt) AS value FROM ("
        f"SELECT ItemID, SUM(SInvDCTQty) AS FreeQty, 0 AS Qty, 0 AS Rate, 0 AS ItemAmt FROM TrnHdrSInvDct h, vwSInvDtlFree d WHERE h.SInvDCTID = d.SInvDCTID{t}{dates} GROUP BY ItemID "
        f"UNION ALL SELECT ItemID, 0, SUM(SInvDCTQty), 0, SUM(ItmTotAmt) FROM TrnHdrSInvDct h, vwSInvDtl d WHERE h.SInvDCTID = d.SInvDCTID{t}{dates} GROUP BY ItemID"
        ") a, MstItem i WHERE a.ItemID = i.ItemID GROUP BY ItemName, ItemCode ORDER BY ItemCode"
    )
    rows = []
    for n, r in enumerate(_run(conn, sql, params), start=1):
        rows.append(
            {
                "sl_no": n,
                "code": r["code"],
                "product": r["product"],
                "inv_qty": float(r["inv_qty"] or 0),
                "free_qty": float(r["free_qty"] or 0),
                "rate": float(r["rate"] or 0),
                "value": float(r["value"] or 0),
            }
        )
    return {"rows": rows, "count": len(rows)}
