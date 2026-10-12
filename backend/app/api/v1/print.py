"""
Printing endpoints — folder-mapped selection files, Crystal-service-only
rendering (per the user's directive: "map the selection files ... use the
crystal service method only"; the .rpt files themselves are owned and
maintained by the temple's team in Crystal Reports Designer — this app only
finds them and hands off the selection to the real print service).
"""
from __future__ import annotations

import io
import zipfile
from datetime import date

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user
from app.print import crystal_client, formula_values, pdf_generator, print_agent, print_prefs, record_data
from app.print.rpt_registry import get_option, list_options, resolve_rpt_path

router = APIRouter(prefix="/print", tags=["print"])


@router.get("/{doc_id}/options")
def get_print_options(
    doc_id: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)
):
    """
    The list a user picks from — mirrors the legacy Print ▾ button's
    dropdown. `preferred` is THIS user's own last choice for this document
    (see print_prefs.py) and takes priority over `default` (the shared
    UtlOption.DefaultPrint) once they've picked at least once.
    """
    preferred = print_prefs.get_preferred_option(conn, user.user_code, doc_id)
    return [
        {
            "option_name": o.option_name,
            "rpt_file": o.rpt_file,
            "available": o.rpt_available,
            "default": o.default_print,
            "preferred": o.option_name == preferred,
            "direct_printer_name": o.direct_printer_name,
            "copies": o.copies,
        }
        for o in list_options(conn, doc_id)
    ]


class SetPreferenceRequest(BaseModel):
    option_name: str


@router.put("/{doc_id}/preference")
def set_print_preference(
    doc_id: int,
    body: SetPreferenceRequest,
    conn: Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    """Remember this user's choice so it's pre-selected next time (old-app-style)."""
    get_option(conn, doc_id, body.option_name)  # raises 404 if unknown
    print_prefs.set_preferred_option(conn, user.user_code, doc_id, body.option_name)
    conn.commit()
    return {"message": "Saved"}


def _selection_formula_for(option_formula: str, record_id: int) -> str:
    # Legacy formulas look like "{TrnHdrSEVA.SEVAID}=" — we just append the id.
    return f"{option_formula}{record_id}" if option_formula else ""


@router.get("/{doc_id}/{option_name}/{record_id}/preview")
def preview(doc_id: int, option_name: str, record_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    option = get_option(conn, doc_id, option_name)
    rpt_path = resolve_rpt_path(option)
    if rpt_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Report file '{option.rpt_file}' not found under RPT_PATH")
    pdf_bytes = crystal_client.render_preview(
        rpt_path=rpt_path,
        selection_formula=_selection_formula_for(option.selection_formula, record_id),
        formula_values=formula_values.company_formula_values(conn),
        record_id=record_id,
        record_data=record_data.record_data_for(conn, doc_id, record_id),
    )
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.get("/{doc_id}/{option_name}/{record_id}/pages")
def pages_for_local_agent(
    doc_id: int, option_name: str, record_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)
):
    """
    Same render as /preview, but rasterised to PNG pages (real paper size in
    points) for the Print Agent on the counter PC — see
    app/print/print_agent.py and backend/tools/printagent/README.md. The
    browser fetches this, then POSTs the pages straight to
    http://127.0.0.1:8787/print on the PC it's running on.
    """
    option = get_option(conn, doc_id, option_name)
    rpt_path = resolve_rpt_path(option)
    if rpt_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Report file '{option.rpt_file}' not found under RPT_PATH")
    pdf_bytes = crystal_client.render_preview(
        rpt_path=rpt_path,
        selection_formula=_selection_formula_for(option.selection_formula, record_id),
        formula_values=formula_values.company_formula_values(conn),
        record_id=record_id,
        record_data=record_data.record_data_for(conn, doc_id, record_id),
    )
    return {
        "pages": print_agent.pdf_to_pages(pdf_bytes),
        "copies": option.copies or 1,
        "name": f"{doc_id}-{record_id}",
    }


@router.get("/agent")
def download_print_agent(origin: str):
    """
    *Download Print Agent for this PC* — a one-file, self-installing
    `vTemple-Print-Agent-Setup.cmd` already set to `origin` (the web
    address the user has open). No login required: this is meant to be
    reachable from the Print Settings panel before/without a DB
    connection, same spirit as the Database Settings panel.
    """
    if not print_agent.valid_origin(origin):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid origin")
    try:
        script = print_agent.agent_install_script(origin)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return Response(
        content=script,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="vTemple-Print-Agent-Setup.cmd"'},
    )


@router.get("/{doc_id}/{option_name}/bulk-pdf")
def bulk_pdf(
    doc_id: int,
    option_name: str,
    from_date: date,
    to_date: date,
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    """
    PDF Generator (bulk) — port of the legacy frmUtlBulkPDFGenerator: every
    record of `doc_id` dated between from_date/to_date, rendered through
    `option_name` and zipped for download. See app/print/pdf_generator.py.
    """
    option = get_option(conn, doc_id, option_name)
    rpt_path = resolve_rpt_path(option)
    if rpt_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Report file '{option.rpt_file}' not found under RPT_PATH")

    record_ids = pdf_generator.candidate_record_ids(conn, doc_id=doc_id, from_date=from_date, to_date=to_date)
    company_values = formula_values.company_formula_values(conn)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for record_id in record_ids:
            pdf_bytes = crystal_client.render_preview(
                rpt_path=rpt_path,
                selection_formula=_selection_formula_for(option.selection_formula, record_id),
                formula_values=company_values,
                record_id=record_id,
                record_data=record_data.record_data_for(conn, doc_id, record_id),
            )
            zf.writestr(f"{doc_id}-{record_id}.pdf", pdf_bytes)

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{option_name}_{from_date}_to_{to_date}.zip"'},
    )


@router.post("/{doc_id}/{option_name}/{record_id}/print-direct")
def print_direct(doc_id: int, option_name: str, record_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Silent print straight to the option's configured printer (no browser dialog) — for the thermal counter."""
    option = get_option(conn, doc_id, option_name)
    rpt_path = resolve_rpt_path(option)
    if rpt_path is None or not option.direct_printer_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No direct printer configured for this option")
    crystal_client.print_direct(
        rpt_path=rpt_path,
        selection_formula=_selection_formula_for(option.selection_formula, record_id),
        formula_values=formula_values.company_formula_values(conn),
        record_id=record_id,
        printer_name=option.direct_printer_name,
        copies=option.copies,
        record_data=record_data.record_data_for(conn, doc_id, record_id),
    )
    return {"message": "Sent to printer"}
