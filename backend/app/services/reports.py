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


def hall_booking_with_voucher(conn: Connection, *, from_date: date, to_date: date, hb_ids: list[int] | None = None) -> dict:
    """Hall Booking With Voucher Detail — port of legacy frmRptVIRNew.

    One block per hall booking that has receipt vouchers (TrnHdrRCPTVCH.HBID): Amount = total received + balance,
    followed by its receipt vouchers and linked donation receipts. `hb_ids` is the legacy "Select Invoice" subset.
    Cancelled bookings are listed (flagged), as in the old report.
    """
    params: dict = {"from_date": from_date, "to_date": to_date}
    sel = ""
    if hb_ids:
        names = {f"h{i}": int(v) for i, v in enumerate(hb_ids)}
        sel = " AND hb.HBID IN (" + ",".join(f":{n}" for n in names) + ")"
        params.update(names)
    head = conn.execute(
        text(
            "SELECT hb.HBID, hb.HBENDDT, hb.HBSTARTDT, hb.HBDate, hb.PrintHBNO, hb.NMEOFFUNC, hb.CONPRS, hb.CONTACTNO, hb.MOBNO, "
            "SUM(h.TotCR) + ISNULL(hb.BALAMT, 0) AS AMOUNT, hb.Cancelled, ISNULL(hb.BALAMT, 0) AS BALAMT "
            "FROM TrnHdrRCPTVCH h INNER JOIN TrnHdrHB hb ON h.HBID = hb.HBID "
            "WHERE hb.HBDate >= :from_date AND hb.HBDate <= :to_date" + sel + " "
            "GROUP BY hb.HBID, hb.HBENDDT, hb.HBSTARTDT, hb.HBDate, hb.PrintHBNO, hb.NMEOFFUNC, hb.CONPRS, hb.CONTACTNO, hb.MOBNO, hb.Cancelled, hb.BALAMT "
            "ORDER BY hb.HBDate, hb.PrintHBNO"
        ),
        params,
    ).mappings().all()
    rows: list[dict] = []
    tot_amount = tot_cr = tot_don = 0.0
    for h in head:
        base = {k: h[k] for k in ("HBID", "HBENDDT", "HBSTARTDT", "HBDate", "PrintHBNO", "NMEOFFUNC", "CONPRS", "CONTACTNO", "MOBNO", "AMOUNT", "Cancelled", "BALAMT")}
        tot_amount += float(h["AMOUNT"] or 0)
        rcpts = conn.execute(
            text("SELECT RCPTVCHNO, RCPTVCHDate, RCPTTYPE, TOTCR, VCHTYP FROM TrnHdrRCPTVCH WHERE HBID = :i ORDER BY RCPTVCHDate, RCPTVCHID"), {"i": h["HBID"]}
        ).mappings().all()
        dons = conn.execute(
            text("SELECT PREFIX, PRINTDONRECNO, TOTAMT FROM TrnHdrDONREC WHERE HBID = :i ORDER BY DONRECID"), {"i": h["HBID"]}
        ).mappings().all()
        n = max(len(rcpts), len(dons), 1)
        for i in range(n):
            row = dict(base) if i == 0 else {k: None for k in base} | {"HBID": h["HBID"]}
            row["first"] = i == 0
            if i < len(rcpts):
                r = rcpts[i]
                row.update(RCPTVCHNO=r["RCPTVCHNO"], RCPTVCHDate=r["RCPTVCHDate"], RCPTTYPE=r["RCPTTYPE"], TOTCR=r["TOTCR"], VCHTYP=r["VCHTYP"])
                tot_cr += float(r["TOTCR"] or 0)
            if i < len(dons):
                d = dons[i]
                row.update(PREFIX=d["PREFIX"], PRINTDONRECNO=d["PRINTDONRECNO"], DONAMT=d["TOTAMT"])
                tot_don += float(d["TOTAMT"] or 0)
            rows.append(row)
    return {"rows": rows, "total_count": len(head), "total_amount": tot_amount, "total_received": tot_cr, "total_donation": tot_don}


def hall_booking_vouchers_pick(conn: Connection, *, from_date: date, to_date: date) -> list[dict]:
    """The "Select Invoice" list: hall bookings (with receipts) in the period."""
    rows = conn.execute(
        text(
            "SELECT DISTINCT hb.HBID AS id, hb.PrintHBNO AS no, hb.HBDate AS date, hb.NMEOFFUNC AS func FROM TrnHdrHB hb "
            "INNER JOIN TrnHdrRCPTVCH h ON h.HBID = hb.HBID WHERE hb.HBDate >= :f AND hb.HBDate <= :t ORDER BY hb.HBDate, hb.PrintHBNO"
        ),
        {"f": from_date, "t": to_date},
    ).mappings().all()
    return [dict(r) for r in rows]


def _next_day(d: date) -> date:
    from datetime import timedelta

    return d + timedelta(days=1)
