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


def _plain(v: object) -> str:
    """A numeric quantity (hours, days) as plain text — never a Decimal, which the JSON hand-off cannot carry."""
    if v is None or v == "":
        return ""
    f = float(v)
    return str(int(f)) if f == int(f) else f"{f:g}"


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


def _hall_lines_for_hb(conn: Connection, record_id: int, row) -> list[dict]:
    """TrnHdrHB is a single-hall booking (no detail table): one line from the header itself."""
    hall = row.get("HALLNAME") or ""
    return [{"slno": 1, "name": hall, "rate": _fmt_amount(row["AMOUNT"] if row["AMOUNT"] is not None else row["TOTAMT"]), "hrs": _plain(row["NOD"]), "amount": _fmt_amount(row["TOTAMT"])}]


def _hall_booking_extras(row) -> dict:
    return {
        "cgst": _fmt_amount(row.get("CGSTAMT")),
        "sgst": _fmt_amount(row.get("SGSTAMT")),
        "total_gst": _fmt_amount(row.get("TOTGSTAMT")),
        "amount_after_tax": _fmt_amount(row.get("AMTAFTTAX")),
        "security_deposit": _fmt_amount(row.get("SDEPAMT")),
        "advance": _fmt_amount(row.get("ADV")),
        "issued_by": row.get("ISSUEDBY") or "",
        "remarks": (row.get("RMKS") or "").strip(),
        "pan": (row.get("PAN") or "").strip(),
        "function_time": f"{row.get('STTIME') or ''} - {row.get('ENDTIME') or ''}".strip(" -"),
    }


def _hall_record_data_full(conn: Connection, record_id: int) -> dict:
    data = _hall_record_data(conn, record_id)
    if not data:
        return data
    row = conn.execute(
        text("SELECT h.*, ha.HALLNAME FROM TrnHdrHB h LEFT JOIN MstHALL ha ON ha.HALLID = h.HALLID WHERE h.HBID = :id"), {"id": record_id}
    ).mappings().first()
    row = dict(row)
    data.update(_hall_booking_extras(row))
    data["lines"] = _hall_lines_for_hb(conn, record_id, row)
    return data


def _hbe_record_data(conn: Connection, record_id: int) -> dict:
    """Hall Booking Entry (DocID 1280): flat receipt with its own detail lines (TrnDtlHBE)."""
    row = conn.execute(text("SELECT * FROM TrnHdrHBE WHERE HBEID = :id"), {"id": record_id}).mappings().first()
    if row is None:
        return {}
    row = dict(row)
    lines = conn.execute(text("SELECT SlNo, NAMEOFHALL, RATE, HRS, AMOUNT FROM TrnDtlHBE WHERE HBEID = :id ORDER BY SlNo"), {"id": record_id}).mappings().all()
    data = {
        "customer_name": row["CONPRS"] or "",
        "customer_address": row["ADDRESS"] or "",
        "customer_mobile": row["CONTACTNO"] or "",
        "doc_date": _fmt_date(row["HBEDate"]),
        "print_no": row["PrintHBENO"] or "",
        "start_date": _fmt_date(row["HBSTARTDT"]),
        "end_date": _fmt_date(row["HBENDDT"]),
        "function_name": row["NMEOFFUNC"] or "",
        "hall_name": ", ".join(l["NAMEOFHALL"] for l in lines if l["NAMEOFHALL"]),
        "amount": _fmt_amount(row["TOTAMT"]),
        "net_pay": _fmt_amount(row["NETPAY"]),
        "amount_in_words": row["TOTAMTIWRDS"] or row["AMTINWORDS"] or "",
        "payment_mode": row["PAYMNTMODE"] or row["PAYMODE"] or "",
        "lines": [{"slno": l["SlNo"], "name": l["NAMEOFHALL"] or "", "rate": _fmt_amount(l["RATE"]), "hrs": _plain(l["HRS"]), "amount": _fmt_amount(l["AMOUNT"])} for l in lines],
    }
    data.update(_hall_booking_extras(row))
    return data


