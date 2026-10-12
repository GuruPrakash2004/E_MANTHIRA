"""
Print Options admin screen — lets staff edit UtlOption rows (which printer a
format sends to, what happens after save, the shared default) without a
developer touching the DB directly. Same auth pattern as the other admin
tabs (GlobalSettingsTab/CompanyMasterTab): authenticated, admin-only is a
frontend convention, not a backend role gate — see app/api/v1/settings.py.

UtlOption has no identity column — rows are keyed by (DocID, OptionName), so
updates go through a plain parameterised UPDATE rather than the generic
masters update_row() helper (which assumes a single PK column).
"""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/print-options", tags=["print-options"])


@router.get("")
def list_all_print_options(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Every UtlOption row, joined to the menu caption for readability, grouped by document."""
    rows = conn.execute(
        text(
            """
            SELECT o.DocID, m.MenuItemCaption, o.OptionOrder, o.OptionName, o.CrptFileName,
                   o.DirectPrinterName, o.AfterSaveAction, o.DefaultPrint, o.NoOfCopies, o.InActive
            FROM UtlOption o
            LEFT JOIN MstMenu m ON m.DocID = o.DocID
            ORDER BY m.MenuItemCaption, o.DocID, o.OptionOrder
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


class PrintOptionUpdate(BaseModel):
    direct_printer_name: str | None = None
    after_save_action: str | None = None  # P | PP | DNP
    default_print: str | None = None  # Y | N
    no_of_copies: float | None = None
    in_active: str | None = None  # Y | N


@router.put("/{doc_id}/{option_name}")
def update_print_option(doc_id: int, option_name: str, body: PrintOptionUpdate, _: CurrentUser = Depends(get_current_user)):
    updates = {}
    if body.direct_printer_name is not None:
        updates["DirectPrinterName"] = body.direct_printer_name
    if body.after_save_action is not None:
        updates["AfterSaveAction"] = body.after_save_action
    if body.default_print is not None:
        updates["DefaultPrint"] = body.default_print
    if body.no_of_copies is not None:
        updates["NoOfCopies"] = body.no_of_copies
    if body.in_active is not None:
        updates["InActive"] = body.in_active
    if not updates:
        return {"message": "Nothing to update"}

    set_clause = ", ".join(f"{col} = :{col}" for col in updates)
    with with_transaction() as conn:
        result = conn.execute(
            text(f"UPDATE UtlOption SET {set_clause} WHERE DocID = :doc_id AND OptionName = :option_name"),
            {**updates, "doc_id": doc_id, "option_name": option_name},
        )
        if result.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Print option not found")
    return {"message": "Saved"}
