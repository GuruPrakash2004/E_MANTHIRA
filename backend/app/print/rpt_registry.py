"""
Print-option registry — maps each document's `UtlOption` rows to the actual
`.rpt` file sitting in the legacy Rpts share (RPT_PATH), and exposes them so
the frontend can let the user pick which option (and, transitively, which
printer/size) to use — exactly like the legacy `frmUtlReportViewer`'s
option list, but driven from a plain folder scan instead of hard-coding
filenames anywhere in code.

The app NEVER renders a .rpt itself (they are encrypted Crystal Reports
binaries — see doc 09 finding N10). Rendering always goes through the
print bridge (see print/rpt_bridge.py and tools/rptbridge/README.md) — this is the ONLY supported print engine
(CLAUDE.md rule set by the user: "use the crystal service method only").
"""
from __future__ import annotations

import threading
import time
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
    settings = get_settings()
    return Path(settings.rpt_folder or settings.rpt_path).expanduser()


_SCAN_TTL = 10.0  # seconds; the Rpts folder is often a network share, and a listing per print was a visible delay
_scan: dict = {"at": 0.0, "dir": None, "files": {}}
_scan_lock = threading.Lock()


def scan_rpt_files(force: bool = False) -> dict[str, str]:
    """
    Scan RPT_PATH: {lowercased filename -> actual path}. Cached for a few seconds, so a .rpt file pasted into
    RPT_PATH while the server is running is still picked up almost at once (and immediately when a lookup misses,
    see find_rpt), without listing the folder on every print.
    """
    d = _rpt_dir()
    with _scan_lock:
        if not force and _scan["dir"] == d and time.monotonic() - _scan["at"] < _SCAN_TTL:
            return _scan["files"]
        files = {p.name.lower(): str(p) for p in d.glob("*.rpt")} if d.exists() else {}
        _scan.update(at=time.monotonic(), dir=d, files=files)
        return files


def normalize_rpt_name(raw: str | None) -> str:
    """The file name a print option points at, as the legacy viewer builds it: trimmed at the ends only, `.rpt` added
    when the name has no extension (an inner space, as in `fmtGrpSeva_A4 .rpt`, is part of the name)."""
    name = (raw or "").strip()
    return name if not name or name.lower().endswith(".rpt") else name + ".rpt"


def find_rpt(raw: str | None) -> str | None:
    """Path of the EXACT file the option names (case-insensitive, as on Windows) - never a similar name, never a prefix."""
    name = normalize_rpt_name(raw)
    if not name:
        return None
    return scan_rpt_files().get(name.lower()) or scan_rpt_files(force=True).get(name.lower())


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
                rpt_available=bool(rpt_name) and normalize_rpt_name(rpt_name).lower() in available,
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
    return find_rpt(option.rpt_file)