def _donation_record_data(conn: Connection, record_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": record_id}).mappings().first()
    if row is None:
        return {}
    lines = conn.execute(text("SELECT SlNo, SEVANME, AMOUNT FROM TrnDtlDONREC WHERE DONRECID = :id ORDER BY SlNo"), {"id": record_id}).mappings().all()
    return {
        "print_no": row["PrintDONRECNO"] or "",
        "doc_date": _fmt_date(row["DONRECDate"]),
        "donor": (row["DONOR"] or "").strip(),
        "address": (row["ADDRESS"] or "").strip(),
        "contact_no": (row["CONTACTNO"] or "").strip(),
        "pan": (row["PANNO"] or "").strip(),
        "payment_mode": (row["PAYMNTMODE"] or "").strip(),
        "cheque_no": (row["CHEQUENO"] or "").strip(),
        "cheque_date": _fmt_date(row["CHEQUEDATE"]),
        "bank_name": (row["BANKNAME"] or "").strip(),
        "ref_no": (row["REFNO"] or "").strip(),
        "remarks": (row["RMKS"] or "").strip(),
        "amount": _fmt_amount(row["TOTAMT"]),
        "amount_in_words": row["AMTINWORDS"] or "",
        "issued_by": row["ISSUEDBY"] or "",
        "cancelled": (row["Cancelled"] or "N") == "Y",
        "lines": [{"slno": l["SlNo"], "particulars": l["SEVANME"] or "", "amount": _fmt_amount(l["AMOUNT"])} for l in lines],
    }


# prefix -> (title shown on the voucher, header table, detail table, id/no/date columns)
_VOUCHERS = {
    1224: ("PAYMENT VOUCHER", "PMTVCH"),
    1248: ("RECEIPT VOUCHER", "RCPTVCH"),
    1254: ("JOURNAL VOUCHER", "JNRVCH"),
}


def _voucher_record_data(conn: Connection, doc_id: int, record_id: int) -> dict:
    title, p = _VOUCHERS[doc_id]  # `p` comes from the fixed map above, never from input
    row = conn.execute(text(f"SELECT * FROM TrnHdr{p} WHERE {p}ID = :id"), {"id": record_id}).mappings().first()
    if row is None:
        return {}
    lines = conn.execute(
        text(
            f"""
            SELECT d.SlNo, a.PartyName, d.DrAmt, d.CrAmt
            FROM TrnDtl{p} d LEFT JOIN vwAcLed a ON a.AcLedID = d.AcLedID
            WHERE d.{p}ID = :id ORDER BY d.SlNo
            """
        ),
        {"id": record_id},
    ).mappings().all()
    return {
        "voucher_title": title,
        "print_no": row[f"Print{p}NO"] or "",
        "doc_date": _fmt_date(row[f"{p}Date"]),
        "narration": (row["NARR"] or "").strip(),
        "voucher_type": (row["VCHTYP"] or "").strip(),
        "cheque_no": (row["CHQNO"] or "").strip(),
        "cheque_dd_no": (row["CHQDDNO"] or "").strip(),
        "cheque_date": _fmt_date(row["CHQDT"]),
        "total_dr": _fmt_amount(row["TOTDR"]),
        "total_cr": _fmt_amount(row["TOTCR"]),
        "amount_in_words": row["AMTINWORDS"] or "",
        "issued_by": row["AddedBy"] or "",
        "cancelled": (row["Cancelled"] or "N") == "Y",
        "lines": [
            {"slno": l["SlNo"], "ledger": l["PartyName"] or "", "debit": _fmt_amount(l["DrAmt"]) if l["DrAmt"] else "", "credit": _fmt_amount(l["CrAmt"]) if l["CrAmt"] else ""}
            for l in lines
        ],
    }


def _expense_record_data(conn: Connection, record_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM TrnHdrEXP WHERE EXPID = :id"), {"id": record_id}).mappings().first()
    if row is None:
        return {}
    lines = conn.execute(
        text("SELECT d.SlNo, l.LEDNAME, d.ITEMDESC, d.AMOUNT, d.DRMKS FROM TrnDtlEXP d LEFT JOIN MstLed l ON l.LEDID = d.LEDID WHERE d.EXPID = :id ORDER BY d.SlNo"),
        {"id": record_id},
    ).mappings().all()
    from app.utils.amount_in_words import amount_in_words

    return {
        "print_no": row["PrintEXPNO"] or "",
        "doc_date": _fmt_date(row["EXPDate"]),
        "ref_no": (row["REFNO"] or "").strip(),
        "payment_mode": (row["PAYMNTMODE"] or "").strip(),
        "remarks": (row["RMKS"] or "").strip(),
        "cheque_no": (row["CHEQUENO"] or "").strip(),
        "cheque_date": _fmt_date(row["CHEQUEDT"]),
        "cheque_amount": _fmt_amount(row["CHEQUEAMT"]) if row["CHEQUEAMT"] else "",
        "bank_name": (row["BANKNAME"] or "").strip(),
        "amount": _fmt_amount(row["TOTAMT"]),
        "amount_in_words": amount_in_words(float(row["TOTAMT"] or 0)),
        "issued_by": row["AddedBy"] or "",
        "cancelled": (row["Cancelled"] or "N") == "Y",
        "lines": [{"slno": l["SlNo"], "ledger": l["LEDNAME"] or "", "desc": l["ITEMDESC"] or "", "amount": _fmt_amount(l["AMOUNT"]), "remarks": l["DRMKS"] or ""} for l in lines],
    }


def _group_seva_record_data(conn: Connection, record_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM TrnHdrGRPSEVA WHERE GRPSEVAID = :id"), {"id": record_id}).mappings().first()
    if row is None:
        return {}
    lines = conn.execute(
        text(
            """
            SELECT d.SlNo, s.SANNIDHINAME, sv.SVADISPNAME, d.SEVAKARTHRU, g.GOTHRANAME, n.NAKSHATRANAME, d.RASHI, d.RATE
            FROM TrnDtlGRPSEVA d
            LEFT JOIN MstSANNIDHI s ON s.SANNIDHIID = d.SANNIDHIID
            LEFT JOIN MstSVA sv ON sv.SVAID = d.SVAID
            LEFT JOIN MstGOTHRA g ON g.GOTHRAID = d.GOTRAID
            LEFT JOIN MstNAKSHATRA n ON n.NAKSHATRAID = d.NAKSHATRAID
            WHERE d.GRPSEVAID = :id ORDER BY d.SlNo
            """
        ),
        {"id": record_id},
    ).mappings().all()
    total = sum(float(l["RATE"] or 0) for l in lines)
    from app.utils.amount_in_words import amount_in_words

    return {
        "print_no": row["PrintGRPSEVANO"] or "",
        "doc_date": _fmt_date(row["GRPSEVADate"]),
        "name": (row["NAME"] or "").strip(),
        "mobile": (row["MOBNO"] or "").strip(),
        "amount": _fmt_amount(total),
        "amount_in_words": amount_in_words(total),
        "issued_by": row["AddedBy"] or "",
        "lines": [
            {"slno": l["SlNo"], "sannidhi": l["SANNIDHINAME"] or "", "seva": l["SVADISPNAME"] or "", "name": l["SEVAKARTHRU"] or "", "gothra": l["GOTHRANAME"] or "", "nakshatra": l["NAKSHATRANAME"] or "", "rashi": l["RASHI"] or "", "rate": _fmt_amount(l["RATE"])}
            for l in lines
        ],
    }


_FETCHERS: dict[int, Callable[[Connection, int], dict]] = {
    1263: _seva_record_data,
    1281: _hall_record_data_full,
    1280: _hbe_record_data,
    1261: _donation_record_data,
    1224: lambda conn, rid: _voucher_record_data(conn, 1224, rid),
    1248: lambda conn, rid: _voucher_record_data(conn, 1248, rid),
    1254: lambda conn, rid: _voucher_record_data(conn, 1254, rid),
    1260: _expense_record_data,
    1264: _group_seva_record_data,
}


def record_data_for(conn: Connection, doc_id: int, record_id: int) -> dict:
    fetcher = _FETCHERS.get(doc_id)
    if fetcher is None:
        return {}
    return fetcher(conn, record_id)
