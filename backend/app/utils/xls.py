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
        return v.strftime("%d-%b-%Y %H:%M") if (v.hour or v.minute) else v.strftime("%d-%b-%Y")
    if isinstance(v, date):
        return v.strftime("%d-%b-%Y")
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


def build_listing_xls(name: str, company: str, title: str, headers: list[str], rows: list[list]) -> bytes:
    """The standard listing sheet: company name band, "Listing of <page>" band, a coloured header row, banded
    rows, and the first two columns frozen with the header (temple palette: maroon header, gold / ivory bands)."""
    if len(rows) + 3 > MAX_ROWS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"An .xls sheet holds at most {MAX_ROWS:,} rows; narrow the filters and export again")
    if len(headers) > MAX_COLS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"An .xls sheet holds at most {MAX_COLS} columns")
    wb = xlwt.Workbook(encoding="utf-8")
    for idx, (nm, rgb) in enumerate((("vt_gold", (0xF6, 0xEB, 0xC9)), ("vt_maroon", (0x7A, 0x1F, 0x1F)), ("vt_ivory", (0xFB, 0xF6, 0xEC)), ("vt_line", (0xE3, 0xD3, 0xB5))), start=0x21):
        xlwt.add_palette_colour(nm, idx)
        wb.set_colour_RGB(idx, *rgb)
    st_company = xlwt.easyxf("pattern: pattern solid, fore_colour vt_gold; font: bold on, height 300, name Calibri; align: vert centre")
    st_title = xlwt.easyxf("pattern: pattern solid, fore_colour vt_gold; font: bold on, height 240, name Calibri; align: vert centre")
    st_head = xlwt.easyxf("pattern: pattern solid, fore_colour vt_maroon; font: bold on, colour white, height 200, name Calibri; align: vert centre, wrap on; borders: bottom thin, bottom_colour vt_line")
    body = {}
    for i, shade in enumerate(("white", "vt_ivory")):
        base = f"pattern: pattern solid, fore_colour {shade}; font: name Calibri, height 200; borders: bottom thin, bottom_colour vt_line;"
        body[(i, "t")] = xlwt.easyxf(base + " align: horiz left")
        body[(i, "n")] = xlwt.easyxf(base + " align: horiz right", num_format_str="#,##0.00")
        body[(i, "i")] = xlwt.easyxf(base + " align: horiz right", num_format_str="0")
    ws = wb.add_sheet(sheet_name(name))
    ncol = max(len(headers), 1)
    ws.row(0).height_mismatch = True
    ws.row(0).height = 440
    ws.row(1).height_mismatch = True
    ws.row(1).height = 340
    ws.row(2).height_mismatch = True
    ws.row(2).height = 380
    for j in range(ncol):  # the two bands span the whole width
        ws.write(0, j, company if j == 0 else "", st_company)
        ws.write(1, j, f"Listing of {title}" if j == 0 else "", st_title)
    for j, h in enumerate(headers):
        ws.write(2, j, h, st_head)
    widths = [min(max(len(str(h)) + 3, 8), 60) for h in headers]
    for i, r in enumerate(rows):
        shade = i % 2
        for j in range(len(headers)):
            v = _cell(r[j] if j < len(r) else "")
            if isinstance(v, (int, float)):
                kind = "i" if isinstance(v, int) or float(v).is_integer() else "n"
                ws.write(3 + i, j, v, body[(shade, kind)])
                widths[j] = max(widths[j], min(len(f"{v:,.2f}") + 2, 60))
            else:
                ws.write(3 + i, j, v, body[(shade, "t")])
                widths[j] = max(widths[j], min(len(v) + 2, 60))
    for j, w in enumerate(widths):
        ws.col(j).width = int(256 * w)
    ws.set_panes_frozen(True)
    ws.set_horz_split_pos(3)  # rows 1-3 stay on top
    ws.set_vert_split_pos(min(2, ncol))  # first two columns stay on the left
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
