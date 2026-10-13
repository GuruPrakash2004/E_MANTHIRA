"""
Customised Reports — port of the legacy "Customised Reports..." screen (frmRptCustomiseRptView).

A report is a definition in the database, not code: UtlReportsCRHdr (name, group, description, CondText, IsSlnoReq),
UtlReportsCRTbl (tables + link conditions) and UtlReportsCRDtl (columns: caption, aggregate, hide, additional
expression, total, filter). This module builds the same SELECT the legacy form builds (getSTRSQL):

  * columns in FldOrderBy order (hidden ones skipped; an aggregate column becomes AGG(tbl.col) with GROUP BY on the rest;
    AddnlCol "expression|CAPTION" adds a computed column; IsSlnoReq adds a running serial number),
  * FROM the report's tables, WHERE the link conditions + CondText,
  * filters: DATE filter columns take a From/To range, the other filter columns take a list of picked values (IN).

Safety: every table / column / expression comes from the three definition tables, which only an administrator
authors (the same trust boundary as the rest of the metadata, CLAUDE.md rule 5). The end user supplies only filter
VALUES, and those are always bound parameters; filter columns must be flagged FilterReq='Y' in the definition.
"""
from __future__ import annotations

import io
import re
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ALIAS_RE = re.compile(r"[^A-Za-z0-9_ ]")


def _ident(name: str) -> str:
    if not _IDENT_RE.match(name or ""):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unsafe identifier in report definition: {name!r}")
    return name


def _yes(v) -> bool:
    return (v or "").strip().upper() == "Y"


def list_reports(conn: Connection, *, user_id: int, is_admin: bool) -> list[dict]:
    """Reports grouped by ReportGroup. Non-ADMIN users only get the ones assigned in UtlReportsCRRights."""
    sql = (
        "SELECT h.ReportGroup, h.CRID, h.CRName, h.CRDesc, h.RptFileName, "
        "(SELECT COUNT(*) FROM UtlReportsCRDtl d WHERE d.CRID = h.CRID AND d.FilterReq = 'Y') AS fq FROM UtlReportsCRHdr h"
    )
    params: dict = {}
    if not is_admin:
        sql += " WHERE h.CRID IN (SELECT CRID FROM UtlReportsCRRights WHERE UserID = :u)"
        params["u"] = user_id
    sql += " ORDER BY h.ReportGroup, h.CRName"
    return [
        {"crid": r["CRID"], "name": r["CRName"], "desc": r["CRDesc"] or "", "group": r["ReportGroup"] or "General", "has_filters": (r["fq"] or 0) > 0}
        for r in conn.execute(text(sql), params).mappings().all()
    ]


def _hdr(conn: Connection, crid: int):
    hdr = conn.execute(text("SELECT * FROM UtlReportsCRHdr WHERE CRID = :id"), {"id": crid}).mappings().first()
    if hdr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return hdr


def _details(conn: Connection, crid: int):
    return conn.execute(text("SELECT * FROM UtlReportsCRDtl WHERE CRID = :id ORDER BY FldOrderBy"), {"id": crid}).mappings().all()


def get_definition(conn: Connection, crid: int) -> dict:
    """What the screen needs before running: the report's description and its filter rows (legacy fillFilterFields)."""
    hdr = _hdr(conn, crid)
    dtl = _details(conn, crid)
    return {
        "crid": crid,
        "name": hdr["CRName"],
        "desc": hdr["CRDesc"] or "",
        "filters": [
            {"table": d["TblName"], "code": d["FldCode"], "caption": d["FldCaption"], "data_type": (d["FldDataType"] or "TEXT").strip().upper()}
            for d in dtl
            if _yes(d["FilterReq"])
        ],
    }


def _filter_field(conn: Connection, crid: int, table: str, code: str):
    for d in _details(conn, crid):
        if _yes(d["FilterReq"]) and (d["TblName"] or "").upper() == (table or "").upper() and (d["FldCode"] or "").upper() == (code or "").upper():
            return d
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That field is not a filter of this report")


def filter_values(conn: Connection, crid: int, table: str, code: str) -> list[str]:
    """The "..." picker next to a filter: the distinct values of that column."""
    d = _filter_field(conn, crid, table, code)
    t, c = _ident(d["TblName"]), _ident(d["FldCode"])
    rows = conn.execute(text(f"SELECT DISTINCT {t}.{c} FROM {t} WHERE {t}.{c} IS NOT NULL ORDER BY 1")).all()
    return [str(r[0]).strip() for r in rows if str(r[0]).strip() != ""]


