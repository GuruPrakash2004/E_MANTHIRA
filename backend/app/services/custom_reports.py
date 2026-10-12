"""
Customised Reports — port of the "Customised Reports" builder (doc 07 §5.8:
"UtlReportsCRHdr/Tbl/Dtl -> safe SQL builder (whitelisted tables/columns
from definition, filters flagged FilterReq)"). 7 real report definitions in
this client's data (Seva Entry, Donation Detail/Summary, Hall Booking,
Hall Booking Start-Date-Wise, Receipt Voucher, Hall Booking with Voucher).

Safety note: every table/column name interpolated into SQL here comes from
`UtlReportsCRHdr`/`UtlReportsCRTbl`/`UtlReportsCRDtl` — admin-authored report
DEFINITIONS, never end-user request text. The only end-user input (filter
VALUES) always goes through bound parameters. Same trust boundary the rest
of this app already uses for `UtlDocDsgrFlds`-driven dynamic SQL
(CLAUDE.md rule 5) — identifiers are only ever taken from metadata tables an
admin controls via the DB, not from the request body.
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _check_ident(name: str) -> str:
    if not _IDENT_RE.match(name or ""):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unsafe identifier in report definition: {name!r}")
    return name


def list_reports(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT CRID, CRName, CRDesc, ReportGroup FROM UtlReportsCRHdr ORDER BY ReportGroup, CRName")).mappings().all()
    return [{"crid": r["CRID"], "name": r["CRName"], "desc": r["CRDesc"] or "", "group": r["ReportGroup"] or "General"} for r in rows]


def get_definition(conn: Connection, crid: int) -> dict:
    hdr = conn.execute(text("SELECT * FROM UtlReportsCRHdr WHERE CRID = :id"), {"id": crid}).mappings().first()
    if hdr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    tbls = conn.execute(text("SELECT TblName, TblLinkCond FROM UtlReportsCRTbl WHERE CRID = :id AND TblLinkCond <> ''"), {"id": crid}).mappings().all()
    dtls = conn.execute(
        text("SELECT * FROM UtlReportsCRDtl WHERE CRID = :id AND (FldHideCol IS NULL OR FldHideCol <> 'Y') ORDER BY FldOrderBy"), {"id": crid}
    ).mappings().all()
    return {
        "crid": crid,
        "name": hdr["CRName"],
        "hdr_table": hdr["HdrTblName"],
        "joins": [{"table": t["TblName"], "cond": t["TblLinkCond"]} for t in tbls],
        "fields": [
            {
                "table": d["TblName"],
                "code": d["FldCode"],
                "caption": d["FldCaption"],
                "filter_req": (d["FilterReq"] or "N").strip().upper() == "Y",
                "tot_req": (d["TotReq"] or "N").strip().upper() == "Y",
                "data_type": (d["FldDataType"] or "TEXT").strip().upper(),
            }
            for d in dtls
        ],
    }


def _col_alias(table: str, code: str) -> str:
    return f"{table}__{code}"


def run_report(conn: Connection, *, crid: int, filters: dict[str, str]) -> dict:
    defn = get_definition(conn, crid)
    hdr_table = _check_ident(defn["hdr_table"])

    select_parts = []
    for f in defn["fields"]:
        t = _check_ident(f["table"])
        c = _check_ident(f["code"])
        select_parts.append(f"{t}.{c} AS [{_col_alias(t, c)}]")

    sql = f"SELECT {', '.join(select_parts)} FROM {hdr_table}"
    for j in defn["joins"]:
        t = _check_ident(j["table"])
        if t == hdr_table:
            continue
        # TblLinkCond is a trusted, admin-authored join expression (see module docstring) — not user input.
        sql += f" LEFT JOIN {t} ON {j['cond']}"

    where_clauses = []
    params: dict = {}
    filterable = {f["code"]: f for f in defn["fields"] if f["filter_req"]}
    for i, (code, value) in enumerate(filters.items()):
        if not value:
            continue
        f = filterable.get(code.removesuffix("_from").removesuffix("_to"))
        if f is None:
            continue
        t = _check_ident(f["table"])
        c = _check_ident(f["code"])
        col = f"{t}.{c}"
        p = f"p{i}"
        if f["data_type"] == "DATE" and code.endswith("_from"):
            where_clauses.append(f"{col} >= :{p}")
            params[p] = value
        elif f["data_type"] == "DATE" and code.endswith("_to"):
            where_clauses.append(f"{col} <= :{p}")
            params[p] = value
        elif f["data_type"] == "NUMERIC":
            where_clauses.append(f"{col} = :{p}")
            params[p] = value
        else:
            where_clauses.append(f"{col} LIKE :{p}")
            params[p] = f"%{value}%"

    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)

    rows = conn.execute(text(sql), params).mappings().all()
    out_rows = [{_col_alias(f["table"], f["code"]): r[_col_alias(f["table"], f["code"])] for f in defn["fields"]} for r in rows]

    totals = {}
    for f in defn["fields"]:
        if f["tot_req"]:
            key = _col_alias(f["table"], f["code"])
            totals[key] = sum(float(r[key] or 0) for r in out_rows)

    return {"fields": defn["fields"], "rows": out_rows, "totals": totals, "count": len(out_rows)}
