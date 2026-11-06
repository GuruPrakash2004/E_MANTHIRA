"""
Accounting reports ported from the decompiled EXE (read-only; nothing here writes):

* Voucher Listing (frmRptVoucherList) - the detail lines of ONE voucher document: `TrnDtl<SF> d JOIN <ledger master> l JOIN
  TrnHdr<SF> h`, filtered by date range / ledgers / prefix, plus any header fields the user ticks. Which vouchers exist,
  their types, names, prefixes and the extra fields are all read from `UtlTransactions` / `UtlDocDsgrFlds` / the table
  itself - nothing is typed into the code.
* Day Book (FrmRptDayBook) - payment vouchers and receipt vouchers (not auto-receipts) in a date range with the money
  transfer mode, receipts and payments, subtotalled per document type. The EXE also unions sales orders, estimates and
  labour payments of the trading product; this database edition has none of those documents, so only the sources whose
  tables and columns exist are used and the response says which were skipped.

Cancelled documents are listed but flagged and left out of the totals (the EXE added them in, overstating the book).
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.captions import menu_title, tidy
from app.core.db import limit_clause

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_ROWS = 20000


def _have(conn: Connection) -> dict[str, set[str]]:
    """{table (lower): {column (lower)}} for every table / view of this database."""
    out: dict[str, set[str]] = {}
    for t, c in conn.execute(text("SELECT table_name, column_name FROM information_schema.columns")):
        out.setdefault(t.lower(), set()).add(c.lower())
    return out


def _cols(conn: Connection, table: str) -> list[str]:
    return [r[0] for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = :t ORDER BY ordinal_position"), {"t": table})]


# ---------------------------------------------------------------- Voucher Listing

REPORT_VOUCHER = "Voucher Listing"  # the menu rows have no form name, so they are found by caption
REPORT_DAYBOOK = "Day Book"


def _voucher_docs(conn: Connection) -> list[dict]:
    """Voucher documents of this database whose header + detail tables really exist and can be listed (ledger + Dr/Cr columns)."""
    have = _have(conn)
    docs = []
    for r in conn.execute(
        text("SELECT DocID, DocName, TrnDocType, HdrTblName, DtlTblName, DocShForm FROM UtlTransactions WHERE DocType = 'Voucher' ORDER BY TrnDocType, DocName")
    ).mappings():
        h, d, sf = (r["HdrTblName"] or "").strip(), (r["DtlTblName"] or "").strip(), (r["DocShForm"] or "").strip()
        if not (_IDENT.match(h) and _IDENT.match(d) and _IDENT.match(sf)):
            continue
        hc, dc = have.get(h.lower()), have.get(d.lower())
        if not hc or not dc:
            continue
        if not {"acledid", "dramt", "cramt", f"{sf}id".lower()} <= dc or not {f"{sf}id".lower(), f"{sf}date".lower(), f"{sf}no".lower()} <= hc:
            continue
        docs.append({"doc_id": int(r["DocID"]), "name": (r["DocName"] or "").strip(), "type": (r["TrnDocType"] or "").strip(), "hdr": h, "dtl": d, "sf": sf})
    return docs


def voucher_options(conn: Connection) -> dict:
    docs = _voucher_docs(conn)
    types: dict[str, list[dict]] = {}
    for d in docs:
        types.setdefault(d["type"], []).append({"doc_id": d["doc_id"], "name": d["name"]})
    return {
        "available": bool(docs),
        "title": menu_title(conn, caption=REPORT_VOUCHER),
        "types": [{"type": t, "docs": v} for t, v in types.items()],
        "captions": {"type": tidy("TrnDocType"), "name": tidy("DocName"), "prefix": tidy("Prefix"), "ledger": tidy("AcLedName")},
    }


def _doc(conn: Connection, doc_id: int) -> dict:
    for d in _voucher_docs(conn):
        if d["doc_id"] == doc_id:
            return d
    raise HTTPException(status.HTTP_404_NOT_FOUND, "That voucher cannot be listed in this database")


def voucher_doc_info(conn: Connection, doc_id: int) -> dict:
    d = _doc(conn, doc_id)
    hdr_cols = {c.lower(): c for c in _cols(conn, d["hdr"])}
    prefixes = [r[0] for r in conn.execute(text(f"SELECT DISTINCT Prefix FROM {d['hdr']} WHERE Prefix IS NOT NULL ORDER BY Prefix"))] if "prefix" in hdr_cols else []
    fields = [
        {"code": hdr_cols[(f["FldCode"] or "").strip().lower()], "caption": (f["FldCaption"] or "").strip()}
        for f in conn.execute(text("SELECT FldCode, FldCaption FROM UtlDocDsgrFlds WHERE DocID = :d ORDER BY FldSection, FldOrderBy"), {"d": doc_id}).mappings()
        if (f["FldCode"] or "").strip().lower() in hdr_cols
    ]
    return {"doc_id": doc_id, "name": d["name"], "prefixes": [p.strip() for p in prefixes if p and p.strip()], "fields": fields}


def ledger_master(conn: Connection) -> tuple[str, str, str]:
    """(table, id column, name column) of the master the voucher lines' `AcLedID` points to: `MstAcLed`, exactly what the EXE
    joins. (The ledger master's own LEDID only equals AcLedID in a few temple editions, so it is never used for voucher lines.)"""
    have = _have(conn)
    if {"acledid", "acledname"} <= have.get("mstacled", set()):
        return "MstAcLed", "AcLedID", "AcLedName"
    row = conn.execute(text("SELECT TOP 1 HdrTblName, DocShForm FROM UtlTransactions WHERE HdrTblName = 'MstLed' ORDER BY DocID")).mappings().first()
    if row and (row["DocShForm"] or "").strip():
        sf = row["DocShForm"].strip()
        cols = have.get("mstled", set())
        if {f"{sf}id".lower(), f"{sf}name".lower()} <= cols and _IDENT.match(sf):
            return "MstLed", f"{sf}ID", f"{sf}NAME"
    return "MstAcLed", "AcLedID", "AcLedName"


def ledgers(conn: Connection, search: str = "") -> list[dict]:
    tbl, idc, namec = ledger_master(conn)
    sql = f"SELECT {idc} AS LedID, {namec} AS LedName FROM {tbl} WHERE {idc} > 0 AND {namec} <> '-'"
    params: dict = {}
    if search.strip():
        sql += f" AND {namec} LIKE :q"
        params["q"] = f"%{search.strip()}%"
    sql += f" ORDER BY {namec} {limit_clause(200)}"
    return [{"id": int(r["LedID"]), "name": (r["LedName"] or "").strip()} for r in conn.execute(text(sql), params).mappings()]


def voucher_listing(
    conn: Connection, *, doc_id: int, start: date | None, end: date | None, ledger_ids: list[int], prefix: str, fields: list[str]
) -> dict:
    d = _doc(conn, doc_id)
    sf, hdr, dtl = d["sf"], d["hdr"], d["dtl"]
    hdr_cols = {c.lower(): c for c in _cols(conn, hdr)}
    dtl_cols = {c.lower() for c in _cols(conn, dtl)}
    extra = []
    for f in fields:
        real = hdr_cols.get((f or "").strip().lower())
        if real is None or not _IDENT.match(real):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"'{f}' is not a field of this voucher")
        extra.append(real)
    caps = {x["code"]: x["caption"] for x in voucher_doc_info(conn, doc_id)["fields"]}

    ltbl, lid, lname = ledger_master(conn)
    where, params = [f"h.{sf}ID = d.{sf}ID"], {}  # lines whose ledger is missing from the master stay in the listing (blank name), so the books still add up
    if start:
        where.append(f"h.{sf}Date >= :a")
        params["a"] = start
    if end:
        where.append(f"h.{sf}Date <= :b")
        params["b"] = end
    ids = [int(i) for i in ledger_ids]
    if ids:
        names = ", ".join(f":l{i}" for i in range(len(ids)))
        where.append(f"d.AcLedID IN ({names})")
        params.update({f"l{i}": v for i, v in enumerate(ids)})
    if prefix.strip():
        if "prefix" not in hdr_cols:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This voucher has no prefix")
        where.append("h.Prefix = :p")
        params["p"] = prefix.strip()
    cancelled = "h.Cancelled" if "cancelled" in hdr_cols else "'N'"
    order = f"h.{sf}Date, h.{sf}ID" + (", d.SlNo" if "slno" in dtl_cols else "")
    sel_extra = "".join(f", h.{c}" for c in extra)
    sql = (
        f"SELECT RIGHT(CONVERT(varchar, h.{sf}Date, 106), 8) AS MnthDate, h.{sf}Date AS DocDate, h.{sf}No AS DocNo, l.{lname} AS MainLed, "
        f"d.DrAmt, d.CrAmt, {cancelled} AS Cancelled{sel_extra} FROM {dtl} d LEFT JOIN {ltbl} l ON d.AcLedID = l.{lid}, {hdr} h WHERE {' AND '.join(where)} ORDER BY {order} {limit_clause(MAX_ROWS)}"
    )
    rows = []
    for r in conn.execute(text(sql), params).mappings():
        rows.append(
            {
                "month": (r["MnthDate"] or "").strip(),
                "date": r["DocDate"].date().isoformat() if r["DocDate"] else None,
                "no": (str(r["DocNo"]) if r["DocNo"] is not None else "").strip(),
                "ledger": (r["MainLed"] or "").strip(),
                "dr": float(r["DrAmt"] or 0),
                "cr": float(r["CrAmt"] or 0),
                "cancelled": (r["Cancelled"] or "N").strip().upper() == "Y",
                "fields": {c: (r[c].isoformat() if hasattr(r[c], "isoformat") else (str(r[c]).strip() if r[c] is not None else "")) for c in extra},
            }
        )
    live = [r for r in rows if not r["cancelled"]]

    def totals(key) -> list[dict]:
        out: dict = {}
        for r in live:
            k = key(r)
            t = out.setdefault(k, {"dr": 0.0, "cr": 0.0})
            t["dr"] = round(t["dr"] + r["dr"], 2)
            t["cr"] = round(t["cr"] + r["cr"], 2)
        return [{"key": k, **v} for k, v in out.items()]

    return {
        "title": d["name"],
        "captions": {
            "month": tidy("MnthDate"),
            "date": tidy(f"{sf}Date".removeprefix(sf)),  # the real column minus the document's short form
            "no": tidy(f"{sf}No".removeprefix(sf)),
            "ledger": tidy("MainLed"),
            "dr": tidy("DrAmt").removesuffix(" Amt"),
            "cr": tidy("CrAmt").removesuffix(" Amt"),
            "fields": {c: caps.get(c) or tidy(c) for c in extra},
        },
        "rows": rows,
        "total": {"dr": round(sum(r["dr"] for r in live), 2), "cr": round(sum(r["cr"] for r in live), 2)},
        "by_day": totals(lambda r: r["date"]),
        "by_month": totals(lambda r: r["month"]),
        "truncated": len(rows) >= MAX_ROWS,
    }


