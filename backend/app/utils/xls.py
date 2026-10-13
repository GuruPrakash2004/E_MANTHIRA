"""
Excel 97-2003 (.xls) reading and writing — the only spreadsheet format the app imports and exports (xlwt / xlrd).

.xls limits: 65,536 rows and 256 columns per sheet, 32,767 characters per cell.
"""
from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal

import xlrd
import xlwt
from fastapi import HTTPException, status

MAX_ROWS = 65536
MAX_COLS = 256
MIME = "application/vnd.ms-excel"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0"  # .xls files are OLE2 compound documents; .xlsx files are zip archives


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Y" if v else "N"
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y %H:%M") if (v.hour or v.minute) else v.strftime("%d/%m/%Y")
    if isinstance(v, date):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, (int, float)):
        return v
    return str(v)[:32767]


def sheet_name(name: str) -> str:
    bad = '[]:*?/\\'
    n = "".join("-" if c in bad else c for c in (name or "Sheet1")).strip() or "Sheet1"
    return n[:31]


def build_xls(name: str, rows: list[list]) -> bytes:
    """One sheet, `rows` is a list of row lists (header row first if wanted)."""
    if len(rows) > MAX_ROWS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"An .xls sheet holds at most {MAX_ROWS:,} rows; narrow the filters and export again")
    if any(len(r) > MAX_COLS for r in rows):
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"An .xls sheet holds at most {MAX_COLS} columns")
    wb = xlwt.Workbook(encoding="utf-8")
    ws = wb.add_sheet(sheet_name(name))
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            ws.write(i, j, _cell(v))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def read_xls(data: bytes, sheet: str | None = None) -> list[list[str]]:
    """Rows of the named sheet (or the first) as strings; whole-number floats lose their '.0'."""
    if not data.startswith(_OLE_MAGIC):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only Excel 97-2003 (.xls) files can be imported. Save the file as .xls and try again")
    try:
        wb = xlrd.open_workbook(file_contents=data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not read the .xls file: {exc}") from exc
    ws = wb.sheet_by_name(sheet) if sheet and sheet in wb.sheet_names() else wb.sheet_by_index(0)
    out: list[list[str]] = []
    for r in range(ws.nrows):
        row = []
        for c in range(ws.ncols):
            cell = ws.cell(r, c)
            v = cell.value
            if cell.ctype == xlrd.XL_CELL_NUMBER and float(v).is_integer():
                v = int(v)
            elif cell.ctype == xlrd.XL_CELL_DATE:
                try:
                    v = xlrd.xldate_as_datetime(v, wb.datemode).strftime("%d/%m/%Y")
                except Exception:  # noqa: BLE001
                    pass
            row.append("" if v is None else str(v).strip())
        out.append(row)
    return out
