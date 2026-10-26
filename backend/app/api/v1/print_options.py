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

import os
import subprocess
import time

from pydantic import BaseModel
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/print-options", tags=["print-options"])


_printers_cache: tuple[float, dict] | None = None


@router.get("/printers")
def list_server_printers(refresh: bool = False, _: CurrentUser = Depends(get_current_user)):
    """Printers installed on the machine running this server (where the Crystal bridge prints),
    for the Direct Printer picker. Cached for 30s; empty list when it can't be read."""
    global _printers_cache
    now = time.time()
    if not refresh and _printers_cache and now - _printers_cache[0] < 30:
        return _printers_cache[1]
    result: dict = {"printers": [], "default": None}
    if os.name == "nt":
        script = (
            "Get-CimInstance Win32_Printer | ForEach-Object { ($_.Name + '|' + $_.Default) }"
        )
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                capture_output=True, text=True, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            ).stdout
            for line in out.splitlines():
                name, _sep, is_default = line.strip().rpartition("|")
                if not name:
                    continue
                result["printers"].append(name)
                if is_default.strip().lower() == "true":
                    result["default"] = name
            result["printers"].sort(key=str.lower)
        except Exception:  # noqa: BLE001 - listing is a convenience; the field stays free-text capable
            pass
    _printers_cache = (now, result)
    return result


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


# ---------------------------------------------------------------- report fonts (legacy Kannada / Telugu / ... fonts)
#
# Old reports draw regional-language text in non-Unicode fonts such as "BRH Kannada". A machine without the font prints
# Latin gibberish. The print bridge installs every font file in <RPT folder>\Fonts for its Windows user when it starts;
# these endpoints show which fonts a format needs, which are missing, and let ADMIN add the font file.

FONT_EXTS = (".ttf", ".otf", ".ttc")
MAX_FONT_BYTES = 25 * 1024 * 1024


def _fonts_dir():
    from app.print.rpt_registry import _rpt_dir

    return _rpt_dir() / "Fonts"


@router.get("/fonts")
def fonts_for_format(doc_id: int, option_name: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Fonts the print format (the option's .rpt) uses, and which of them this machine lacks."""
    from app.print import rpt_bridge
    from app.print.rpt_registry import find_rpt, normalize_rpt_name

    sql = "SELECT CrptFileName FROM UtlOption WHERE DocID = :d"
    args: dict = {"d": doc_id}
    if option_name:
        sql += " AND OptionName = :o"
        args["o"] = option_name
    sql += " ORDER BY OptionOrder"
    row = conn.execute(text(sql), args).first()
    found = find_rpt(row[0]) if row else None
    if not found:
        return {"fonts": [], "missing": [], "report": normalize_rpt_name(row[0]) if row else ""}
    try:
        data = rpt_bridge.fonts_of(str(found))
    except HTTPException:
        return {"fonts": [], "missing": [], "report": normalize_rpt_name(row[0]), "error": "print service not reachable"}
    fonts = data.get("fonts", [])
    return {"fonts": fonts, "missing": [f["font"] for f in fonts if not f.get("installed")], "report": normalize_rpt_name(row[0])}


@router.get("/font-files")
def list_font_files(_: CurrentUser = Depends(get_current_user)):
    d = _fonts_dir()
    names = sorted(p.name for p in d.iterdir() if p.suffix.lower() in FONT_EXTS) if d.exists() else []
    return {"folder": str(d), "files": names}


@router.post("/font-files")
async def upload_font_file(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    """ADMIN adds a font file (.ttf / .otf / .ttc); the print service restarts so it installs it for its user."""
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can add report fonts")
    name = os.path.basename(file.filename or "")
    if not name.lower().endswith(FONT_EXTS) or name.startswith("."):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .ttf, .otf or .ttc font files are accepted")
    data = await file.read(MAX_FONT_BYTES + 1)
    if len(data) > MAX_FONT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Font file is larger than 25 MB")
    magic = data[:4]
    if magic not in (b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file is not a valid font")
    d = _fonts_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / (name + ".upload")
    tmp.write_bytes(data)
    os.replace(tmp, d / name)  # atomic: a half-written font is never picked up
    from app.print import rpt_bridge_manager

    rpt_bridge_manager.restart()  # on start the bridge installs every font in the folder for its user
    return {"saved": name, **list_font_files(user)}
