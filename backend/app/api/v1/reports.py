"""Subsidiary reports endpoints — see app/services/reports.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user
from app.services import custom_reports as custom_reports_service
from app.services import general_ledger as general_ledger_service
from app.services import reports as reports_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/catalog")
def list_report_catalog(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """
    "Subsidiary Reports" (legacy `frmRptReport`) — that screen is just a
    launcher reading `UtlReports` (RptName/RptGroupName/RptFrmName) and
    opening whichever form `RptFrmName` names. This is the same catalog,
    metadata-driven (CLAUDE.md rule 5) — the frontend maps each
    `RptFrmName` it recognises to one of its own report tabs and disables
    the rest, same convention as the sidebar menu's CAPTION_ROUTE.
    """
    from sqlalchemy import text

    rows = conn.execute(text("SELECT RptID, RptName, RptGroupName, RptFrmName FROM UtlReports ORDER BY RptGroupName, RptName")).mappings().all()
    return [{"rpt_id": r["RptID"], "name": r["RptName"], "group": r["RptGroupName"], "form_name": r["RptFrmName"]} for r in rows]


@router.get("/custom")
def list_custom_reports(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return custom_reports_service.list_reports(conn)


@router.get("/custom/{crid}/fields")
def get_custom_report_fields(crid: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return custom_reports_service.get_definition(conn, crid)


class CustomReportRunRequest(BaseModel):
    filters: dict[str, str] = {}


@router.post("/custom/{crid}/run")
def run_custom_report(
    crid: int, body: CustomReportRunRequest, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)
):
    return custom_reports_service.run_report(conn, crid=crid, filters=body.filters)


class CollectionFilters(BaseModel):
    from_date: date
    to_date: date
    sannidhi_ids: list[int] | None = None
    seva_ids: list[int] | None = None
    users: list[str] | None = None
    time_from: str | None = None
    time_to: str | None = None


class SevaIssueFilters(BaseModel):
    from_date: date
    to_date: date
    sannidhi_ids: list[int] | None = None
    seva_ids: list[int] | None = None
    users: list[str] | None = None


class DateRangeFilters(BaseModel):
    from_date: date
    to_date: date


@router.post("/complete-day")
def run_complete_day(
    body: CollectionFilters, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)
):
    return reports_service.seva_collection(conn, **body.model_dump())


@router.post("/collection")
def run_collection(body: CollectionFilters, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return reports_service.seva_collection(conn, **body.model_dump())


@router.post("/seva-issue")
def run_seva_issue(body: SevaIssueFilters, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return reports_service.seva_issue(conn, **body.model_dump())


@router.post("/donations")
def run_donations(body: DateRangeFilters, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return reports_service.donations(conn, **body.model_dump())


@router.post("/hall-booking-voucher")
def run_hall_booking_voucher(body: DateRangeFilters, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return reports_service.hall_booking_with_voucher(conn, **body.model_dump())


class GeneralLedgerFilters(BaseModel):
    ac_led_ids: list[int]
    from_date: date
    to_date: date
    mode: str = "detail"  # detail | summary
    hide_zero: bool = False


@router.post("/general-ledger")
def run_general_ledger(
    body: GeneralLedgerFilters,
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return general_ledger_service.general_ledger(conn, fy_start_date=fy.start_date, **body.model_dump())
