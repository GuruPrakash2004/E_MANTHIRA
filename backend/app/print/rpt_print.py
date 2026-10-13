"""
Print JOB builder — a port of what the legacy `frmUtlReportViewer.ShowRptFileFromUtlOptions_New` assembles before it
touches Crystal: which .rpt, the record-selection formula, the parameter values and the print operation.
Findings: .claude/docs/printing/printing.md.

This module only BUILDS the job (`PrintJob`). It never opens a .rpt and never talks to Crystal; the bridge client
(step 4, `rpt_bridge.py`) sends the job to the print service, which owns the Crystal runtime.

Legacy rules reproduced here, in the same order:
  1. one `UtlOption` row: `select top 1 * ... where DocID=? [and OptionName=?] order by OptionOrder`
  2. file          = <RPT folder> + CrptFileName   (".rpt" appended when missing)
  3. selection     = Replace(Trim(SelFormula), "`", "'") + " " + <record id>     (SelFormula ends with "=")
  4. parameters    = (+ the shop details under common names, step 6; the option's own values win) FormulasFld / FormulasVal split on ";" pairwise; each FormulasVal is "Table.Column" and the value
                     is the first row of `Select Column from Table` (company data = single-row MstComp)
  5. operation     = ClickOperation, or CtrlClickOperation when Ctrl-clicked; blank means "P" (preview)
  6. copies/printer= NoOfCopies / Trim(DirectPrinterName) (a caller may override the copies, like `argNoOfPrints`)
"""
from __future__ import annotations

import re
from pathlib import Path
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import limit_clause
from app.print import shop_details, voucher_print
from app.print.rpt_registry import scan_rpt_files

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
OPERATIONS = {"P": "preview", "D": "direct print", "F": "export to folder", "E": "e-mail"}


@dataclass
class PrintJob:
    doc_id: int
    doc_id_value: int
    option_name: str
    rpt_file: str
    rpt_path: str
    selection_formula: str
    parameters: dict[str, str] = field(default_factory=dict)
    operation: str = "P"
    copies: int = 1
    printer_name: str = ""
    after_save_action: str = ""
    additional_selection_formula: str = ""
    shop: dict[str, str] = field(default_factory=dict)  # canonical shop details (step 6); the bridge also uses them to fill labels

    def _formula_values(self) -> dict[str, str]:
        own = {k.lower() for k in self.parameters}  # the bridge matches names case-insensitively, so drop shadowed shop names
        generic = {k: v for k, v in shop_details.parameter_values(self.shop).items() if k.lower() not in own}
        return {**generic, **self.parameters}

    def to_bridge_payload(self) -> dict:
        """The body the bridge's /render and /print endpoints take (the contract in print_service/README.md)."""
        return {
            "rpt_path": self.rpt_path,
            "selection_formula": self.selection_formula,
            # the print option's own values win over the generic shop-detail names
            "formula_values": self._formula_values(),
            "shop_details": self.shop,
            "record_id": str(self.doc_id_value),
        }


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _selection_formula(sel_formula: str, doc_id_value: int) -> str:
    formula = _clean(sel_formula).replace("`", "'")
    return f"{formula} {doc_id_value}" if formula else ""


def _split_pairs(fields: str, values: str) -> list[tuple[str, str]]:
    names = (fields or "").split(";")
    sources = (values or "").split(";")
    pairs: list[tuple[str, str]] = []
    for i, name in enumerate(names):
        name = name.strip().replace("`", "'")
        if not name or i >= len(sources) or not sources[i].strip():
            continue  # the desktop would crash on a missing pair; skip it instead
        pairs.append((name, sources[i].strip()))
    return pairs


