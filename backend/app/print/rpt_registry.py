"""
Print-option registry — maps each document's `UtlOption` rows to the actual
`.rpt` file sitting in the legacy Rpts share (RPT_PATH), and exposes them so
the frontend can let the user pick which option (and, transitively, which
printer/size) to use — exactly like the legacy `frmUtlReportViewer`'s
option list, but driven from a plain folder scan instead of hard-coding
filenames anywhere in code.

The app NEVER renders a .rpt itself (they are encrypted Crystal Reports
binaries — see doc 09 finding N10). Rendering always goes through the
external Crystal print service (see print/crystal_client.py and
backend/print_service/README.md) — this is the ONLY supported print engine
(CLAUDE.md rule set by the user: "use the crystal service method only").
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings


@dataclass
class PrintOption:
    doc_id: int
    option_order: int
    option_name: str
    rpt_file: str
    rpt_available: bool
    selection_formula: str
    default_print: bool
    direct_printer_name: str | None
    copies: float
    after_save_action: str  # P print | PP preview | DNP do not print


def _rpt_dir() -> Path:
    return Path(get_settings().rpt_path).expanduser()


def scan_rpt_files() -> dict[str, str]:
    """
    Scan RPT_PATH: {lowercased filename -> actual path}. Re-scanned on every
    call (not cached) — a local directory listing of ~30 files is cheap, and
    this way a .rpt file pasted into RPT_PATH while the server is running is
    picked up on the very next request, no restart needed.
    """
    d = _rpt_dir()
    if not d.exists():
        return {}
    return {p.name.lower(): str(p) for p in d.glob("*.rpt")}


def list_options(conn: Connection, doc_id: int) -> list[PrintOption]:
    rows = conn.execute(
        text(
            """
            SELECT DocID, OptionOrder, OptionName, CrptFileName, SelFormula,
                   DefaultPrint, DirectPrinterName, NoOfCopies, AfterSaveAction
            FROM UtlOption
            WHERE DocID = :doc_id AND (InActive IS NULL OR InActive <> 'Y')
            ORDER BY OptionOrder
            """
        ),
        {"doc_id": doc_id},
    ).mappings().all()

    available = scan_rpt_files()
    result: list[PrintOption] = []
    for r in rows:
        rpt_name = (r["CrptFileName"] or "").strip()
        result.append(
            PrintOption(
                doc_id=r["DocID"],
                option_order=r["OptionOrder"],
                option_name=r["OptionName"],
                rpt_file=rpt_name,
                rpt_available=rpt_name.lower() in available,
                selection_formula=r["SelFormula"] or "",
                default_print=(r["DefaultPrint"] or "N").strip().upper() == "Y",
                direct_printer_name=(r["DirectPrinterName"] or "").strip() or None,
                copies=float(r["NoOfCopies"] or 1),
                after_save_action=(r["AfterSaveAction"] or "").strip(),
            )
        )
    return result


def get_option(conn: Connection, doc_id: int, option_name: str) -> PrintOption:
    for opt in list_options(conn, doc_id):
        if opt.option_name == option_name:
            return opt
    from fastapi import HTTPException, status

    raise HTTPException(status.HTTP_404_NOT_FOUND, f"Print option '{option_name}' not found for doc {doc_id}")


def resolve_rpt_path(option: PrintOption) -> str | None:
    files = scan_rpt_files()
    return files.get(option.rpt_file.lower())
