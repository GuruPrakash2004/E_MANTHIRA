"""
Import from Excel — port of the legacy `frmUtlImportXL` ("Import Data from
Excel..."): generate a template for a document's real columns, let staff
fill it in Excel, upload it back, and bulk-create rows — skipping/flagging
anything that fails validation rather than aborting the whole file (same
spirit as the legacy screen's "records displayed in red are erroneous,
import is blocked until fixed / removed").

**Scope**: masters only (DocShForm-driven `MstXxx` tables via
`app/services/masters.py`'s generic `create()` — same code path
`MasterPage.jsx`'s "Add" button calls, so every validation rule there
applies identically here). Transactional documents (Seva, Donation, Hall
Booking, ...) are deliberately NOT importable this way: each has its own
save pipeline with side effects a naive per-row import would have to
reimplement exactly to stay correct (auto receipt + GL posting, overlap
checks, document numbering) — CLAUDE.md rule 2's "write exactly what the
old app writes" is safer served by those documents' own dedicated screens.
"""
from __future__ import annotations

import io

from fastapi import HTTPException, status
from openpyxl import Workbook, load_workbook
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services import masters as masters_service


def _import_columns(conn: Connection, meta: masters_service.MasterMeta) -> list[tuple[str, str]]:
    """`[(column_name, caption), ...]` — the master's own Code/Name columns
    first, then any designer-added extra fields (UtlDocDsgrFlds), same
    column set `MasterPage.jsx`'s "extra designer fields" section edits."""
    cols = [(meta.code_col, f"{meta.short_form} Code"), (meta.name_col, f"{meta.short_form} Name")]
    extra = conn.execute(
        text(
            "SELECT FldCode, FldCaption FROM UtlDocDsgrFlds "
            "WHERE DocID = :d AND FLdBlnHide <> 'Y' AND FldCode NOT IN (:code_col, :name_col) "
            "ORDER BY FldSection, FldOrderBy"
        ),
        {"d": meta.doc_id, "code_col": meta.code_col, "name_col": meta.name_col},
    ).mappings().all()
    for row in extra:
        cols.append((row["FldCode"], row["FldCaption"] or row["FldCode"]))
    return cols


def build_template(conn: Connection, doc_id: int) -> bytes:
    meta = masters_service.get_meta(conn, doc_id)
    columns = _import_columns(conn, meta)

    wb = Workbook()
    ws = wb.active
    ws.title = "DataSheet"  # matches the legacy convention (frmUtlImportXL requires this exact sheet name)
    ws.append([caption for _, caption in columns])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def parse_rows(conn: Connection, doc_id: int, file_bytes: bytes) -> list[tuple[int, dict]]:
    """`[(excel_row_number, {column: value}), ...]`, blank trailing rows
    skipped. Pure parsing, no DB writes — see `import_rows` for why."""
    meta = masters_service.get_meta(conn, doc_id)
    columns = _import_columns(conn, meta)
    col_names = [c for c, _ in columns]

    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not read the Excel file: {exc}") from exc

    sheet_name = "DataSheet" if "DataSheet" in wb.sheetnames else wb.sheetnames[0]
    ws = wb[sheet_name]

    parsed = []
    for excel_row_num, raw_row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if raw_row is None or all(v is None or str(v).strip() == "" for v in raw_row):
            continue  # skip blank trailing rows
        values = {col: ("" if v is None else str(v).strip()) for col, v in zip(col_names, raw_row)}
        parsed.append((excel_row_num, values))
    return parsed


def import_rows(doc_id: int, file_bytes: bytes, user_code: str) -> dict:
    """
    One `with_transaction()` PER ROW, not one for the whole file: SQL Server
    connections run with `SET XACT_ABORT ON` (see `app/core/db.py`), which
    means a single failed statement poisons the rest of that same
    transaction — sharing one connection across rows would make it
    impossible to skip a bad row and keep importing the rest, exactly the
    "flag erroneous rows, import what's valid" behaviour the legacy screen
    has. A tiny amount of per-row transaction overhead buys that back.
    """
    from app.core.db import with_transaction

    with with_transaction() as conn:
        rows = parse_rows(conn, doc_id, file_bytes)

    results: list[dict] = []
    created = 0
    for excel_row_num, values in rows:
        try:
            with with_transaction() as conn:
                meta = masters_service.get_meta(conn, doc_id)
                created_row = masters_service.create(conn, meta, values=values, user_code=user_code)
            created += 1
            results.append({"row": excel_row_num, "status": "ok", "id": created_row.get(meta.id_col)})
        except HTTPException as exc:
            results.append({"row": excel_row_num, "status": "error", "message": exc.detail})
        except Exception as exc:  # noqa: BLE001 — one bad row must not abort the batch
            results.append({"row": excel_row_num, "status": "error", "message": str(exc)[:200]})

    return {"created": created, "failed": len(results) - created, "rows": results}


def field_info(conn: Connection, doc_id: int) -> list[dict]:
    """The legacy info grid under the document picker: one entry per template column with its data type, whether it is
    mandatory / a foreign key / unique, its maximum length and default."""
    meta = masters_service.get_meta(conn, doc_id)
    widths = {
        r[0].lower(): r[1]
        for r in conn.execute(text("SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": meta.table})
    }
    out = [
        {"name": f"{meta.short_form} Code", "data_type": "Text", "mandatory": "Y", "foreign_key": "", "max_length": widths.get(meta.code_col.lower()), "unique": "Y", "example": "", "default": ""},
        {"name": f"{meta.short_form} Name", "data_type": "Text", "mandatory": "Y", "foreign_key": "", "max_length": widths.get(meta.name_col.lower()), "unique": "N", "example": "", "default": ""},
    ]
    rows = conn.execute(
        text(
            "SELECT FldCode, FldCaption, FldDataType, FldDataWidth, FldBlnMandatory, FldUnique, FldBlnComboData, FldCmbTblName, FldDefStdDefault "
            "FROM UtlDocDsgrFlds WHERE DocID = :d AND FLdBlnHide <> 'Y' AND FldCode NOT IN (:c, :n) ORDER BY FldSection, FldOrderBy"
        ),
        {"d": doc_id, "c": meta.code_col, "n": meta.name_col},
    ).mappings().all()
    for r in rows:
        out.append(
            {
                "name": r["FldCaption"] or r["FldCode"],
                "data_type": (r["FldDataType"] or "").strip(),
                "mandatory": "Y" if (r["FldBlnMandatory"] or "").strip().upper() == "Y" else "N",
                "foreign_key": (r["FldCmbTblName"] or "").strip() if (r["FldBlnComboData"] or "").strip().upper() == "Y" else "",
                "max_length": r["FldDataWidth"] or widths.get((r["FldCode"] or "").lower()),
                "unique": "Y" if (r["FldUnique"] or "").strip().upper() == "Y" else "N",
                "example": "",
                "default": (r["FldDefStdDefault"] or "").strip(),
            }
        )
    return out


def preview(conn: Connection, doc_id: int, file_bytes: bytes) -> dict:
    """Load from Excel: the rows the file holds (nothing is written) so they can be reviewed before importing."""
    meta = masters_service.get_meta(conn, doc_id)
    columns = _import_columns(conn, meta)
    rows = parse_rows(conn, doc_id, file_bytes)
    return {"columns": [{"key": c, "label": cap} for c, cap in columns], "total": len(rows), "rows": [{"row": n, **v} for n, v in rows[:1000]]}
