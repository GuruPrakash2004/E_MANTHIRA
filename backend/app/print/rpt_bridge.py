"""
Bridge client — sends a `PrintJob` (app/print/rpt_print.py) to the print service over HTTP and returns the PDF / confirms
the print. The backend never opens a .rpt; the bridge (a Windows .NET exe with the Crystal runtime) owns that. There is no
fallback renderer: no bridge, no printout. Contract: POST /render -> application/pdf, POST /print -> 200, GET /health.

Every call carries the shared key in `X-Rpt-Bridge-Key` (RPT_BRIDGE_KEY), uses a short connect timeout so a dead bridge
fails fast, and a longer read timeout because Crystal can take a while on a big report. Any failure is turned into plain
advice by `friendly_error()`; the raw text is logged, not shown to the counter staff.
"""
from __future__ import annotations

from dataclasses import dataclass

import logging
import re
import threading

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.print.rpt_print import PrintJob

log = logging.getLogger(__name__)
KEY_HEADER = "X-Rpt-Bridge-Key"

# (pattern in the raw error text, advice) — first match wins. Patterns are matched case-insensitively.
_ADVICE: list[tuple[str, str]] = [
    (r"log ?on failed|logon failed|incorrect log ?on|login failed|cannot open database|unable to connect.*database",
     "The print service could not sign in to the database. Check the database settings and that the SQL Server is reachable from the PC running the print service."),
    (r"missing parameter",
     "This format needs shop details that were not supplied. Pick another format, or ask the administrator to check the print option's parameters."),
    (r"linked parameter",
     "The report has a linked sub-report parameter that cannot be set directly. The print service has to skip it; please report this to the administrator."),
    (r"file not found|could not find file|path.*not found|report file .* not found|error opening file|file .*rpt.*not",
     "The report file for this format is missing on the print service's PC. Copy it into the Rpts folder and try again."),
    (r"invalid printer|printer .*not (found|available|installed)|no printers? (installed|found)|printer name .* not|the printer name is invalid|printer settings",
     "That printer is not available on the print service's PC. Check the printer name in the print option, or choose a different printer."),
    (r"offline|paper out|out of paper|printer.*(error|busy)",
     "The printer is not ready (offline, out of paper or busy). Fix the printer and print again."),
    (r"rpc server|rpc_|0x800706ba|0x80010108|disconnected from its clients|server threw an exception",
     "Crystal Reports stopped responding on the print service's PC (an RPC error). Try again in a moment; if it keeps happening, restart the print service."),
    (r"out of memory|insufficient memory|memory",
     "The print service ran out of memory while building this report. Try a smaller date range, or restart the print service."),
    (r"invalid tlv|crystal.*(runtime|not installed)|could not load file or assembly|crystaldecisions|bad image format|no providers|class not registered",
     "The Crystal Reports runtime on the print service's PC is missing or damaged. Install the matching Crystal runtime (32-bit) and restart the print service."),
    (r"selection formula|record selection|the remaining text does not appear to be part of the formula|error in formula",
     "The report's selection could not be applied. Pick another format, or ask the administrator to check the print option's selection formula."),
    (r"no html template|not (yet )?implemented|501",
     "This format has no approximate layout in the fallback printer. Start the real print service to print it exactly."),
]


def friendly_error(raw: object) -> str:
    """Turn a Crystal / printer / transport error into advice a counter clerk can act on."""
    text = str(raw or "").strip()
    for pattern, advice in _ADVICE:
        if re.search(pattern, text, re.IGNORECASE):
            return advice
    return "The print service could not complete this print. Try again; if it keeps failing, contact the administrator."


# URL/key of the bridge the backend launched itself (rpt_bridge_manager); they win over the settings while it runs.
_runtime: dict[str, str | None] = {"url": None, "key": None}


def set_runtime(url: str | None, key: str | None) -> None:
    _runtime["url"], _runtime["key"] = url, key


def _base_url() -> str:
    s = get_settings()
    url = (_runtime["url"] or s.rpt_bridge_url or s.crystal_service_url or "").rstrip("/")
    if not url:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No print service is configured. Set RPT_BRIDGE_URL (or start the bundled print service).",
        )
    return url


def _headers() -> dict[str, str]:
    key = _runtime["key"] or get_settings().rpt_bridge_key
    return {KEY_HEADER: key} if key else {}


def _timeout() -> httpx.Timeout:
    s = get_settings()
    return httpx.Timeout(s.rpt_bridge_render_timeout_seconds, connect=s.rpt_bridge_connect_timeout_seconds)


