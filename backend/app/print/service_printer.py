"""
The Windows default printer of the PC that runs the print service.

Crystal Reports asks the default printer about its paper every time it opens a .rpt. When that default is an offline network
printer (for example \\\\server\\POS-80) each report waits about 45 seconds before it opens. Staff choose a reachable printer
in Print Options; it is kept in `print_service_settings.json` (git-ignored, no database table) and applied to the Windows user
running the backend each time the print service starts, so the first preview of every report is quick.
"""
from __future__ import annotations

import ctypes
import json
import logging
import os
from ctypes import wintypes
from pathlib import Path

log = logging.getLogger("print.service_printer")

_SETTINGS = Path(__file__).resolve().parent.parent.parent / "print_service_settings.json"


def configured() -> str:
    """The printer staff chose, or '' when none (then the Windows default is left alone)."""
    try:
        return str(json.loads(_SETTINGS.read_text(encoding="utf-8")).get("default_printer") or "").strip()
    except (OSError, ValueError):
        return ""


def save(name: str) -> None:
    _SETTINGS.write_text(json.dumps({"default_printer": name.strip()}, indent=2), encoding="utf-8")


def current_default() -> str:
    """The Windows default printer of this user ('' when it cannot be read)."""
    if os.name != "nt":
        return ""
    try:
        size = wintypes.DWORD(0)
        winspool = ctypes.WinDLL("winspool.drv")
        winspool.GetDefaultPrinterW(None, ctypes.byref(size))
        if not size.value:
            return ""
        buf = ctypes.create_unicode_buffer(size.value)
        if winspool.GetDefaultPrinterW(buf, ctypes.byref(size)):
            return buf.value
    except Exception:  # noqa: BLE001
        log.exception("could not read the default printer")
    return ""


def set_default(name: str) -> bool:
    if os.name != "nt" or not name:
        return False
    try:
        return bool(ctypes.WinDLL("winspool.drv").SetDefaultPrinterW(name))
    except Exception:  # noqa: BLE001
        log.exception("could not set the default printer")
        return False


def apply() -> bool:
    """Make the chosen printer the Windows default (no-op when none is chosen or it already is). True when it is the default now."""
    want = configured()
    if not want:
        return False
    if current_default().lower() == want.lower():
        return True
    ok = set_default(want)
    print(f"[print] default printer set to '{want}': {'ok' if ok else 'failed'}", flush=True)
    return ok
