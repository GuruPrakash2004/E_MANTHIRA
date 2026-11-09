"""
Print jobs for the report-style .rpt files that have no UtlOption row (the desktop opens them from the report screens with
`showRptFile(caption, rptName, selFormula, formulas)`). Today: Complete Day -> RptDtlCompDayDtl.rpt ("Complete Day Report -
Userwise"), whose data is the view vwSevaRptSMut and whose parameters are compname, add1, add2, add3 and Date.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.print.rpt_print import PrintJob
from app.print.rpt_registry import find_rpt

COMPLETE_DAY_RPT = "RptDtlCompDayDtl.rpt"  # Detailed (legacy optDtl)
COMPLETE_DAY_SUMMARY_RPT = "RptDtlCompDaySmry.rpt"  # Summary (legacy optSmry)
_VIEW = "vwSevaRptSMut"


def _crystal_date(d: date) -> str:
    return f"DateTime({d.year}, {d.month}, {d.day}, 0, 0, 0)"


def _crystal_str(v: str) -> str:
    return '"' + str(v).replace('"', '""') + '"'


COMPLETE_DAY_DOC_ID = 100000 + 3  # print options of "Complete Day Report" (UtlReports RptID 3), see api/v1/print_options.py


def _complete_day_option(conn: Connection, summary: bool) -> tuple[str, str]:
    """(option name, .rpt file) for Detailed / Summary: the print option staff set up for the report in Print Options,
    else the standard file the legacy form opens."""
    from app.print.rpt_registry import list_options

    try:
        options = list_options(conn, COMPLETE_DAY_DOC_ID)
    except Exception:  # noqa: BLE001 - a database without those rows simply uses the standard files
        options = []
    is_summary = lambda o: "smry" in o.rpt_file.lower() or "summary" in o.option_name.lower()  # noqa: E731
    pool = [o for o in options if is_summary(o) == summary and o.rpt_file]
    if pool:
        pick = next((o for o in pool if o.default_print), pool[0])
        return pick.option_name, pick.rpt_file
    return ("Complete Day Report - Summary" if summary else "Complete Day Report - Userwise"), (COMPLETE_DAY_SUMMARY_RPT if summary else COMPLETE_DAY_RPT)


def _hm(value: str | None) -> tuple[int, int] | None:
    """'HH:MM' (or 'HH:MM:SS') -> (hour, minute); anything else = no time filter."""
    try:
        h, m = str(value or "").strip().split(":")[:2]
        h, m = int(h), int(m)
    except ValueError:
        return None
    return (h, m) if 0 <= h < 24 and 0 <= m < 60 else None


def complete_day_selection(
    from_date: date,
    to_date: date,
    sannidhi_ids: list[int] | None,
    seva_ids: list[int] | None,
    users: list[str] | None,
    time_from: str | None = None,
    time_to: str | None = None,
) -> str:
    """Record selection of the report: the period, not cancelled, and the ticked Sannidhi / Seva / User (same filters as the screen)."""
    parts = [
        f"{{{_VIEW}.SEVADate}} >= {_crystal_date(from_date)}",
        f"{{{_VIEW}.SEVADate}} < {_crystal_date(to_date + timedelta(days=1))}",
        f"{{{_VIEW}.Cancelled}} <> \"Y\"",
    ]
    if sannidhi_ids:
        parts.append(f"{{{_VIEW}.SANNIDHIID}} in [{', '.join(str(int(i)) for i in sannidhi_ids)}]")
    if seva_ids:
        parts.append(f"{{{_VIEW}.SVAID}} in [{', '.join(str(int(i)) for i in seva_ids)}]")
    if users:
        parts.append(f"{{{_VIEW}.AddedBy}} in [{', '.join(_crystal_str(u) for u in users)}]")
    # legacy chkTimeFrom / chkTimeTo: the time the bill was entered, to the minute
    if (t := _hm(time_from)) is not None:
        parts.append(f"Timevalue({{{_VIEW}.AddedOn}}) >= Time({t[0]}, {t[1]}, 00)")
    if (t := _hm(time_to)) is not None:
        parts.append(f"Timevalue({{{_VIEW}.AddedOn}}) <= Time({t[0]}, {t[1]}, 00)")
    return " and ".join(parts)


def complete_day_job(
    conn: Connection,
    *,
    from_date: date,
    to_date: date,
    sannidhi_ids: list[int] | None = None,
    seva_ids: list[int] | None = None,
    users: list[str] | None = None,
    time_from: str | None = None,
    time_to: str | None = None,
    summary: bool = False,
) -> PrintJob:
    option_name, rpt_name = _complete_day_option(conn, summary)
    return _view_report_job(
        conn, option_name, rpt_name, from_date, to_date,
        complete_day_selection(from_date, to_date, sannidhi_ids, seva_ids, users, time_from, time_to),
    )


def _view_report_job(conn: Connection, option_name: str, rpt_name: str, from_date: date, to_date: date, selection: str) -> PrintJob:
    """Shared by the reports on vwSevaRptSMut: they all take compname, add1..add3 and Date."""
    found = find_rpt(rpt_name)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Report file '{rpt_name}' was not found in the RPT folder")
    comp = conn.execute(text("SELECT TOP 1 CompName, Address1, Address2, Address3 FROM MstComp")).mappings().first() or {}
    clean = lambda k: str(comp.get(k) or "").strip()  # noqa: E731
    shown = lambda d: d.strftime("%d/%m/%Y")  # noqa: E731
    period = shown(from_date) if from_date == to_date else f"{shown(from_date)} to {shown(to_date)}"
    return PrintJob(
        doc_id=0,
        doc_id_value=0,
        option_name=option_name,
        rpt_file=rpt_name,
        rpt_path=str(Path(found).resolve()),
        selection_formula=selection,
        parameters={"compname": clean("CompName"), "add1": clean("Address1"), "add2": clean("Address2"), "add3": clean("Address3"), "Date": period},
    )


KANIKE_RPT = "RptKnk.rpt"  # Kanike / Donation Report (legacy frmRptDonation)
KANIKE_DOC_ID = 100000 + 1  # print options of "Kanike Report" (UtlReports RptID 1)


def kanike_job(conn: Connection, *, from_date: date, to_date: date) -> PrintJob:
    """RptKnk.rpt: donation receipts (TrnHdrDONREC + TrnDtlDONREC + MstSVA) of the period, cancelled ones left out."""
    from app.print.rpt_registry import list_options

    option_name, rpt_name = "Kanike Report", KANIKE_RPT
    try:
        options = [o for o in list_options(conn, KANIKE_DOC_ID) if o.rpt_file]
    except Exception:  # noqa: BLE001 - a database without those rows uses the standard file
        options = []
    if options:
        pick = next((o for o in options if o.default_print), options[0])
        option_name, rpt_name = pick.option_name, pick.rpt_file
    t = "TrnHdrDONREC"
    selection = (
        f"{{{t}.DONRECDate}} >= {_crystal_date(from_date)} and {{{t}.DONRECDate}} < {_crystal_date(to_date + timedelta(days=1))}"
        f" and {{{t}.Cancelled}} <> \"Y\""
    )
    return _view_report_job(conn, option_name, rpt_name, from_date, to_date, selection)


COLLECTION_RPT = "RptDtlColn.rpt"  # Detailed Collection Report (legacy frmRptDtlColn)
COLLECTION_DOC_ID = 100000 + 5  # print options of "Detailed Collection Report" (UtlReports RptID 5)


def collection_job(
    conn: Connection,
    *,
    from_date: date,
    to_date: date,
    sannidhi_ids: list[int] | None = None,
    seva_ids: list[int] | None = None,
    users: list[str] | None = None,
) -> PrintJob:
    from app.print.rpt_registry import list_options

    option_name, rpt_name = "Detailed Collection Report", COLLECTION_RPT
    try:
        options = [o for o in list_options(conn, COLLECTION_DOC_ID) if o.rpt_file]
    except Exception:  # noqa: BLE001 - a database without those rows uses the standard file
        options = []
    if options:
        pick = next((o for o in options if o.default_print), options[0])
        option_name, rpt_name = pick.option_name, pick.rpt_file
    return _view_report_job(
        conn, option_name, rpt_name, from_date, to_date,
        complete_day_selection(from_date, to_date, sannidhi_ids, seva_ids, users),
    )
