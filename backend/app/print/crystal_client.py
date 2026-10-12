"""
HTTP client for the external Crystal Reports print service. This is the
ONLY print engine this app supports — there is no built-in renderer, and it
never renders a .rpt file itself. The temple's own team maintains the .rpt
files with their Crystal Reports Designer on Windows; this app's only job
is to find them (rpt_registry.py), let the user pick one, and hand off the
selection formula to whatever real Crystal print service is configured at
CRYSTAL_SERVICE_URL — that service owns the DB connection, the report
rendering, and the printer drivers.

Two modes, mirroring the legacy `UtlOption.ClickOperation` / `AfterSaveAction`:
  - preview : returns a PDF the browser can show and print via window.print()
              (or a local print agent like QZ Tray for silent printing)
  - direct  : asks the service to send the job straight to a named printer
              (`UtlOption.DirectPrinterName`), exactly like the old app's
              `PrintToPrinter(...)` — no browser dialog, for thermal counters
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings


def _base_url() -> str:
    url = get_settings().crystal_service_url
    if not url:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No Crystal print service configured (CRYSTAL_SERVICE_URL). "
            "Point it at your team's Crystal Reports print service to enable printing.",
        )
    return url.rstrip("/")


def _unreachable(exc: httpx.HTTPError) -> HTTPException:
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        f"Could not reach the Crystal print service at {get_settings().crystal_service_url}: {exc}",
    )


def render_preview(
    *,
    rpt_path: str,
    selection_formula: str,
    formula_values: dict[str, str],
    record_id: str | int,
    record_data: dict | None = None,
) -> bytes:
    """Ask the Crystal service to render a PDF for preview/browser printing."""
    settings = get_settings()
    try:
        resp = httpx.post(
            f"{_base_url()}/render",
            json={
                "rpt_path": rpt_path,
                "selection_formula": selection_formula,
                "formula_values": formula_values,
                "record_data": record_data or {},
                "record_id": str(record_id),
                "format": "pdf",
            },
            timeout=settings.crystal_service_timeout_seconds,
        )
        resp.raise_for_status()
        return resp.content
    except httpx.HTTPError as exc:
        raise _unreachable(exc) from exc


def print_direct(
    *,
    rpt_path: str,
    selection_formula: str,
    formula_values: dict[str, str],
    record_id: str | int,
    printer_name: str,
    copies: float = 1,
    record_data: dict | None = None,
) -> None:
    """Ask the Crystal service to send the job straight to `printer_name` (no browser dialog)."""
    settings = get_settings()
    try:
        resp = httpx.post(
            f"{_base_url()}/print",
            json={
                "rpt_path": rpt_path,
                "selection_formula": selection_formula,
                "formula_values": formula_values,
                "record_data": record_data or {},
                "record_id": str(record_id),
                "printer_name": printer_name,
                "copies": copies,
            },
            timeout=settings.crystal_service_timeout_seconds,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise _unreachable(exc) from exc
