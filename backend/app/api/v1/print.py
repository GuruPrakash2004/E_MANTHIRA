"""
Printing endpoints — folder-mapped selection files, Crystal-service-only
rendering (per the user's directive: "map the selection files ... use the
crystal service method only"; the .rpt files themselves are owned and
maintained by the temple's team in Crystal Reports Designer — this app only
finds them and hands off the selection to the real print service).
"""
from __future__ import annotations

import base64
import io
import zipfile
from datetime import date

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user
from app.print import page_fit, pdf_generator, print_agent, print_prefs, rpt_bridge, rpt_print, voucher_print
from app.print.rpt_registry import get_option, list_options

router = APIRouter(prefix="/print", tags=["print"])


def _job(conn: Connection, doc_id: int, doc_id_value: int | None, *, doc_no: str | None = None, option_name: str | None = None, ctrl_click: bool = False, copies: int | None = None) -> rpt_print.PrintJob:
    return rpt_print.build_job(conn, doc_id, doc_id_value, doc_no=doc_no, option_name=option_name, ctrl_click=ctrl_click, copies=copies)


def _render_fitted(job: rpt_print.PrintJob) -> tuple[bytes, page_fit.Page]:
    """The .rpt's PDF at the report's own page size (roll formats cut at the end of the receipt, see page_fit.py)."""
    r = rpt_bridge.render(job)
    return page_fit.fit_pdf(r.pdf, paper_kind=r.paper_kind, bottom_margin_pt=r.bottom_margin_pt)


def _render(conn: Connection, job: rpt_print.PrintJob) -> bytes:
    return _render_fitted(job)[0]


