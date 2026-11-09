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


# ---------------------------------------------------------------- subsidiary reports as print "transactions"
# The reports of the Subsidiary Reports catalog (UtlReports) are not documents, so UtlTransactions has no row for them. Their
# print options are ordinary UtlOption rows under a document id of their own: REPORT_DOC_BASE + the report's RptID (far above every
# real DocID, so nothing in the legacy app ever reads them). The report screens look their .rpt file up from these rows.
REPORT_DOC_BASE = 100000
# the .rpt file(s) each report prints from, as the legacy report forms open them (first existing file wins)
REPORT_STANDARD_RPTS: dict[int, list[tuple[str, list[str]]]] = {
    1: [("Kanike Report", ["RptKnk.rpt"])],
    3: [("Complete Day Detailed", ["RptDtlCompDayDtl.rpt"]), ("Complete Day Summary", ["RptDtlCompDaySmry.rpt"])],
    4: [("Seva Issue Report", ["RptSevaSch.rpt"])],
    5: [("Detailed Collection Report", ["RptDtlColn.rpt", "RptCollection.rpt"])],
}


def report_docs(conn: Connection) -> list[dict]:
    """The subsidiary reports as {doc_id, doc_name}: from UtlReports when this database has it."""
    from app.core import capabilities

    if not capabilities.has_table("UtlReports"):
        return []
    rows = conn.execute(text("SELECT RptID, RptName FROM UtlReports ORDER BY RptName")).all()
    return [{"doc_id": REPORT_DOC_BASE + int(r[0]), "doc_name": (r[1] or "").strip()} for r in rows]


# ---------------------------------------------------------------- legacy "Print Settings" window (FrmUtlPrintSettings)
# Declared before the generic /{doc_id}/{option_name} routes so these fixed paths are matched first.