# ---------------------------------------------------------------- Day Book

# The sources of the EXE's Day Book that this edition can have. The structure (which column is the number / date / party /
# amount) is the EXE's SQL; the names shown to the user come from UtlTransactions.
_PAYMENT = {"hdr": "TrnHdrPMTVCH", "id": "PMTVCHID", "no": "PMTVCHNO", "date": "PMTVCHDate", "need": ("narr", "totcr", "vchtyp"), "doc": "PMTVCH", "side": "paid", "filter": None}
_RECEIPT = {"hdr": "TrnHdrRCPTVCH", "id": "RCPTVCHID", "no": "RCPTVCHNO", "date": "RCPTVCHDate", "need": ("narr", "totcr", "vchtyp"), "doc": "RCPTVCH", "side": "rcvd", "filter": "frmtrn"}


def _daybook_sources(conn: Connection) -> tuple[list[dict], list[dict]]:
    have = _have(conn)
    ok, skipped = [], []
    for s in (_PAYMENT, _RECEIPT):
        cols = have.get(s["hdr"].lower())
        label = (conn.execute(text("SELECT TOP 1 DocName FROM UtlTransactions WHERE HdrTblName = :t"), {"t": s["hdr"]}).scalar() or s["hdr"]).strip()
        if not cols:
            skipped.append({"label": label, "reason": f"table {s['hdr']} is not in this database"})
            continue
        need = {s["id"].lower(), s["no"].lower(), s["date"].lower(), *s["need"]} | ({s["filter"]} if s["filter"] else set())
        lack = sorted(need - cols)
        if lack:
            skipped.append({"label": label, "reason": f"{s['hdr']} has no column {', '.join(lack)}"})
            continue
        ok.append({**s, "label": label, "has_cancelled": "cancelled" in cols})
    return ok, skipped


