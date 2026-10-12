"""
Subsidiary reports (doc 07 §5.8) — Complete Day, Detailed Collection, Seva
Issue/Schedule, Kanike/Donation. Reads straight off the legacy report views
(`vwSevaRptSMut`, `vwSevaIssueRpt`) and tables — never reimplements their
joins, per CLAUDE.md rule 5 (the view IS the source of truth the old app's
report forms already query).

Complete Day and Detailed Collection share the exact same data source and
filters in the legacy app (doc 07 §5.8: "Detailed Collection | same |
vwSevaRptSMut") — they only differ by print template — so one function
(`seva_collection`) backs both; the frontend just labels/prints them
differently.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection


def _in_clause(sql: str, params: dict, column: str, name: str, values: list[int] | None) -> str:
    if not values:
        return sql
    params[name] = values
    return sql + f" AND {column} IN :{name}"


def seva_collection(
    conn: Connection,
    *,
    from_date: date,
    to_date: date,
    sannidhi_ids: list[int] | None = None,
    seva_ids: list[int] | None = None,
    users: list[str] | None = None,
    time_from: str | None = None,
    time_to: str | None = None,
) -> dict:
    sql = """
        SELECT SEVAID, SEVANO, Printsevano AS PrintSevaNo, SEVADate, Name1, Name2, Sannadhi, Seva, Gothra,
               Nakshatra1, Nakshatra2, AddedBy, AddedOn, Payment, SevaRate, NoOfdays, Totalamt, Cancelled, issuedby AS IssuedBy, REFNO
        FROM vwSevaRptSMut
        WHERE SEVADate >= :from_date AND SEVADate < :to_date_excl
          AND (Cancelled IS NULL OR Cancelled <> 'Y')
    """
    params: dict = {"from_date": from_date, "to_date_excl": _next_day(to_date)}
    sql = _in_clause(sql, params, "SANNIDHIID", "sannidhi_ids", sannidhi_ids)
    sql = _in_clause(sql, params, "SVAID", "seva_ids", seva_ids)
    sql = _in_clause(sql, params, "AddedBy", "users", users)
    if time_from:
        sql += " AND CONVERT(time, AddedOn) >= :time_from"
        params["time_from"] = time_from
    if time_to:
        sql += " AND CONVERT(time, AddedOn) <= :time_to"
        params["time_to"] = time_to
    sql += " ORDER BY SEVADate, AddedOn"

    stmt = text(sql)
    for name in ("sannidhi_ids", "seva_ids", "users"):
        if name in params:
            stmt = stmt.bindparams(bindparam(name, expanding=True))
    rows = [dict(r) for r in conn.execute(stmt, params).mappings().all()]

    by_sannidhi_seva: dict[tuple, dict] = {}
    by_payment_mode: dict[str, dict] = {}
    for r in rows:
        key = (r["Sannadhi"], r["Seva"])
        g = by_sannidhi_seva.setdefault(key, {"sannidhi": r["Sannadhi"], "seva": r["Seva"], "count": 0, "amount": 0})
        g["count"] += 1
        g["amount"] += float(r["Totalamt"] or 0)

        pm = r["Payment"] or "—"
        p = by_payment_mode.setdefault(pm, {"payment_mode": pm, "count": 0, "amount": 0})
        p["count"] += 1
        p["amount"] += float(r["Totalamt"] or 0)

    return {
        "rows": rows,
        "summary_by_sannidhi_seva": list(by_sannidhi_seva.values()),
        "summary_by_payment_mode": list(by_payment_mode.values()),
        "total_count": len(rows),
        "total_amount": sum(float(r["Totalamt"] or 0) for r in rows),
    }


def seva_issue(
    conn: Connection,
    *,
    from_date: date,
    to_date: date,
    sannidhi_ids: list[int] | None = None,
    seva_ids: list[int] | None = None,
    users: list[str] | None = None,
) -> dict:
    sql = """
        SELECT SEVAID, SEVANO, PRINTSEVANO AS PrintSevaNo, SEVADATE, PDATE, NAME1, NAME2, SANNADHI, SEVA, MOBNUM,
               NAKSHATRA1, NAKSHATRA2, GOTHRA, RASHI1, RASHI2, ADDEDBY, ADDEDON
        FROM vwSevaIssueRpt
        WHERE PDATE >= :from_date AND PDATE < :to_date_excl
    """
    params: dict = {"from_date": from_date, "to_date_excl": _next_day(to_date)}
    sql = _in_clause(sql, params, "SANNIDHIID", "sannidhi_ids", sannidhi_ids)
    sql = _in_clause(sql, params, "SVAID", "seva_ids", seva_ids)
    sql = _in_clause(sql, params, "ADDEDBY", "users", users)
    sql += " ORDER BY PDATE, SANNADHI, SEVA"

    stmt = text(sql)
    for name in ("sannidhi_ids", "seva_ids", "users"):
        if name in params:
            stmt = stmt.bindparams(bindparam(name, expanding=True))
    rows = [dict(r) for r in conn.execute(stmt, params).mappings().all()]
    return {"rows": rows, "total_count": len(rows)}


def donations(conn: Connection, *, from_date: date, to_date: date) -> dict:
    sql = """
        SELECT DONRECID, DONRECNO, PrintDONRECNO, DONRECDate, DONOR, ADDRESS, CONTACTNO, PANNO,
               TOTAMT, PAYMNTMODE, RMKS, AddedBy, AddedOn, ISSUEDBY, Cancelled
        FROM TrnHdrDONREC
        WHERE DONRECDate >= :from_date AND DONRECDate < :to_date_excl
          AND (Cancelled IS NULL OR Cancelled <> 'Y')
        ORDER BY DONRECDate, DONRECID
    """
    params = {"from_date": from_date, "to_date_excl": _next_day(to_date)}
    rows = [dict(r) for r in conn.execute(text(sql), params).mappings().all()]
    return {"rows": rows, "total_count": len(rows), "total_amount": sum(float(r["TOTAMT"] or 0) for r in rows)}


def hall_booking_with_voucher(conn: Connection, *, from_date: date, to_date: date) -> dict:
    """Hall Booking with Voucher Detail (doc 07 §5.8) — `vw_HBRcpt` already joins booking + receipt + linked donation."""
    sql = """
        SELECT HBSTARTDT, HBENDDT, HBDate, PrintHBNO, NMEOFFUNC, CONPRS, CONTACTNO, MOBNO,
               AMOUNT, CGSTAMT, SGSTAMT, RCPTVCHNO, RCPTVCHDate, RCPTTYPE, TOTCR, VCHTYP, BALAMT, printdonrecno
        FROM vw_HBRcpt
        WHERE HBDate >= :from_date AND HBDate < :to_date_excl AND (Cancelled IS NULL OR Cancelled <> 'Y')
        ORDER BY HBDate, PrintHBNO
    """
    params = {"from_date": from_date, "to_date_excl": _next_day(to_date)}
    rows = [dict(r) for r in conn.execute(text(sql), params).mappings().all()]
    return {"rows": rows, "total_count": len(rows), "total_amount": sum(float(r["TOTCR"] or 0) for r in rows)}


def _next_day(d: date) -> date:
    from datetime import timedelta

    return d + timedelta(days=1)