@router.get("/options")
def print_options_for_document(doc_id: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    """
    The formats a document can print in (the legacy Print dropdown). `available` = the .rpt exists in the RPT folder;
    `selected` marks the one to pre-select: this user's own last choice beats the designer default (`UtlOption.DefaultPrint`).
    `after_save_action`: PP = print straight after save, P = ask first, anything else = don't print.
    """
    preferred = print_prefs.get_preferred_option(conn, user.user_code, doc_id)
    options = list_options(conn, doc_id)
    default_name = next((o.option_name for o in options if o.default_print), options[0].option_name if options else None)
    selected = preferred if any(o.option_name == preferred for o in options) else default_name
    return [
        {
            "option_name": o.option_name,
            "rpt_file": o.rpt_file,
            "available": o.rpt_available,
            "default": o.default_print,
            "preferred": o.option_name == preferred,
            "selected": o.option_name == selected,
            "printer_name": o.direct_printer_name,
            "copies": o.copies,
            "after_save_action": o.after_save_action,
        }
        for o in options
    ]


class PrintRequest(BaseModel):
    doc_id: int
    doc_id_value: int | None = None  # the record id; or give doc_no
    doc_no: str | None = None
    option_name: str | None = None  # blank = the document's first format, like the desktop
    ctrl_click: bool = False


class DirectPrintRequest(PrintRequest):
    printer_name: str | None = None  # blank = the option's own DirectPrinterName
    copies: int | None = None


class PreferenceRequest(BaseModel):
    doc_id: int
    option_name: str


@router.post("/render")
def render_pdf(body: PrintRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The document as a PDF (rendered by the bridge from the original .rpt)."""
    with voucher_print.print_lock_for(conn, body.doc_id):  # vouchers print from scratch tables refilled per print
        job = _job(conn, body.doc_id, body.doc_id_value, doc_no=body.doc_no, option_name=body.option_name, ctrl_click=body.ctrl_click)
        pdf, page = _render_fitted(job)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{body.doc_id}-{job.doc_id_value}.pdf"',
            "X-Print-Format": job.option_name,
            "X-Page-Width-Pt": str(page.width_pt),
            "X-Page-Height-Pt": str(page.height_pt),
            "Access-Control-Expose-Headers": "X-Print-Format, X-Page-Width-Pt, X-Page-Height-Pt",
        },
    )


@router.post("/preview")
def render_preview(body: PrintRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """
    What the print dialog shows: the report's pages as PNG images at their real shape (no PDF-viewer chrome, so nothing is
    stretched or framed), plus the same PDF (base64) for the browser's Print. One render of the original .rpt.
    """
    with voucher_print.print_lock_for(conn, body.doc_id):
        job = _job(conn, body.doc_id, body.doc_id_value, doc_no=body.doc_no, option_name=body.option_name, ctrl_click=body.ctrl_click)
        pdf, _page = _render_fitted(job)
    return {"format": job.option_name, "pdf": base64.b64encode(pdf).decode("ascii"), "pages": print_agent.pdf_to_pages(pdf)}


@router.put("/preference")
def save_preference(body: PreferenceRequest, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    """Remember this user's last format for the document; it beats the designer default next time."""
    get_option(conn, body.doc_id, body.option_name)  # 404 if unknown
    print_prefs.set_preferred_option(conn, user.user_code, body.doc_id, body.option_name)
    conn.commit()
    return {"message": "Saved"}


@router.post("/print")
def print_to_server_printer(body: DirectPrintRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Direct print on the print service's PC (legacy operation "D"): no dialog. Counter-PC printers go via the Print Agent."""
    with voucher_print.print_lock_for(conn, body.doc_id):
        job = _job(conn, body.doc_id, body.doc_id_value, doc_no=body.doc_no, option_name=body.option_name, ctrl_click=body.ctrl_click, copies=body.copies)
        if body.printer_name and body.printer_name.strip():
            job.printer_name = body.printer_name.strip()
        rpt_bridge.print_to_printer(job)
    return {"message": "Sent to printer", "printer_name": job.printer_name, "copies": job.copies}


@router.get("/bridge/health")
def bridge_health(_: CurrentUser = Depends(get_current_user)):
    return rpt_bridge.health()


@router.get("/bulk/documents")
def bulk_documents(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """PDF Generator: documents that have print types, from UtlOption."""
    return pdf_generator.printable_documents(conn)


@router.get("/bulk/{doc_id}/parties")
def bulk_parties(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return pdf_generator.parties(conn, doc_id)


@router.get("/bulk/{doc_id}/records")
def bulk_records(doc_id: int, from_date: date, to_date: date, party_ids: str | None = None, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    ids = [int(x) for x in party_ids.split(",") if x.strip().isdigit()] if party_ids else None
    return pdf_generator.load_records(conn, doc_id=doc_id, from_date=from_date, to_date=to_date, party_ids=ids)


class BulkSelectedRequest(BaseModel):
    record_ids: list[int]


@router.post("/bulk/{doc_id}/{option_name}/download")
def bulk_download_selected(doc_id: int, option_name: str, body: BulkSelectedRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Download button of the legacy form: one PDF per ticked record, zipped."""
    if not body.record_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No data present!!")
    if len(body.record_ids) > pdf_generator.MAX_RECORDS:
        raise HTTPException(413, f"Select at most {pdf_generator.MAX_RECORDS} records per download")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for record_id in body.record_ids:
            with voucher_print.print_lock_for(conn, doc_id):
                zf.writestr(f"{doc_id}-{record_id}.pdf", _render(conn, _job(conn, doc_id, record_id, option_name=option_name)))
    return Response(content=buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{option_name}.zip"'})


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


@router.get("/{doc_id}/{option_name}/{record_id}/preview")
def preview(doc_id: int, option_name: str, record_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    with voucher_print.print_lock_for(conn, doc_id):
        pdf = _render(conn, _job(conn, doc_id, record_id, option_name=option_name))
    return Response(content=pdf, media_type="application/pdf")


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
    with voucher_print.print_lock_for(conn, doc_id):
        job = _job(conn, doc_id, record_id, option_name=option_name)
        pdf_bytes = _render(conn, job)
    return {
        "pages": print_agent.pdf_to_pages(pdf_bytes),
        "copies": job.copies,
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
    record_ids = pdf_generator.candidate_record_ids(conn, doc_id=doc_id, from_date=from_date, to_date=to_date)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for record_id in record_ids:
            with voucher_print.print_lock_for(conn, doc_id):
                zf.writestr(f"{doc_id}-{record_id}.pdf", _render(conn, _job(conn, doc_id, record_id, option_name=option_name)))

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{option_name}_{from_date}_to_{to_date}.zip"'},
    )


@router.post("/{doc_id}/{option_name}/{record_id}/print-direct")
def print_direct(doc_id: int, option_name: str, record_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Silent print straight to the option's configured printer (no browser dialog) — for the thermal counter."""
    with voucher_print.print_lock_for(conn, doc_id):
        job = _job(conn, doc_id, record_id, option_name=option_name)
        rpt_bridge.print_to_printer(job)
    return {"message": "Sent to printer"}
