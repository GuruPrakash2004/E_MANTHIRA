"""
Doc XL Export / XL Template / XL Import — port of the legacy toolbar trio (ucBtn.tsbDocExport / tsbTemplate / tsbImport),
shown for a document whose UtlTransactions.AllowImpExp = 'Y' (Hall Booking Entry and Credit Note in vTmplSLV).

The sheet is the document's line grid: one column per visible Detail field of UtlDocDsgrFlds (header row = the
Designer's captions), or Account Head / Debit / Credit for a voucher. Import follows the legacy checks: the header row
must carry the grid's columns, every mandatory column must have a value, and the lines replace what is in the grid.
Files are Excel 97-2003 (.xls) like every other import / export in the app (app/utils/xls.py).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.meta import doc_rules
from app.meta import lookups as meta_lookups
from app.utils import xls

VOUCHER_COLUMNS = [
    {"code": "ac_led_id", "caption": "Account Head", "kind": "ledger", "mandatory": True},
    {"code": "dr_amt", "caption": "Debit", "kind": "number", "mandatory": False},
    {"code": "cr_amt", "caption": "Credit", "kind": "number", "mandatory": False},
]
_DATE_FORMATS = ("%d-%b-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y")


def _y(v) -> bool:
    return str(v or "N").strip().upper() == "Y"


def is_enabled(conn: Connection, doc_id: int) -> bool:
    return _y(conn.execute(text("SELECT AllowImpExp FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar())


def _require(conn: Connection, doc_id: int) -> None:
    if not is_enabled(conn, doc_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Excel import / export is not enabled for this document")


def doc_name(conn: Connection, doc_id: int) -> str:
    return (conn.execute(text("SELECT DocName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar() or f"Document {doc_id}").strip()


def columns(conn: Connection, doc_id: int) -> list[dict]:
    """The grid's columns in order: Designer Detail fields that are shown and typed in, else the voucher's Dr/Cr grid."""
    rows = [r for r in doc_rules.load_fields(conn, doc_id) if (r.get("FldSection") or "") == "Detail"]
    cols = []
    for r in sorted(rows, key=lambda x: float(x.get("FldOrderBy") or 0)):
        if _y(r.get("FLdBlnHide")) or _y(r.get("FldBlnReadOnly")) or _y(r.get("FldBlnDispOnly")):
            continue
        code = (r.get("FldCode") or "").strip()
        if not code:
            continue
        kind = "combo" if _y(r.get("FldBlnComboData")) else "date" if (r.get("FldDataType") or "").strip().lower() == "date" else "number" if (r.get("FldDataType") or "").strip().lower() in ("number", "decimal", "numeric", "integer") else "text"
        cols.append({"code": code, "caption": (r.get("FldCaption") or code).strip(), "kind": kind, "mandatory": _y(r.get("FldBlnMandatory")), "row": r})
    if cols:
        return cols
    kind = (conn.execute(text("SELECT DocType FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar() or "").strip().upper()
    return [dict(c) for c in VOUCHER_COLUMNS] if kind == "VOUCHER" else []


def template(conn: Connection, doc_id: int) -> bytes:
    _require(conn, doc_id)
    cols = columns(conn, doc_id)
    if not cols:
        raise HTTPException(status.HTTP_409_CONFLICT, "This document has no line grid to export")
    return xls.build_xls("Template", [[c["caption"] for c in cols]])


def _label(conn: Connection, doc_id: int, col: dict, value) -> object:
    if value is None or value == "":
        return ""
    if col["kind"] == "ledger":
        return conn.execute(text("SELECT LEDNAME FROM MstLed WHERE LEDID = :i"), {"i": value}).scalar() or ""
    if col["kind"] == "combo":
        return meta_lookups.display_of(conn, doc_id, col["code"], value)
    return value


def export_rows(conn: Connection, doc_id: int, rows: list[dict]) -> bytes:
    """The grid as it is on screen, one sheet: combo values become their names."""
    _require(conn, doc_id)
    cols = columns(conn, doc_id)
    if not cols:
        raise HTTPException(status.HTTP_409_CONFLICT, "This document has no line grid to export")
    out = [[c["caption"] for c in cols]]
    for r in rows:
        out.append([_label(conn, doc_id, c, r.get(c["code"])) for c in cols])
    return xls.build_xls(doc_name(conn, doc_id), out)


def _number(s: str, caption: str, line: int) -> float:
    try:
        return float(Decimal(s.replace(",", "")))
    except (InvalidOperation, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Row {line}: '{caption}' must be a number") from None


def _date(s: str, caption: str, line: int) -> str:
    for f in _DATE_FORMATS:
        try:
            return datetime.strptime(s.strip()[:11].strip(), f).date().isoformat()
        except ValueError:
            continue
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Row {line}: '{caption}' is not a valid date")


def _pick(conn: Connection, doc_id: int, col: dict, s: str, line: int) -> str:
    """Name -> id for a lookup column (exact name, ignoring case)."""
    if col["kind"] == "ledger":
        hit = conn.execute(text("SELECT TOP 1 LEDID FROM MstLed WHERE LTRIM(RTRIM(LEDNAME)) = :n"), {"n": s}).scalar()
    else:
        opts = meta_lookups.resolve_lookup(conn, doc_id=doc_id, field_code=col["code"], search=s, top=200)
        hit = next((o["value"] for o in opts if str(o["label"]).strip().lower() == s.lower()), None)
    if hit is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Row {line}: '{s}' is not a valid {col['caption']}")
    return str(hit)


def import_rows(conn: Connection, doc_id: int, data: bytes) -> list[dict]:
    """Read the sheet into line dicts (keys = the page's line keys). Raises 422 with the legacy-style message on the first problem."""
    _require(conn, doc_id)
    cols = columns(conn, doc_id)
    if not cols:
        raise HTTPException(status.HTTP_409_CONFLICT, "This document has no line grid to import into")
    grid = xls.read_xls(data)
    if not grid:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The Excel file is empty")
    head = [h.strip().lower() for h in grid[0]]
    pos = {}
    for c in cols:
        if c["caption"].lower() not in head:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Column '{c['caption']}' is missing in the Excel header row. Use the XL Template.")
        pos[c["code"]] = head.index(c["caption"].lower())

    out: list[dict] = []
    for n, raw in enumerate(grid[1:], start=2):
        cells = {c["code"]: (raw[pos[c["code"]]] if pos[c["code"]] < len(raw) else "").strip() for c in cols}
        if not any(cells.values()):
            continue  # blank sheet row
        line: dict = {}
        for c in cols:
            s = cells[c["code"]]
            if not s:
                if c["mandatory"]:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Row {n}: Mandatory Column '{c['caption']}' does not contain value in excel...")
                line[c["code"]] = 0 if c["kind"] == "number" else ""
                continue
            if c["kind"] == "number":
                v = _number(s, c["caption"], n)
                if c["mandatory"] and v <= 0:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Row {n}: Mandatory Column '{c['caption']}' Value should be greater than 0 in excel...")
                line[c["code"]] = v
            elif c["kind"] == "date":
                line[c["code"]] = _date(s, c["caption"], n)
            elif c["kind"] in ("combo", "ledger"):
                line[c["code"]] = _pick(conn, doc_id, c, s, n)
            else:
                opts = doc_rules.list_options(c["row"]) if c.get("row") else []
                if opts and s.upper() not in {o.upper() for o in opts}:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Row {n}: '{s}' is not one of {', '.join(opts)} for {c['caption']}")
                line[c["code"]] = s
        out.append(line)
    if not out:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The Excel file has no rows to import")
    return out