_client_lock = threading.Lock()
_http: httpx.Client | None = None
_slots: threading.BoundedSemaphore | None = None


def _client() -> httpx.Client:
    """One pooled client for every bridge call (keep-alive instead of a fresh connection per print)."""
    global _http
    with _client_lock:
        if _http is None:
            _http = httpx.Client(limits=httpx.Limits(max_connections=8, max_keepalive_connections=4))
        return _http


def _render_slots() -> threading.BoundedSemaphore:
    global _slots
    with _client_lock:
        if _slots is None:
            _slots = threading.BoundedSemaphore(max(1, int(get_settings().rpt_bridge_max_concurrent or 1)))
        return _slots


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        return str(body.get("detail") or body.get("message") or body)
    except Exception:  # noqa: BLE001 - body was not JSON
        return resp.text[:500]


def _raise(exc: Exception) -> HTTPException:
    """Map any transport/bridge failure to an HTTPException carrying `friendly_error()` text."""
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, httpx.ConnectError):
        log.warning("print bridge unreachable: %s", exc)
        return HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The print service is not running. Start it (or ask the administrator) and try again.",
        )
    if isinstance(exc, httpx.TimeoutException):
        log.warning("print bridge timed out: %s", exc)
        return HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT,
            "The print service took too long. The report may be large, or Crystal is busy; try again in a moment.",
        )
    if isinstance(exc, httpx.HTTPStatusError):
        resp = exc.response
        raw = _detail(resp)
        log.warning("print bridge %s: %s", resp.status_code, raw)
        if resp.status_code in (401, 403):
            return HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "The print service rejected this server's key. RPT_BRIDGE_KEY must match the print service's key.",
            )
        if resp.status_code == 404 and "not found" not in raw.lower():
            return HTTPException(status.HTTP_502_BAD_GATEWAY, "The print service is not the expected version (endpoint missing). Update it.")
        return HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED if resp.status_code == 501 else status.HTTP_502_BAD_GATEWAY,
            friendly_error(raw),
        )
    log.exception("print bridge failed")
    return HTTPException(status.HTTP_502_BAD_GATEWAY, friendly_error(exc))


def health() -> dict:
    """Bridge status for the Print settings panel: {ok, renderer, ...} or {ok: False, reason}."""
    try:
        resp = httpx.get(f"{_base_url()}/health", headers=_headers(), timeout=_timeout())
        resp.raise_for_status()
        return {"ok": True, **resp.json()}
    except HTTPException as exc:
        return {"ok": False, "reason": exc.detail}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": _raise(exc).detail}


@dataclass(frozen=True)
class Rendered:
    """The bridge's PDF plus what the .rpt itself says about its paper (Named = A4 / Letter ..., Custom = roll size)."""

    pdf: bytes
    paper_kind: str = "Named"
    paper_name: str = ""
    orientation: str = ""
    bottom_margin_pt: float = 0.0


def render(job: PrintJob) -> Rendered:
    """POST /render — the PDF exported from the original .rpt, with the paper facts from its response headers."""
    try:
        with _render_slots():
            resp = _client().post(
                f"{_base_url()}/render",
                json={**job.to_bridge_payload(), "format": "pdf"},
                headers=_headers(),
                timeout=_timeout(),
            )
        resp.raise_for_status()
        try:
            margin = float(resp.headers.get("X-Margin-Bottom-Pt", "0") or 0)
        except ValueError:
            margin = 0.0
        return Rendered(
            pdf=resp.content,
            paper_kind=resp.headers.get("X-Paper-Kind", "Named"),
            paper_name=resp.headers.get("X-Paper-Name", ""),
            orientation=resp.headers.get("X-Orientation", ""),
            bottom_margin_pt=margin,
        )
    except Exception as exc:  # noqa: BLE001
        raise _raise(exc) from exc


def print_to_printer(job: PrintJob) -> None:
    """POST /print — the bridge sends the job to `job.printer_name` (legacy operation "D"), `job.copies` copies."""
    if not job.printer_name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This print format has no printer set. Choose a printer, or ask the administrator to set one on the print option.",
        )
    try:
        with _render_slots():
            resp = _client().post(
                f"{_base_url()}/print",
                json={**job.to_bridge_payload(), "printer_name": job.printer_name, "copies": job.copies},
                headers=_headers(),
                timeout=_timeout(),
            )
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        raise _raise(exc) from exc
