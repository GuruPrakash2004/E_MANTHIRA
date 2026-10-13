"""
General Ledger — port of legacy FrmRptAccGL (menu "General Ledger").

For a kind of account (Supplier 'S' / Customer 'C' / Ledger 'L'), optionally limited to chosen accounts:
  * Summary: one line per account - opening balance, Dr, Cr, balance for the period.
  * Detail:  per account an opening line, then each posting (TrnHdrAcc/TrnDtlAcc) with a running balance.
Ledger accounts of the profit-and-loss main groups (In Direct Expense / Income / Direct Expense) open from the start of the
financial year only, the others from all earlier postings - exactly as the legacy query does.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

_PL = "('In Direct Expense','Income','Direct Expense')"
_TYPE = {"supplier": "S", "customer": "C", "ledger": "L"}
_GROUP_SQL = {
    "supplier": "isnull((select SUPPGROUPNAME from MstSupp s, MstSuppGroup g where s.SUPPGROUPID=g.SUPPGROUPID and suppcode=a.PartyCode),'-')",
    "customer": "isnull((select CUSTGROUPNAME from MstCust c, MstCustGroup g where c.CUSTGROUPID=g.CUSTGROUPID and CUSTcode=a.PartyCode),'-')",
    "ledger": "isnull((select LEDGROUPNAME from MstLED l, MstLEDGroup g where l.LEDGROUPID=g.LEDGROUPID and LEDcode=a.PartyCode),'-')",
}


def accounts(conn: Connection, kind: str) -> list[dict]:
    t = _TYPE.get(kind)
    if not t:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown account type")
    extra = " AND a.InActive = 'N'" if t == "L" else ""
    rows = conn.execute(
        text(
            "SELECT DISTINCT a.AcLedID AS id, a.AcLedName AS name, g.LedGroupName AS grp FROM MstAcLed a JOIN MstLedGroup g ON a.LedGroupID = g.LedGroupID "
            f"WHERE a.AcLedID > 0 AND a.LedType = :t{extra} ORDER BY a.AcLedName"
        ),
        {"t": t},
    ).mappings().all()
    return [dict(r) for r in rows]


def _fy_start(conn: Connection, d: date) -> date | None:
    return conn.execute(text("SELECT YRFDATE FROM MstCompFinYear WHERE :d BETWEEN YRFDATE AND YRTDATE"), {"d": d}).scalar()


def _party_filter(ids: list[int] | None, params: dict) -> str:
    if not ids:
        return ""
    names = []
    for i, v in enumerate(ids):
        params[f"p{i}"] = int(v)
        names.append(f":p{i}")
    return f" AND a.AcLedID IN ({','.join(names)})"


def _check(conn: Connection, kind: str, d1: date, d2: date) -> date | None:
    if d2 < d1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid Date Range!")
    if kind == "ledger":
        s1 = conn.execute(text("SELECT RowID FROM MstCompFinYear WHERE :d BETWEEN YRFDATE AND YRTDATE"), {"d": d1}).scalar()
        s2 = conn.execute(text("SELECT RowID FROM MstCompFinYear WHERE :d BETWEEN YRFDATE AND YRTDATE"), {"d": d2}).scalar()
        if s1 != s2:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Select date within the Financial year!")
        return _fy_start(conn, d1)
    return None


def summary(conn: Connection, *, kind: str, d1: date, d2: date, ac_ids: list[int] | None = None, hide_zero: bool = True) -> dict:
    fy0 = _check(conn, kind, d1, d2)
    t = _TYPE[kind]
    params: dict = {"d1": d1, "d2": d2, "t": t}
    flt = _party_filter(ac_ids, params)
    parts = []
    if kind == "ledger":
        if fy0 is not None and d1 != fy0:
            params["fy0"] = fy0
            parts.append(
                "SELECT d.AcLedID, SUM(DrAmt - CrAmt) AS OPBal, 0 AS DrAmt, 0 AS CrAmt, SUM(DrAmt - CrAmt) AS Balance FROM TrnHdrAcc h, TrnDtlAcc d, vwLedMainGrp vw "
            f"WHERE h.AccID = d.AccID AND TrnDate >= :fy0 AND TrnDate < :d1 AND d.AcLedID IN (SELECT AcLedID FROM MstAcLed WHERE LedType = 'L' AND InActive = 'N') "
            f"AND d.AcLedID = vw.AcLedID AND vw.LedMainGroup IN {_PL} GROUP BY d.AcLedID"
        )
        parts.append(
            "SELECT d.AcLedID, SUM(DrAmt - CrAmt), 0, 0, SUM(DrAmt - CrAmt) FROM TrnHdrAcc h, TrnDtlAcc d, vwLedMainGrp vw "
            "WHERE h.AccID = d.AccID AND TrnDate < :d1 AND d.AcLedID IN (SELECT AcLedID FROM MstAcLed WHERE LedType = 'L' AND InActive = 'N') "
            f"AND d.AcLedID = vw.AcLedID AND vw.LedMainGroup NOT IN {_PL} GROUP BY d.AcLedID"
        )
    else:
        parts.append(
            "SELECT d.AcLedID, SUM(DrAmt - CrAmt), 0, 0, SUM(DrAmt - CrAmt) FROM TrnHdrAcc h, TrnDtlAcc d WHERE h.AccID = d.AccID AND TrnDate < :d1 "
            "AND d.AcLedID IN (SELECT AcLedID FROM MstAcLed WHERE LedType = :t) GROUP BY d.AcLedID"
        )
    inactive = " AND InActive = 'N'" if kind == "ledger" else ""
    parts.append(
        "SELECT d.AcLedID, 0, CASE WHEN DrAmt - CrAmt > 0 THEN DrAmt - CrAmt ELSE 0 END, CASE WHEN DrAmt - CrAmt < 0 THEN DrAmt - CrAmt ELSE 0 END, DrAmt - CrAmt "
        "FROM TrnHdrAcc h, TrnDtlAcc d WHERE h.AccID = d.AccID AND TrnDate BETWEEN :d1 AND :d2 "
        f"AND d.AcLedID IN (SELECT AcLedID FROM MstAcLed WHERE LedType = :t{inactive})"
    )
    having = "HAVING SUM(Balance) <> 0" if hide_zero else ""
    sql = (
        f"SELECT a.PartyCode, {_GROUP_SQL[kind]} AS PartyGroup, a.PartyName, SUM(v.OPBal) AS OPBal, SUM(v.DrAmt) AS DrAmt, SUM(v.CrAmt) AS CrAmt, SUM(v.Balance) AS Balance "
        f"FROM ({' UNION ALL '.join(parts)}) v(AcLedID, OPBal, DrAmt, CrAmt, Balance), vwAcLed a WHERE v.AcLedID = a.AcLedID{flt} "
        f"GROUP BY a.PartyCode, a.PartyName {having} ORDER BY 1"
    )
    rows = [
        {"code": r["PartyCode"], "group": r["PartyGroup"], "name": r["PartyName"], "op_bal": float(r["OPBal"] or 0), "dr": abs(float(r["DrAmt"] or 0)), "cr": abs(float(r["CrAmt"] or 0)), "balance": float(r["Balance"] or 0)}
        for r in conn.execute(text(sql), params).mappings().all()
    ]
    tot = {k: sum(r[k] for r in rows) for k in ("op_bal", "dr", "cr", "balance")}
    return {"mode": "summary", "rows": rows, "totals": tot, "count": len(rows)}


def detail(conn: Connection, *, kind: str, d1: date, d2: date, ac_ids: list[int] | None = None) -> dict:
    fy0 = _check(conn, kind, d1, d2)
    t = _TYPE[kind]
    params: dict = {"d1": d1, "d2": d2, "t": t}
    flt = _party_filter(ac_ids, params)
    inactive = " AND a.InActive = 'N'" if kind == "ledger" else ""
    grp = _GROUP_SQL[kind]
    op_parts = []
    if kind == "ledger":
        if fy0 is not None and d1 != fy0:
            params["fy0"] = fy0
            op_parts.append(
                f"SELECT a.PartyCode, {grp} AS PartyGroup, a.PartyName, SUM(DrAmt - CrAmt) AS Net FROM TrnHdrAcc h, TrnDtlAcc d, vwAcLed a, vwLedMainGrp vw "
                f"WHERE h.AccID = d.AccID AND d.AcLedID = a.AcLedID{flt} AND TrnDate >= :fy0 AND TrnDate < :d1 AND a.LedType = 'L' AND a.InActive = 'N' "
                f"AND d.AcLedID = vw.AcLedID AND vw.LedMainGroup IN {_PL} GROUP BY a.PartyCode, a.PartyName"
            )
        op_parts.append(
            f"SELECT a.PartyCode, {grp}, a.PartyName, SUM(DrAmt - CrAmt) FROM TrnHdrAcc h, TrnDtlAcc d, vwAcLed a, vwLedMainGrp vw "
            f"WHERE h.AccID = d.AccID AND d.AcLedID = a.AcLedID{flt} AND TrnDate < :d1 AND a.LedType = 'L' AND a.InActive = 'N' "
            f"AND d.AcLedID = vw.AcLedID AND vw.LedMainGroup NOT IN {_PL} GROUP BY a.PartyCode, a.PartyName"
        )
    else:
        op_parts.append(
            f"SELECT a.PartyCode, {grp}, a.PartyName, SUM(DrAmt - CrAmt) FROM TrnHdrAcc h, TrnDtlAcc d, vwAcLed a "
            f"WHERE h.AccID = d.AccID AND d.AcLedID = a.AcLedID{flt} AND TrnDate < :d1 AND a.LedType = :t GROUP BY a.PartyCode, a.PartyName"
        )
    ops: dict[str, dict] = {}
    for sql in op_parts:
        for r in conn.execute(text(sql), params).all():
            o = ops.setdefault(r[0], {"code": r[0], "group": r[1], "name": r[2], "net": 0.0})
            o["net"] += float(r[3] or 0)
    mv = conn.execute(
        text(
            f"SELECT a.PartyCode, {grp} AS PartyGroup, a.PartyName, h.AccID, h.DocType, h.TrnID, h.TrnNo, h.TrnDate, h.Narrn, d.DrAmt, d.CrAmt "
            f"FROM TrnHdrAcc h, TrnDtlAcc d, vwAcLed a WHERE h.AccID = d.AccID AND d.AcLedID = a.AcLedID{flt} AND TrnDate BETWEEN :d1 AND :d2 "
            f"AND a.LedType = :t{inactive} ORDER BY a.PartyCode, a.PartyName, h.TrnDate, h.AccID"
        ),
        params,
    ).mappings().all()
    by_party: dict[str, list] = {}
    meta: dict[str, dict] = {}
    for r in mv:
        by_party.setdefault(r["PartyCode"], []).append(r)
        meta.setdefault(r["PartyCode"], {"code": r["PartyCode"], "group": r["PartyGroup"], "name": r["PartyName"]})
    for code, o in ops.items():
        meta.setdefault(code, {"code": code, "group": o["group"], "name": o["name"]})
    sign = -1 if kind == "supplier" else 1  # a supplier's balance is shown credit-positive
    rows: list[dict] = []
    for code in sorted(meta):
        m = meta[code]
        net = ops.get(code, {}).get("net", 0.0)
        bal = sign * net
        if code in ops and abs(net) > 0:
            rows.append({**m, "doc_type": "OP", "trn_no": "", "trn_date": d1, "narration": "Opening Balance", "dr": net if net > 0 else 0.0, "cr": -net if net < 0 else 0.0, "balance": bal})
        for r in by_party.get(code, []):
            dr, cr = float(r["DrAmt"] or 0), float(r["CrAmt"] or 0)
            bal += sign * (dr - cr)
            rows.append({**m, "doc_type": r["DocType"], "trn_no": r["TrnNo"], "trn_date": r["TrnDate"], "narration": r["Narrn"], "dr": dr, "cr": cr, "balance": bal})
    tot = {"dr": sum(r["dr"] for r in rows), "cr": sum(r["cr"] for r in rows)}
    return {"mode": "detail", "rows": rows, "totals": tot, "count": len(rows)}
