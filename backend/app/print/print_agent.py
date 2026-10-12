"""
vTemple Print Agent — lets a counter PC print receipts on ITS OWN printers
(USB or network), silently, with no browser print dialog. A browser page
cannot list a PC's printers or print to them without a dialog, so a tiny
Windows program (`backend/tools/printagent/Program.cs`) listens on
`127.0.0.1:8787` of that PC and does it instead. This module:

  1. rasterises the PDF the Crystal print service returns into PNG pages
     (`pdf_to_pages`) — the shape the agent's `/print` expects (see the
     agent's own docstring for the protocol), so the browser never has to
     understand PDF, only forward pictures;
  2. builds the one-file, self-installing Setup `.cmd` for a given web
     origin (`agent_install_script`) that the *Download Print Agent for
     this PC* button serves.

The agent is completely dumb about vTemple's data — it only prints
pictures for origins listed in its `printagent.txt` allow-list. See
`backend/tools/printagent/README.md` for the full design.
"""
from __future__ import annotations

import base64
import re
import subprocess
from pathlib import Path

import fitz  # PyMuPDF

PRINTAGENT_DIR = Path(__file__).resolve().parent.parent.parent / "tools" / "printagent"
AGENT_EXE_NAME = "VTemplePrintAgent.exe"
POINTS_PER_INCH = 72.0
RASTER_DPI = 203  # a thermal receipt printer's usual resolution

_ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.\-\[\]:]+$")


def pdf_to_pages(pdf_bytes: bytes) -> list[dict]:
    """Rasterises every page of `pdf_bytes` to a PNG at RASTER_DPI and
    returns `[{"png": "<base64>", "w": <points>, "h": <points>}, ...]` —
    the exact shape the Print Agent's `/print` body expects. Page size is
    reported in points (1/72 inch) so the agent can set the printer's
    paper to the document's real size (a receipt keeps its roll width)."""
    zoom = RASTER_DPI / POINTS_PER_INCH
    matrix = fitz.Matrix(zoom, zoom)
    pages = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pages.append(
                {
                    "png": base64.b64encode(pix.tobytes("png")).decode("ascii"),
                    "w": round(page.rect.width, 2),
                    "h": round(page.rect.height, 2),
                }
            )
    return pages


def _agent_exe() -> Path | None:
    """Path to the built agent exe, building it once with the C# compiler
    that ships with Windows (no SDK, no admin rights) if it's missing and
    we're actually on Windows. Returns None if it can't be produced (e.g.
    the backend runs on Linux/macOS in dev) — the download endpoint then
    answers 503 rather than shipping a broken file."""
    exe = PRINTAGENT_DIR / "bin" / AGENT_EXE_NAME
    if exe.exists():
        return exe
    build_script = PRINTAGENT_DIR / "build.cmd"
    if not build_script.exists():
        return None
    try:
        subprocess.run(["cmd", "/c", str(build_script)], cwd=str(PRINTAGENT_DIR), timeout=60, check=True)
    except Exception:  # noqa: BLE001 — not on Windows, csc.exe missing, etc.
        return None
    return exe if exe.exists() else None


def valid_origin(origin: str) -> bool:
    return bool(_ORIGIN_RE.match(origin or ""))


_SETUP_TEMPLATE = """@echo off
REM vTemple Print Agent - one-click setup for this PC. Double-click once;
REM the agent then starts automatically every time you sign in to Windows.
setlocal
set TARGET=%LOCALAPPDATA%\\VTemplePrintAgent
echo Installing the vTemple Print Agent...
taskkill /f /im VTemplePrintAgent.exe >nul 2>nul
if not exist "%TARGET%" mkdir "%TARGET%"

set TMPB64=%TEMP%\\vtemple_agent.b64
if exist "%TMPB64%" del "%TMPB64%"
for /f "tokens=1,* delims= " %%A in ('findstr /b "::B64 " "%~f0"') do echo %%B>>"%TMPB64%"

powershell -NoProfile -Command "$b64 = (Get-Content -Raw '%TMPB64%') -replace '[\\r\\n]',''; [IO.File]::WriteAllBytes('%TARGET%\\VTemplePrintAgent.exe', [Convert]::FromBase64String($b64))"
del "%TMPB64%" >nul 2>nul

findstr /x /c:"{ORIGIN}" "%TARGET%\\printagent.txt" >nul 2>nul
if errorlevel 1 echo {ORIGIN}>>"%TARGET%\\printagent.txt"

reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v VTemplePrintAgent /t REG_SZ /d "\\"%TARGET%\\VTemplePrintAgent.exe\\"" /f >nul
start "" "%TARGET%\\VTemplePrintAgent.exe"

echo Done. Go back to vTemple in your browser — Print Settings will show this PC's printers in a few seconds.
pause
exit /b 0

:: ---- VTemplePrintAgent.exe, base64, one chunk per line below ----
"""


def agent_install_script(origin: str) -> bytes:
    """Builds the self-installing `vTemple-Print-Agent-Setup.cmd` for
    `origin` — the exe is base64-packed into `::B64 ` comment lines at the
    bottom of the script, so double-clicking it both unpacks and installs
    the agent with no separate installer, no admin rights."""
    if not valid_origin(origin):
        raise ValueError("Invalid origin")
    exe = _agent_exe()
    if exe is None:
        raise FileNotFoundError("Print Agent executable is not available on this server")

    header = _SETUP_TEMPLATE.replace("{ORIGIN}", origin)
    b64 = base64.b64encode(exe.read_bytes()).decode("ascii")
    chunk_size = 120
    lines = [f"::B64 {b64[i:i + chunk_size]}" for i in range(0, len(b64), chunk_size)]
    body = "\r\n".join(lines) + "\r\n"
    return header.replace("\n", "\r\n").encode("ascii", "replace") + body.encode("ascii")
