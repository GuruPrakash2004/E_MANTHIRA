"""
Voucher printing — the legacy `frmTrnVch.PrintVch` staging step, done the way the desktop does it.

`fmtVCH.rpt` does not read the voucher tables. It reads two scratch tables that the desktop wipes and refills on every print:

  FmtVchDtl        one row per voucher line      DocID (= voucher NUMBER text), DocDate, SlNo, ByTo, LedgerDesc, DebitAmt, CreditAmt, AgntRefAmt, OnAcAmt
  FmtVchAddnlFlds  the header/footer/total fields (header & footer shown as "label : value" blocks, totals)   RowNum, FldName, FldValue, FldSection (H/F/T), DocID

and is opened with the selection `{FmtVchDtl.DocID} = '<docno>'`. The rows written here were checked against what the desktop itself left in
those tables for voucher 26SLV00035 (Payment Voucher 17213): same columns, same values, same row numbering.

Rules reproduced:
  * `delete from FmtVchDtl` + `delete from FmtVchAddnlFlds`, then insert (global, like the desktop — two prints at the same moment would clobber
    each other there; PRINT_LOCK serialises prints made through this backend from staging to the end of the render).
  * lines come from `TrnDtl<sh>` joined to `MstAcLed`, ordered by SlNo: ByTo = AmtType (DR/CR), LedgerDesc = AcLedName,
    DebitAmt = DrAmt, CreditAmt = CrAmt, AgntRefAmt and OnAcAmt both = AgRefAmt (the desktop reads the same grid column for both).
  * additional fields come from the document's designer rows (`UtlDocDsgrFlds`, sections Header / Footer / Total, in FldOrderBy order); RowNum is the
    field's position inside its section (hidden fields keep their number but are not written); values come from the saved header row.
  * the report's `frmlVchName` parameter is the document's name; the shop details (compname, add1..add4) are sent as for every report.

This is the one place the print path WRITES to the database (two scratch tables the legacy app already writes).
"""
from __future__ import annotations

import re
import threading
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.engine import Connection

PRINT_LOCK = threading.RLock()
DEFAULT_REPORT = "fmtVCH.rpt"  # the desktop opens this file directly from the voucher form
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SECTIONS = {"Header": "H", "Footer": "F", "Total": "T"}


@dataclass
class StagedVoucher:
    doc_no: str  # the voucher NUMBER (FmtVchDtl.DocID)
    doc_name: str  # frmlVchName


def _short_form(conn: Connection, doc_id: int) -> tuple[str, str] | None:
    row = conn.execute(text("SELECT DocShForm, DocName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).first()
    if row is None:
        return None
    sh = (row[0] or "").strip()
    return (sh, (row[1] or "").strip()) if _IDENT.match(sh or "!") else None


def is_voucher_doc(conn: Connection, doc_id: int) -> bool:
    """A voucher-style document = its detail table has the ledger/Dr/Cr columns the voucher form uses (metadata-driven, no id list)."""
    found = _short_form(conn, doc_id)
    if found is None:
        return False
    cols = {
        r[0].lower()
        for r in conn.execute(
            text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": f"TrnDtl{found[0]}"}
        ).all()
    }
    return {"acledid", "dramt", "cramt", "amttype"} <= cols


def print_lock_for(conn: Connection, doc_id: int):
    """Hold this around build + render for a voucher so the scratch tables are not refilled underneath the render."""
    return PRINT_LOCK if is_voucher_doc(conn, doc_id) else nullcontext()


def _plain_number(value: object) -> str:
    """10000.00 -> '10000', 1234.50 -> '1234.5' (how the desktop grid shows a computed total)."""
    d = Decimal(str(value))
    s = format(d.normalize(), "f")
    return s


def _field_value(value: object, data_type: str) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        return _plain_number(value)
    return str(value).strip()


def stage_voucher(conn: Connection, doc_id: int, record_id: int) -> StagedVoucher:
    """Wipe and refill FmtVchDtl / FmtVchAddnlFlds for this voucher. Does not commit — the caller commits before rendering."""
    found = _short_form(conn, doc_id)
    if found is None:
        raise ValueError(f"Document {doc_id} is not a printable transaction")
    sh, doc_name = found

    header = conn.execute(text(f"SELECT * FROM [TrnHdr{sh}] WHERE [{sh}ID] = :i"), {"i": record_id}).mappings().first()
    if header is None:
        raise LookupError(f"No {sh} record {record_id}")
    doc_no = str(header[f"{sh}NO"] or "").strip()

    lines = conn.execute(
        text(
            f"SELECT d.SlNo, d.AmtType, i.AcLedName, d.DrAmt, d.CrAmt, d.AgRefAmt "
            f"FROM [TrnDtl{sh}] d, MstAcLed i WHERE d.[{sh}ID] = :i AND d.AcLedID = i.AcLedID ORDER BY d.SlNo"
        ),
        {"i": record_id},
    ).mappings().all()

    conn.execute(text("DELETE FROM FmtVchDtl"))
    conn.execute(text("DELETE FROM FmtVchAddnlFlds"))

    doc_date = header[f"{sh}Date"]
    for n, ln in enumerate(lines, start=1):
        agref = ln["AgRefAmt"] or 0
        conn.execute(
            text(
                "INSERT INTO FmtVchDtl (DocID, DocDate, SlNo, ByTo, LedgerDesc, DebitAmt, CreditAmt, AgntRefAmt, OnAcAmt) "
                "VALUES (:doc, :dt, :sl, :byto, :desc, :dr, :cr, :ag, :oa)"
            ),
            {
                "doc": doc_no,
                "dt": doc_date,
                "sl": n,
                "byto": (ln["AmtType"] or "").strip()[:2],
                "desc": (ln["AcLedName"] or "")[:200],
                "dr": ln["DrAmt"] or 0,
                "cr": ln["CrAmt"] or 0,
                "ag": agref,
                "oa": agref,  # the desktop writes the same grid column to both
            },
        )

    designer = conn.execute(
        text(
            "SELECT FldSection, FldCode, FldCaption, FldDataType, FLdBlnHide FROM UtlDocDsgrFlds "
            "WHERE DocID = :d AND FldSection IN ('Header', 'Footer', 'Total') ORDER BY FldOrderBy, FldID"
        ),
        {"d": doc_id},
    ).mappings().all()
    position = {"H": 0, "F": 0, "T": 0}
    for f in designer:
        section = _SECTIONS[f["FldSection"].strip()]
        row_num = position[section]
        position[section] += 1
        if (f["FLdBlnHide"] or "N").strip().upper() != "N":
            continue  # a hidden field keeps its row number but is not printed
        code = (f["FldCode"] or "").strip()
        value = header[code] if code in header else None
        conn.execute(
            text("INSERT INTO FmtVchAddnlFlds (RowNum, FldName, FldValue, FldSection, DocID) VALUES (:r, :n, :v, :s, :doc)"),
            {
                "r": row_num,
                "n": (f["FldCaption"] or "").strip()[:50],
                "v": _field_value(value, (f["FldDataType"] or "").strip())[:250],
                "s": section,
                "doc": doc_no,
            },
        )
    return StagedVoucher(doc_no=doc_no, doc_name=doc_name)


def selection_formula(doc_no: str) -> str:
    """`{FmtVchDtl.DocID} = '<docno>'` (a quote inside the number would be doubled; numbers are YYSLV00035-style)."""
    return "{FmtVchDtl.DocID} = '" + doc_no.replace("'", "''") + "'"