def _parameter_value(conn: Connection, source: str) -> str:
    """`MstComp.CompName` -> first row of `Select CompName from MstComp` (identifiers validated, never concatenated blindly)."""
    table, _, column = source.partition(".")
    table, column = table.strip(), column.strip()
    if not (_IDENT.match(table) and _IDENT.match(column)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Print parameter source '{source}' is not Table.Column")
    row = conn.execute(text(f"SELECT [{column}] FROM [{table}] ORDER BY 1 {limit_clause(1)}")).first()
    return _clean(row[0]) if row else ""


def resolve_doc_id_value(conn: Connection, doc_id: int, doc_no: str) -> int:
    """Document NUMBER (e.g. 26SLV00549) -> record id, using the legacy naming rule (`getUtlDocDtls`):
    header table TrnHdr<ShForm>, number column <ShForm>No, id column <ShForm>ID."""
    sh = conn.execute(text("SELECT DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar()
    sh = _clean(sh)
    if not _IDENT.match(sh or "!"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Document {doc_id} is not a printable transaction")
    row = conn.execute(text(f"SELECT [{sh}ID] FROM [TrnHdr{sh}] WHERE [{sh}No] = :n"), {"n": doc_no.strip()}).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No {sh} document numbered '{doc_no}'")
    return int(row[0])


def build_job(
    conn: Connection,
    doc_id: int,
    doc_id_value: int | None = None,
    *,
    doc_no: str | None = None,
    option_name: str | None = None,
    ctrl_click: bool = False,
    copies: int | None = None,
) -> PrintJob:
    """Build the job for one document record. Pass the record id (`doc_id_value`) or the document number (`doc_no`)."""
    if doc_id_value is None:
        if not doc_no:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the record id or the document number")
        doc_id_value = resolve_doc_id_value(conn, doc_id, doc_no)

    # Vouchers print from the FmtVchDtl scratch tables, refilled first exactly like the desktop (see voucher_print.py).
    voucher = None
    if voucher_print.is_voucher_doc(conn, doc_id):
        voucher = voucher_print.stage_voucher(conn, doc_id, int(doc_id_value))
        conn.commit()  # the bridge reads the staged rows over its own connection

    sql = "SELECT * FROM UtlOption WHERE DocID = :doc"
    args: dict = {"doc": doc_id}
    if option_name:
        sql += " AND OptionName = :opt"
        args["opt"] = option_name
    # legacy: `select top 1 ... order by OptionOrder`
    sql += f" ORDER BY OptionOrder {limit_clause(1)}"
    opt = conn.execute(text(sql), args).mappings().first()
    if opt is None and voucher is not None:  # e.g. Receipt Voucher has no UtlOption row: the desktop opens fmtVCH.rpt directly
        opt = {
            "OptionName": option_name or "VCH Print", "CrptFileName": voucher_print.DEFAULT_REPORT, "SelFormula": "", "FormulasFld": "",
            "FormulasVal": "", "AddnlSelFormula": "", "ClickOperation": "P", "CtrlClickOperation": "", "NoOfCopies": 1,
            "DirectPrinterName": "", "AfterSaveAction": "",
        }
    if opt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No print option{f' {option_name!r}' if option_name else ''} for document {doc_id}")

    rpt_file = _clean(opt["CrptFileName"])
    if ".RPT" not in rpt_file.upper():
        rpt_file += ".rpt"
    found = scan_rpt_files().get(rpt_file.lower())
    rpt_path = str(Path(found).resolve()) if found else None  # absolute: the bridge may run with a different working folder
    if rpt_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Report file '{rpt_file}' was not found in the RPT folder")

    parameters = {name: _parameter_value(conn, source) for name, source in _split_pairs(opt["FormulasFld"], opt["FormulasVal"])}
    if voucher is not None:
        parameters["frmlVchName"] = voucher.doc_name

    operation = _clean(opt["CtrlClickOperation"] if ctrl_click else opt["ClickOperation"]).upper() or "P"
    return PrintJob(
        doc_id=doc_id,
        doc_id_value=int(doc_id_value),
        option_name=_clean(opt["OptionName"]),
        rpt_file=rpt_file,
        rpt_path=rpt_path,
        selection_formula=voucher_print.selection_formula(voucher.doc_no) if voucher else _selection_formula(opt["SelFormula"], int(doc_id_value)),
        parameters=parameters,
        operation=operation,
        copies=int(copies) if copies and copies > 1 else max(1, int(opt["NoOfCopies"] or 1)),
        printer_name=_clean(opt["DirectPrinterName"]),
        after_save_action=_clean(opt["AfterSaveAction"]),
        additional_selection_formula=_clean(opt["AddnlSelFormula"]).replace("`", "'"),
        shop=shop_details.labelled_values(conn),
    )