@router.get("/transactions")
def transactions_for_print_settings(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The Transaction drop-down: every Transaction / Voucher document, by name (legacy: UtlTransactions DocType in ('Transaction','Voucher'))."""
    rows = conn.execute(
        text("SELECT DocID, DocName FROM UtlTransactions WHERE DocType IN ('Transaction', 'Voucher') ORDER BY DocName")
    ).all()
    out = [{"doc_id": int(r[0]), "doc_name": (r[1] or "").strip(), "group": "Transactions"} for r in rows]
    return out + [{**r, "group": "Subsidiary Reports"} for r in report_docs(conn)]


@router.post("/report-defaults/{doc_id}")
def create_report_default_options(doc_id: int, user: CurrentUser = Depends(get_current_user)):
    """One click for a subsidiary report: adds its standard print option(s), pointing at the .rpt file the legacy form opens
    (Complete Day gets Detailed and Summary). Only when the report has no print option yet."""
    from app.print.rpt_registry import find_rpt

    rpt_id = doc_id - REPORT_DOC_BASE
    if rpt_id not in REPORT_STANDARD_RPTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No standard print option is known for this report")
    with with_transaction() as conn:
        if conn.execute(text("SELECT 1 FROM UtlOption WHERE DocID = :d"), {"d": doc_id}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "This report already has print options")
    added = []
    for i, (name, candidates) in enumerate(REPORT_STANDARD_RPTS[rpt_id]):
        rpt = next((c for c in candidates if find_rpt(c)), candidates[0])
        create_print_option(
            PrintOptionCreate(doc_id=doc_id, option_name=name, crpt_file_name=rpt, default_print="Y" if i == 0 else "N", after_save_action="DNP", no_of_copies=1),
            user,
        )
        added.append(name)
    return {"message": f"Added {', '.join(added)}", "added": added}


class OptionOrderBody(BaseModel):
    names: list[str]  # the print option names in the new order


@router.put("/order/{doc_id}")
def alter_print_option_order(doc_id: int, body: OptionOrderBody, user: CurrentUser = Depends(get_current_user)):
    """Alter Order + Save: OptionOrder becomes the position in the list (1, 2, 3 ...), all or nothing (legacy btnSave_Click)."""
    names = [n for n in body.names if n]
    if len(set(names)) != len(names):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A print option is listed twice")
    with with_transaction() as conn:
        for i, name in enumerate(names, start=1):
            result = conn.execute(text("UPDATE UtlOption SET OptionOrder = :o WHERE DocID = :d AND OptionName = :n"), {"o": i, "d": doc_id, "n": name})
            if result.rowcount == 0:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Print option '{name}' not found")
        _audit(conn, user, "E", doc_id, "order")
    return {"message": "Saved Successfully!"}


@router.get("/prefix-defaults/{doc_id}")
def prefix_default_prints(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Prefix Default: the default print option of each document-number prefix (UtlDocNoPrefix x UtlDocPfxDefPrint)."""
    from app.core import capabilities

    if not capabilities.has_table("UtlDocPfxDefPrint"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prefix-wise default print is not available in this database")
    rows = conn.execute(
        text(
            "SELECT p.Prefix, u.PrintOptionName FROM UtlDocNoPrefix p "
            "LEFT JOIN UtlDocPfxDefPrint u ON p.DocID = u.DocID AND u.Prefix = p.Prefix "
            "WHERE p.DocID = :d AND p.Prefix <> '' ORDER BY 1"
        ),
        {"d": doc_id},
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prefix Not available...")
    return [{"prefix": (r[0] or "").strip(), "print_option_name": (r[1] or "").strip()} for r in rows]


class PrefixDefault(BaseModel):
    prefix: str
    print_option_name: str


@router.put("/prefix-defaults/{doc_id}")
def save_prefix_default_prints(doc_id: int, body: list[PrefixDefault], user: CurrentUser = Depends(get_current_user)):
    """Saves the prefix defaults the way the legacy window does: every prefix must exist for the document and every name must be one
    of its print options; then the document's rows are replaced, in one transaction."""
    from app.core import capabilities

    if not capabilities.has_table("UtlDocPfxDefPrint"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prefix-wise default print is not available in this database")
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Data Not Available...")
    with with_transaction() as conn:
        for row in body:
            prefix, name = row.prefix.strip(), row.print_option_name.strip()
            if not conn.execute(text("SELECT 1 FROM UtlDocNoPrefix WHERE DocID = :d AND Prefix = :p"), {"d": doc_id, "p": prefix}).first():
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Selected Prefix [{prefix}] not available for the document...")
            if not name:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please Select Print Name...")
            if not conn.execute(text("SELECT 1 FROM UtlOption WHERE DocID = :d AND OptionName = :n"), {"d": doc_id, "n": name}).first():
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Selected Print Option Name [{name}] not available for the document...")
        conn.execute(text("DELETE FROM UtlDocPfxDefPrint WHERE DocID = :d"), {"d": doc_id})
        for row in body:
            conn.execute(
                text("INSERT INTO UtlDocPfxDefPrint (DocID, Prefix, PrintOptionName) VALUES (:d, :p, :n)"),
                {"d": doc_id, "p": row.prefix.strip(), "n": row.print_option_name.strip()},
            )
        _audit(conn, user, "E", doc_id, "prefix-default")
    return {"message": "Updated Successfully..."}


@router.get("/service-printer")
def get_service_printer(_: CurrentUser = Depends(get_current_user)):
    """The Windows default printer of the PC running the print service, and the one chosen here (applied each time the service starts)."""
    from app.print import service_printer

    current = service_printer.current_default()
    return {"current": current, "configured": service_printer.configured(), "is_network": current.startswith("\\\\")}


class ServicePrinterBody(BaseModel):
    printer: str


@router.put("/service-printer")
def set_service_printer(body: ServicePrinterBody, user: CurrentUser = Depends(get_current_user)):
    """Makes the chosen printer the Windows default of the print service's PC and restarts the print service so every report
    opens quickly. ADMIN only; the name must be one of the printers installed on that PC."""
    from app.print import rpt_bridge_manager, service_printer

    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change the print service printer")
    name = body.printer.strip()
    installed = list_server_printers(refresh=True, _=user)["printers"]
    if name not in installed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{name}' is not installed on the print service's PC")
    service_printer.save(name)
    if not service_printer.set_default(name):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Windows would not change the default printer. Set it in Windows Settings, then press Save again.")
    rpt_bridge_manager.restart()  # reports are re-opened with the new default; the warm-up starts again by itself
    return {"message": f"'{name}' is now the print service's default printer. The print service restarted; reports open quickly again in a few minutes.", "current": name}


@router.get("")
def list_all_print_options(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Every UtlOption row, joined to the menu caption (or the subsidiary report's name) for readability, grouped by document."""
    from app.core import capabilities

    has_reports = capabilities.has_table("UtlReports")
    caption = "COALESCE(m.MenuItemCaption, rp.RptName)" if has_reports else "m.MenuItemCaption"
    report_join = f"LEFT JOIN UtlReports rp ON o.DocID = {REPORT_DOC_BASE} + rp.RptID" if has_reports else ""
    rows = conn.execute(
        text(
            f"""
            SELECT o.DocID, {caption} AS MenuItemCaption, o.OptionOrder, o.OptionName, o.CrptFileName,
                   o.DirectPrinterName, o.AfterSaveAction, o.DefaultPrint, o.NoOfCopies, o.InActive, o.SelFormula, o.FormulasFld, o.FormulasVal,
                   o.ClickOperation, o.CtrlClickOperation, o.CtrlAltClickOperation, o.blnWOAuth, o.MergePDF, o.emailMultiRptIDS,
                   o.FolderLoc, o.FldSel, o.EmailRouting, o.DoNotAttach, o.EmailSubject, o.EmailBody, o.EmailFooter, o.EmailCond,
                   o.AllowDateRange, o.AllowDocNoRange, o.TrackPrinted, o.MultiPrintQuery
            FROM UtlOption o
            LEFT JOIN MstMenu m ON m.DocID = o.DocID
            {report_join}
            ORDER BY {caption}, o.DocID, o.OptionOrder
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


class PrintOptionUpdate(BaseModel):
    crpt_file_name: str | None = None
    option_order: int | None = None
    sel_formula: str | None = None
    formulas_fld: str | None = None
    formulas_val: str | None = None
    direct_printer_name: str | None = None
    after_save_action: str | None = None  # P | PP | DNP
    default_print: str | None = None  # Y | N
    no_of_copies: float | None = None
    in_active: str | None = None  # Y | N
    # the rest of the legacy "Print Option Name" window (FrmUtlPrintOptionname)
    click_operation: str | None = None  # Print Click: E Email | P Preview | D Direct Print | M Multi Print | F PDF
    ctrl_click_operation: str | None = None  # Print Ctrl + Click (same letters, blank = none)
    ctrl_alt_click_operation: str | None = None  # Print Ctrl+Alt+Click
    wo_auth: str | None = None  # Y | N  Print Without Authorization
    merge_pdf: str | None = None  # Y | N
    email_multi_rpt_ids: str | None = None  # "Multi-Rpt for Email": other option names, comma separated
    folder_loc: str | None = None  # PDF settings
    fld_sel: str | None = None
    email_routing: str | None = None  # O Outlook | S SMTP
    do_not_attach: str | None = None  # Y | N
    email_subject: str | None = None
    email_body: str | None = None
    email_footer: str | None = None
    email_cond: str | None = None
    allow_date_range: str | None = None  # Multi Print
    allow_doc_no_range: str | None = None
    track_printed: str | None = None
    multi_print_query: str | None = None


_CLICK_LETTERS = {"E", "P", "D", "M", "F"}


def _legacy_columns(body: PrintOptionUpdate) -> dict:
    """
    The columns the legacy window writes for the click operations, exactly as its Save does: a group (email / multi print /
    PDF) is only kept when one of the three click boxes uses it, otherwise it is blanked. Only applied when the client sent
    the Print Click (an older caller that sends none leaves these columns alone).
    """
    if body.click_operation is None:
        return {}
    ops = [(v or "").strip().upper() for v in (body.click_operation, body.ctrl_click_operation, body.ctrl_alt_click_operation)]
    if any(o and o not in _CLICK_LETTERS for o in ops):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Print Click must be Email, Preview, Direct Print, Multi Print or PDF")
    if not ops[0]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Print Click")

    def yn(v):
        return "Y" if (v or "").strip().upper() == "Y" else "N"

    out: dict = {"ClickOperation": ops[0], "CtrlClickOperation": ops[1], "CtrlAltClickOperation": ops[2], "blnWOAuth": yn(body.wo_auth), "MergePDF": yn(body.merge_pdf)}
    if "F" in ops:
        if not (body.folder_loc or "").strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please select the folder to save the PDF files")
        out.update(FolderLoc=(body.folder_loc or "").strip(), FldSel=body.fld_sel or "")
    else:
        out.update(FolderLoc="", FldSel="")
    if "E" in ops:
        out.update(EmailRouting="O" if (body.email_routing or "").upper() == "O" else "S", DoNotAttach=yn(body.do_not_attach),
                   EmailSubject=body.email_subject or "", EmailBody=body.email_body or "", EmailFooter=body.email_footer or "", EmailCond=body.email_cond or "")
    else:
        out.update(EmailRouting="N", DoNotAttach="", EmailSubject="", EmailBody="", EmailFooter="", EmailCond="")
    if "M" in ops:
        out.update(AllowDateRange=yn(body.allow_date_range), AllowDocNoRange=yn(body.allow_doc_no_range), TrackPrinted=yn(body.track_printed),
                   MultiPrintQuery=(body.multi_print_query or "").strip())
    else:
        out.update(AllowDateRange="N", AllowDocNoRange="N", TrackPrinted="N", MultiPrintQuery="")
    if body.email_multi_rpt_ids is not None:
        out["emailMultiRptIDS"] = body.email_multi_rpt_ids
    return out


@router.get("/template")
def formula_template(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The Template button: the standard company formula fields (UtlParameters) to drop into a new format."""
    from app.core import capabilities

    if not capabilities.has_table("UtlParameters"):
        return []
    rows = conn.execute(text("SELECT FormulaFld, TableName, FormulaValue FROM UtlParameters")).all()
    return [{"field": (r[0] or "").strip(), "table": (r[1] or "").strip(), "value": (r[2] or "").strip()} for r in rows]


@router.put("/{doc_id}/{option_name}")
def update_print_option(doc_id: int, option_name: str, body: PrintOptionUpdate, user: CurrentUser = Depends(get_current_user)):
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
    for val, col in ((body.crpt_file_name, "CrptFileName"), (body.option_order, "OptionOrder"), (body.sel_formula, "SelFormula"),
                     (body.formulas_fld, "FormulasFld"), (body.formulas_val, "FormulasVal")):
        if val is not None:
            updates[col] = val
    updates.update(_legacy_columns(body))
    if not updates:
        return {"message": "Nothing to update"}

    set_clause = ", ".join(f"{col} = :{col}" for col in updates)
    with with_transaction() as conn:
        if body.default_print == "Y":  # one default format per screen (legacy: clear the others first)
            conn.execute(text("UPDATE UtlOption SET DefaultPrint = 'N' WHERE DocID = :d"), {"d": doc_id})
        result = conn.execute(
            text(f"UPDATE UtlOption SET {set_clause} WHERE DocID = :doc_id AND OptionName = :option_name"),
            {**updates, "doc_id": doc_id, "option_name": option_name},
        )
        if result.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Print option not found")
        _audit(conn, user, "E", doc_id, option_name)
    return {"message": "Saved"}


def _audit(conn: Connection, user: CurrentUser, action: str, doc_id: int, option_name: str) -> None:
    from app.core import audit

    audit.record(conn, entity="UtlOption", entity_id=f"{doc_id}:{option_name}", action=action, user_code=user.user_code)


@router.get("/screens")
def screens_for_new_option(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The screens a print format can be added to: every menu entry that is a document (has a DocID)."""
    rows = conn.execute(
        text("SELECT DISTINCT DocID, MenuItemCaption FROM MstMenu WHERE DocID IS NOT NULL AND DocID > 0 AND MenuItemCaption IS NOT NULL ORDER BY MenuItemCaption")
    ).all()
    out = [{"doc_id": r[0], "caption": (r[1] or "").strip()} for r in rows]
    return out + [{"doc_id": r["doc_id"], "caption": r["doc_name"]} for r in report_docs(conn)]


@router.get("/rpt-files")
def report_files(_: CurrentUser = Depends(get_current_user)):
    """The .rpt files in the reports folder, for the Report File picker."""
    from app.print.rpt_registry import scan_rpt_files

    return sorted({os.path.basename(p) for p in scan_rpt_files(force=True).values()}, key=str.lower)


class PrintOptionCreate(PrintOptionUpdate):
    doc_id: int
    option_name: str


@router.post("", status_code=status.HTTP_201_CREATED)
def create_print_option(body: PrintOptionCreate, user: CurrentUser = Depends(get_current_user)):
    name = body.option_name.strip()
    if not name or not (body.crpt_file_name or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Format name and report file are required")
    with with_transaction() as conn:
        if conn.execute(text("SELECT 1 FROM UtlOption WHERE DocID = :d AND OptionName = :o"), {"d": body.doc_id, "o": name}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "This screen already has a format with that name")
        order = body.option_order or int(conn.execute(text("SELECT ISNULL(MAX(OptionOrder), 0) + 1 FROM UtlOption WHERE DocID = :d"), {"d": body.doc_id}).scalar())
        if body.default_print == "Y":  # one default format per screen, as the legacy screen keeps it
            conn.execute(text("UPDATE UtlOption SET DefaultPrint = 'N' WHERE DocID = :d"), {"d": body.doc_id})
        extra = {"ClickOperation": "P", "CtrlClickOperation": "", "CtrlAltClickOperation": "", "blnWOAuth": "N", "MergePDF": "N", "FolderLoc": "", "FldSel": "",
                 "EmailRouting": "N", "DoNotAttach": "", "EmailSubject": "", "EmailBody": "", "EmailFooter": "", "EmailCond": "",
                 "AllowDateRange": "N", "AllowDocNoRange": "N", "TrackPrinted": "N", "MultiPrintQuery": "", "emailMultiRptIDS": ""}
        extra.update(_legacy_columns(body))
        # every column the table requires gets the value the legacy rows carry for "not used"
        conn.execute(
            text(
                "INSERT INTO UtlOption (DocID, OptionOrder, OptionName, CrptFileName, SelFormula, FormulasFld, FormulasVal, MultiRpt, "
                "NoOfCopies, DefaultPrint, DirectPrinterName, OpenInOutlook, PrintAfterSave, EmailFooter, EmailCond, SMTPID, SMTPPwd, SMTPHost, "
                "SMTPSSL, SMTPPort, AfterSaveAction, ClickOperation, CtrlClickOperation, EmailRouting, DoNotAttach, EmailSubject, EmailBody, "
                "InActive, CtrlAltClickOperation, MultiPrint, AllowDateRange, AllowDocNoRange, TrackPrinted, MultiPrintQuery, blnWOAuth, MergePDF, "
                "emailMultiRptIDS, FolderLoc, FldSel, CoPrintRptIDs, CoPrintCtrlRptIDS, CoPrintCtrlAltRptIDS) "
                "VALUES (:d, :ord, :o, :f, :sel, :ff, :fv, 'N', :cp, :def, :pr, 'N', '', :ef, :ec, '', '', '', '', '', :as, :clk, :cclk, :er, :dna, :esub, :ebody, "
                ":ina, :caclk, 'N', :adr, :adn, :trk, :mpq, :woa, :mpdf, :emr, :fl, :fs, '', '', '')"
            ),
            {
                "d": body.doc_id, "ord": order, "o": name, "f": body.crpt_file_name.strip(), "sel": body.sel_formula or "",
                "ff": body.formulas_fld or "", "fv": body.formulas_val or "", "cp": body.no_of_copies or 1,
                "def": body.default_print or "N", "pr": body.direct_printer_name or "", "as": body.after_save_action or "DNP",
                "ina": body.in_active or "N",
                "ef": extra["EmailFooter"], "ec": extra["EmailCond"], "clk": extra["ClickOperation"], "cclk": extra["CtrlClickOperation"],
                "caclk": extra["CtrlAltClickOperation"], "er": extra["EmailRouting"], "dna": extra["DoNotAttach"], "esub": extra["EmailSubject"],
                "ebody": extra["EmailBody"], "adr": extra["AllowDateRange"], "adn": extra["AllowDocNoRange"], "trk": extra["TrackPrinted"],
                "mpq": extra["MultiPrintQuery"], "woa": extra["blnWOAuth"], "mpdf": extra["MergePDF"], "emr": extra["emailMultiRptIDS"],
                "fl": extra["FolderLoc"], "fs": extra["FldSel"],
            },
        )
        _audit(conn, user, "A", body.doc_id, name)
    return {"message": "Added"}


@router.delete("/{doc_id}/{option_name}")
def delete_print_option(doc_id: int, option_name: str, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        result = conn.execute(text("DELETE FROM UtlOption WHERE DocID = :d AND OptionName = :o"), {"d": doc_id, "o": option_name})
        if result.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Print option not found")
        _audit(conn, user, "D", doc_id, option_name)
    return {"message": "Deleted"}


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
