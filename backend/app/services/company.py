"""
Company Master — port of `FrmMstComp` (DocID 17, doc 07 §5.9). Unlike every
other master, `MstComp` is a single-row table (this client has exactly one
company/trust) — not a Code/Name list, so it doesn't fit the generic
frmMstGeneral pattern (`UtlTransactions.DocShForm` is NULL for DocID 17,
confirmed live). Tabs per the legacy screen: Company Info, Financial
Year(s). `JpgFile` (the logo) is a binary column — never serialized through
the generic JSON API (see masters.py's `_json_safe`); handled separately if
ever needed.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

_COMPANY_COLUMNS = [
    "CompName", "Address1", "Address2", "Address3", "Address4", "Address5",
    "Custcode", "EMAIL", "MOBNO", "PANNO", "WEB", "GSTNO", "CompLoc", "CINNO", "TELNO", "DashBoardLink",
]


# "Company Info" tab: plain MstComp columns with no UtlDocDsgrFlds rows (the "Additional Fields" tab is the DocID 17
# designer metadata). Served to the web UI so captions/order/mandatory are not hard-coded in the frontend.
COMPANY_INFO_FIELDS = [
    {"code": "CompName", "caption": "Company Name", "required": True},
    {"code": "Address1", "caption": "Address", "required": False},
    {"code": "Address2", "caption": "", "required": False},
    {"code": "Address3", "caption": "", "required": False},
    {"code": "Address4", "caption": "", "required": False},
    {"code": "Address5", "caption": "", "required": False},
    {"code": "EMAIL", "caption": "Email ID", "required": False},
]


def get_layout() -> dict:
    return {"doc_id": 17, "info_fields": COMPANY_INFO_FIELDS}


def get_company(conn: Connection) -> dict:
    row = conn.execute(
        text(f"SELECT CompID, {', '.join(_COMPANY_COLUMNS)} FROM MstComp WHERE CompID = 1")
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not configured")
    return dict(row)


def update_company(conn: Connection, *, values: dict) -> dict:
    clean = {k: v for k, v in values.items() if k in _COMPANY_COLUMNS}
    if clean:
        set_clause = ", ".join(f"{k} = :{k}" for k in clean)
        conn.execute(text(f"UPDATE MstComp SET {set_clause} WHERE CompID = 1"), clean)
    return get_company(conn)


def list_financial_years(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT yrFdate, yrTdate, Active FROM MstCompFinYear ORDER BY yrFdate")).mappings().all()
    return [dict(r) for r in rows]


def add_financial_year(conn: Connection, *, from_date: date, to_date: date) -> None:
    exists = conn.execute(text("SELECT 1 FROM MstCompFinYear WHERE yrFdate = :f"), {"f": from_date}).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "A financial year starting on this date already exists")
    conn.execute(
        text("INSERT INTO MstCompFinYear (yrFdate, yrTdate, Active) VALUES (:f, :t, 'N')"),
        {"f": from_date, "t": to_date},
    )
    from app.core import fy as fy_module

    fy_module.invalidate()


def set_active_financial_year(conn: Connection, *, from_date: date) -> None:
    """Only one FY can be Active at a time — same single-select-active convention the legacy app's list uses."""
    row = conn.execute(text("SELECT 1 FROM MstCompFinYear WHERE yrFdate = :f"), {"f": from_date}).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Financial year not found")
    conn.execute(text("UPDATE MstCompFinYear SET Active = 'N'"))
    conn.execute(text("UPDATE MstCompFinYear SET Active = 'Y' WHERE yrFdate = :f"), {"f": from_date})
    from app.core import fy as fy_module

    fy_module.invalidate()


def remove_financial_year(conn: Connection, *, from_date: date) -> None:
    """The active year can never be removed (it filters every list and document number)."""
    row = conn.execute(text("SELECT Active FROM MstCompFinYear WHERE yrFdate = :f"), {"f": from_date}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Financial year not found")
    if (row["Active"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "The active financial year cannot be removed")
    conn.execute(text("DELETE FROM MstCompFinYear WHERE yrFdate = :f"), {"f": from_date})
    from app.core import fy as fy_module

    fy_module.invalidate()


def get_company_image(conn: Connection) -> bytes | None:
    row = conn.execute(text("SELECT JpgFile FROM MstComp WHERE CompID = 1")).first()
    return bytes(row[0]) if row and row[0] else None


def set_company_image(conn: Connection, *, content: bytes) -> None:
    conn.execute(text("UPDATE MstComp SET JpgFile = :img WHERE CompID = 1"), {"img": content})
