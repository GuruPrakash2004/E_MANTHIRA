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

COMPLETE_DAY_RPT = "RptDtlCompDayDtl.rpt"
_VIEW = "vwSevaRptSMut"


def _crystal_date(d: date) -> str:
    return f"DateTime({d.year}, {d.month}, {d.day}, 0, 0, 0)"


def _crystal_str(v: str) -> str:
    return '"' + str(v).replace('"', '""') + '"'


def complete_day_selection(
    from_date: date, to_date: date, sannidhi_ids: list[int] | None, seva_ids: list[int] | None, users: list[str] | None
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
    return " and ".join(parts)


def complete_day_job(
    conn: Connection,
    *,
    from_date: date,
    to_date: date,
    sannidhi_ids: list[int] | None = None,
    seva_ids: list[int] | None = None,
    users: list[str] | None = None,
) -> PrintJob:
    found = find_rpt(COMPLETE_DAY_RPT)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Report file '{COMPLETE_DAY_RPT}' was not found in the RPT folder")
    comp = conn.execute(text("SELECT TOP 1 CompName, Address1, Address2, Address3 FROM MstComp")).mappings().first() or {}
    clean = lambda k: str(comp.get(k) or "").strip()  # noqa: E731
    shown = lambda d: d.strftime("%d/%m/%Y")  # noqa: E731
    period = shown(from_date) if from_date == to_date else f"{shown(from_date)} to {shown(to_date)}"
    return PrintJob(
        doc_id=0,
        doc_id_value=0,
        option_name="Complete Day Report - Userwise",
        rpt_file=COMPLETE_DAY_RPT,
        rpt_path=str(Path(found).resolve()),
        selection_formula=complete_day_selection(from_date, to_date, sannidhi_ids, seva_ids, users),
        parameters={"compname": clean("CompName"), "add1": clean("Address1"), "add2": clean("Address2"), "add3": clean("Address3"), "Date": period},
    )