def _parse_date(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid date in a report filter") from exc


def run_report(conn: Connection, *, crid: int, date_filters: list[dict] | None = None, list_filters: list[dict] | None = None) -> dict:
    hdr = _hdr(conn, crid)
    dtl = _details(conn, crid)
    slno = _yes(hdr["IsSlnoReq"])
    any_agg = any((d["FldAggregate"] or "").strip() for d in dtl)

    cols: list[dict] = []  # output columns, in order
    select: list[str] = []
    group: list[str] = []
    for d in dtl:
        if not _yes(d["FldHideCol"]):
            t, c = _ident(d["TblName"]), _ident(d["FldCode"])
            agg = (d["FldAggregate"] or "").strip()
            i = len(cols)
            if agg:
                if not re.match(r"^(Sum|Count|Avg|Min|Max)$", agg, re.I):
                    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Unsupported aggregate in report definition: {agg!r}")
                select.append(f"{agg}({t}.{c}) AS c{i}")
            else:
                select.append(f"{t}.{c} AS c{i}")
                if any_agg:
                    group.append(f"{t}.{c}")
            cols.append({"key": f"c{i}", "caption": d["FldCaption"], "tot_req": _yes(d["TotReq"])})
        addnl = (d["AddnlCol"] or "").strip()
        if addnl and "|" in addnl:
            expr, cap = addnl.split("|", 1)
            i = len(cols)
            select.append(f"{expr} AS c{i}")
            cols.append({"key": f"c{i}", "caption": cap.strip().upper(), "tot_req": False})
    if not select:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This report has no columns defined")

    dtl_tables = {(d["TblName"] or "").upper() for d in dtl}
    tbls = [t for t in conn.execute(text("SELECT TblName, TblLinkCond FROM UtlReportsCRTbl WHERE CRID = :id"), {"id": crid}).mappings().all() if (t["TblName"] or "").upper() in dtl_tables]
    if not tbls:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This report has no tables defined")
    where = ["1 = 1"]
    for t in tbls:
        if (t["TblLinkCond"] or "").strip():
            where.append(f"({t['TblLinkCond']})")
    cond = (hdr["CondText"] or "").strip()
    if cond:
        where.append(f"({re.sub(r'^\s*and\s+', '', cond, flags=re.I)})")

    params: dict = {}
    period_text, filter_text = "", ""
    for i, f in enumerate(date_filters or []):
        d = _filter_field(conn, crid, f.get("table"), f.get("code"))
        if (d["FldDataType"] or "").strip().upper() != "DATE":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{d['FldCaption']} is not a date filter")
        d1, d2 = _parse_date(f.get("from")), _parse_date(f.get("to"))
        if d2 < d1:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{d['FldCaption']}: To date is before From date")
        where.append(f"{_ident(d['TblName'])}.{_ident(d['FldCode'])} >= :df{i} AND {_ident(d['TblName'])}.{_ident(d['FldCode'])} < :dt{i}")
        params[f"df{i}"], params[f"dt{i}"] = d1, d2 + timedelta(days=1)
        period_text = f"Report for the period: from {d1:%d/%m/%Y} to {d2:%d/%m/%Y}"
    for i, f in enumerate(list_filters or []):
        vals = [v for v in (f.get("values") or []) if str(v).strip() != ""]
        if not vals:
            continue
        d = _filter_field(conn, crid, f.get("table"), f.get("code"))
        numeric = (d["FldDataType"] or "").strip().upper() == "NUMERIC"
        names = []
        for j, v in enumerate(vals):
            n = f"l{i}_{j}"
            try:
                params[n] = float(v) if numeric else str(v)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{d['FldCaption']}: '{v}' is not a number") from exc
            names.append(f":{n}")
        where.append(f"{_ident(d['TblName'])}.{_ident(d['FldCode'])} IN ({', '.join(names)})")
        filter_text += f" [{d['FldCaption']} = {', '.join(str(v) for v in vals)}]"

    sql = f"SELECT {', '.join(select)} FROM {', '.join(_ident(t['TblName']) for t in tbls)} WHERE {' AND '.join(where)}"
    if group:
        sql += " GROUP BY " + ", ".join(group)
    sql += " ORDER BY " + ", ".join(str(i + 1) for i in range(len(cols)))
    rows = [list(r) for r in conn.execute(text(sql), params).all()]

    if slno:
        cols.insert(0, {"key": "slno", "caption": "Sl.No", "tot_req": False})
        rows = [[n + 1, *r] for n, r in enumerate(rows)]
    totals: dict[str, float] = {}
    for idx, col in enumerate(cols):
        if col["tot_req"]:
            totals[col["key"]] = float(sum(float(r[idx] or 0) for r in rows))
    return {
        "title": hdr["CRName"],
        "period_text": period_text,
        "filter_text": filter_text.strip(),
        "columns": cols,
        "rows": rows,
        "totals": totals,
        "count": len(rows),
    }


def export_xlsx(result: dict) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = (result["title"] or "Report")[:31].replace("/", "-")
    ws.append([result["title"]])
    if result["period_text"] or result["filter_text"]:
        ws.append([f"{result['period_text']} {result['filter_text']}".strip()])
    ws.append([c["caption"] for c in result["columns"]])
    for r in result["rows"]:
        ws.append([v.isoformat(sep=" ") if isinstance(v, (datetime, date)) else (float(v) if hasattr(v, "as_tuple") else v) for v in r])
    if result["totals"]:
        ws.append(["Grand Total" if i == 0 else result["totals"].get(c["key"]) for i, c in enumerate(result["columns"])])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- Assign Rights (UtlReportsCRRights)


def rights_for_user(conn: Connection, user_id: int) -> list[int]:
    return [r[0] for r in conn.execute(text("SELECT CRID FROM UtlReportsCRRights WHERE UserID = :u"), {"u": user_id}).all()]


def save_rights(conn: Connection, user_id: int, crids: list[int]) -> int:
    from app.legacy.tables import insert_row

    conn.execute(text("DELETE FROM UtlReportsCRRights WHERE UserID = :u"), {"u": user_id})
    for cid in dict.fromkeys(crids):
        insert_row(conn, "UtlReportsCRRights", {"UserID": user_id, "CRID": cid})
    return len(set(crids))