def daybook_options(conn: Connection) -> dict:
    ok, skipped = _daybook_sources(conn)
    modes: set[str] = set()
    for s in ok:
        modes |= {(r[0] or "").strip() for r in conn.execute(text(f"SELECT DISTINCT VchTyp FROM {s['hdr']}")) if (r[0] or "").strip()}
    return {
        "available": bool(ok),
        "title": menu_title(conn, caption=REPORT_DAYBOOK),
        "modes": sorted(modes),
        "sources": [s["label"] for s in ok],
        "skipped": skipped,
        "captions": {"mode": tidy("PaymentMode"), "from": tidy("DateFrom"), "to": tidy("DateTo")},
    }


def day_book(conn: Connection, *, start: date, end: date, mode: str = "") -> dict:
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From Date should be less than To Date....")
    ok, skipped = _daybook_sources(conn)
    if not ok:
        return {"available": False, "title": menu_title(conn, caption=REPORT_DAYBOOK), "skipped": skipped}
    rows: list[dict] = []
    for s in ok:
        cancelled = "Cancelled" if s["has_cancelled"] else "'N'"
        sql = (
            f"SELECT {s['id']} AS TrnID, {s['no']} AS DocNo, {s['date']} AS DocDate, Narr AS Party, TOTCR AS DocAmt, VchTyp AS PaymentMode, "
            f"{cancelled} AS Cancelled FROM {s['hdr']} WHERE {s['date']} BETWEEN :a AND :b"
        )
        params: dict = {"a": start, "b": end}
        if s["filter"]:
            sql += f" AND {s['filter']} = 'N'"  # receipts typed in on the voucher screen, not the ones Seva / Donation post themselves
        if mode.strip():
            sql += " AND VchTyp = :m"
            params["m"] = mode.strip()
        for r in conn.execute(text(sql + f" ORDER BY {s['date']}, {s['id']}"), params).mappings():
            amt = float(r["DocAmt"] or 0)
            rows.append(
                {
                    "doc_type": s["label"],
                    "trn_id": int(r["TrnID"]),
                    "no": (str(r["DocNo"]) if r["DocNo"] is not None else "").strip(),
                    "date": r["DocDate"].date().isoformat(),
                    "party": (r["Party"] or "").strip(),
                    "amount": amt,
                    "mode": (r["PaymentMode"] or "").strip(),
                    "received": amt if s["side"] == "rcvd" else 0.0,
                    "paid": amt if s["side"] == "paid" else 0.0,
                    "cancelled": (r["Cancelled"] or "N").strip().upper() == "Y",
                }
            )
    rows.sort(key=lambda r: (r["doc_type"], r["date"], r["trn_id"]))  # the EXE's: DocType, DocDate, TrnID
    live = [r for r in rows if not r["cancelled"]]
    groups: dict[str, dict] = {}
    for r in live:
        g = groups.setdefault(r["doc_type"], {"doc_type": r["doc_type"], "received": 0.0, "paid": 0.0})
        g["received"] = round(g["received"] + r["received"], 2)
        g["paid"] = round(g["paid"] + r["paid"], 2)
    return {
        "available": True,
        "title": menu_title(conn, caption=REPORT_DAYBOOK),
        "from": start.isoformat(),
        "to": end.isoformat(),
        "captions": {
            "doc_type": tidy("DocType"), "no": tidy("DocNo"), "date": tidy("DocDate"), "party": tidy("Party"), "amount": tidy("DocAmt"),
            "mode": tidy("PaymentMode"), "received": tidy("RcvdAmount"), "paid": tidy("PaidAmt"),
        },
        "rows": rows,
        "groups": list(groups.values()),
        "total": {"received": round(sum(r["received"] for r in live), 2), "paid": round(sum(r["paid"] for r in live), 2)},
        "skipped": skipped,
    }
