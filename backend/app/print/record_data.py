"""
Fetches the actual saved row (+ display names from master tables) for one
transaction record, so print previews show real data instead of blank
placeholders. The mock bridge only ever sees what we send it as
`record_data` (see print_service/README.md) — the real Crystal service would
query the DB itself, but a plain HTML/PDF preview has no DB connection of
its own, so this app must fetch and hand over the row exactly like the
legacy report's own SQL command / sub-report would.

One fetcher per DocID; add more here as more documents get print support.
Unknown doc ids return {} (template falls back to its own "—" placeholders).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Callable

from sqlalchemy import text
from sqlalchemy.engine import Connection


def _fmt_date(v: object) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, (date, datetime)):
        return v.strftime("%d/%m/%Y")
    return str(v)


def _fmt_amount(v: object) -> str:
    if v is None or v == "":
        return "0.00"
    return f"{float(v):,.2f}"


def _seva_record_data(conn: Connection, record_id: int) -> dict:
    row = conn.execute(
        text(
            """
            SELECT h.*, s.SANNIDHINAME, g.GOTHRANAME, n.NAKSHATRANAME, r.RASHINAME, sv.SVADISPNAME
            FROM TrnHdrSEVA h
            LEFT JOIN MstSANNIDHI s ON s.SANNIDHIID = h.SANNIDHIID
            LEFT JOIN MstGOTHRA g ON g.GOTHRAID = h.GOTHRAID
            LEFT JOIN MstNAKSHATRA n ON n.NAKSHATRAID = h.NAKSHATRAID
            LEFT JOIN MstRASHI r ON r.RASHIID = h.RASHIID
            LEFT JOIN MstSVA sv ON sv.SVAID = h.SVAID
            WHERE h.SEVAID = :id
            """
        ),
        {"id": record_id},
    ).mappings().first()
    if row is None:
        return {}
    return {
        "name": row["KNAME"] or "",
        "gothra": row["GOTHRANAME"] or "",
        "nakshatra": row["NAKSHATRANAME"] or "",
        "rashi": row["RASHINAME"] or "",
        "sannidhi": row["SANNIDHINAME"] or "",
        "seva": row["SVADISPNAME"] or "",
        "seva_date": row["DaysPrintText"] or _fmt_date(row["SEVADate"]),
        "amount": _fmt_amount(row["TotalAmt"]),
        "amount_in_words": row["AMTINWRDS"] or "",
        "doc_date": _fmt_date(row["SEVADate"]),
        "print_no": row["PrintSEVANO"] or "",
        "issued_by": row["ISSUEDBY"] or "",
        "payment_mode": row["PAYMENT"] or "",
    }


def _hall_record_data(conn: Connection, record_id: int) -> dict:
    row = conn.execute(
        text(
            """
            SELECT h.*, ha.HALLNAME
            FROM TrnHdrHB h
            LEFT JOIN MstHALL ha ON ha.HALLID = h.HALLID
            WHERE h.HBID = :id
            """
        ),
        {"id": record_id},
    ).mappings().first()
    if row is None:
        return {}
    return {
        "customer_name": row["CONPRS"] or "",
        "customer_address": row["ADDRESS"] or "",
        "customer_mobile": row["MOBNO"] or "",
        "doc_date": _fmt_date(row["HBDate"]),
        "print_no": row["PrintHBNO"] or "",
        "start_date": _fmt_date(row["HBSTARTDT"]),
        "end_date": _fmt_date(row["HBENDDT"]),
        "function_name": row["NMEOFFUNC"] or "",
        "hall_name": row["HALLNAME"] or "",
        "amount": _fmt_amount(row["TOTAMT"]),
        "net_pay": _fmt_amount(row["NETPAY"]),
        "amount_in_words": row["TOTAMTIWRDS"] or row["AMTINWORDS"] or "",
        "payment_mode": row["PAYMODE"] or row["PAYMNTMODE"] or "",
    }


_FETCHERS: dict[int, Callable[[Connection, int], dict]] = {
    1263: _seva_record_data,
    1281: _hall_record_data,
}


def record_data_for(conn: Connection, doc_id: int, record_id: int) -> dict:
    fetcher = _FETCHERS.get(doc_id)
    if fetcher is None:
        return {}
    return fetcher(conn, record_id)
