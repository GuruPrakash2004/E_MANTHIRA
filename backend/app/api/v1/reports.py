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
def list_report_catalog(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    """
    "Subsidiary Reports" (legacy `frmRptReport`) — that screen is just a
    launcher reading `UtlReports` (RptName/RptGroupName/RptFrmName) and
    opening whichever form `RptFrmName` names. This is the same catalog,
    metadata-driven (CLAUDE.md rule 5) — the frontend maps each
    `RptFrmName` it recognises to one of its own report tabs and disables
    the rest, same convention as the sidebar menu's CAPTION_ROUTE.
    """
    from sqlalchemy import text

    if user.user_code.upper() == "ADMIN":
        sql, params = "SELECT RptID, RptName, RptGroupName, RptFrmName FROM UtlReports ORDER BY RptGroupName, RptName", {}
    else:  # legacy FillReportGrid: non-ADMIN users only see reports assigned in UtlReportsRights
        sql = (
            "SELECT h.RptID, h.RptName, h.RptGroupName, h.RptFrmName FROM UtlReports h JOIN UtlReportsRights d ON d.RptID = h.RptID "
            "WHERE d.UserID = :u GROUP BY h.RptGroupName, h.RptName, h.RptID, h.RptFrmName ORDER BY h.RptGroupName, h.RptName"
        )
        params = {"u": user.user_id}
    rows = conn.execute(text(sql), params).mappings().all()
    return [{"rpt_id": r["RptID"], "name": r["RptName"], "group": r["RptGroupName"], "form_name": r["RptFrmName"]} for r in rows]


def _admin_only(user: CurrentUser) -> None:
    from fastapi import HTTPException

    if user.user_code.upper() != "ADMIN":
        raise HTTPException(403, "Only ADMIN can assign report rights")


@router.get("/catalog/users")
def catalog_users(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    from sqlalchemy import text

    _admin_only(user)
    rows = conn.execute(text("SELECT UserID, UserCode, UserName FROM MstUser WHERE UserID > 0 AND UPPER(UserCode) <> 'ADMIN' ORDER BY UserCode")).mappings().all()
    return [{"user_id": r["UserID"], "code": r["UserCode"], "name": r["UserName"]} for r in rows]


@router.get("/catalog/rights/{user_id}")
def catalog_rights(user_id: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    from sqlalchemy import text

    _admin_only(user)
    return [r[0] for r in conn.execute(text("SELECT RptID FROM UtlReportsRights WHERE UserID = :u"), {"u": user_id}).all()]


class ReportRightsBody(BaseModel):
    rpt_ids: list[int]


@router.put("/catalog/rights/{user_id}")
def save_catalog_rights(user_id: int, body: ReportRightsBody, user: CurrentUser = Depends(get_current_user)):
    """Assign Rights - Save: replace the user's UtlReportsRights rows (legacy: delete, then insert each ticked report)."""
    from sqlalchemy import text

    from app.core.db import with_transaction
    from app.legacy.tables import insert_row

    _admin_only(user)
    with with_transaction() as conn:
        conn.execute(text("DELETE FROM UtlReportsRights WHERE UserID = :u"), {"u": user_id})
        for rid in dict.fromkeys(body.rpt_ids):
            insert_row(conn, "UtlReportsRights", {"UserID": user_id, "RptID": rid})
    return {"saved": len(set(body.rpt_ids))}


def _is_admin(user: CurrentUser) -> bool:
    return user.user_code.upper() == "ADMIN"


@router.get("/custom")
def list_custom_reports(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    return custom_reports_service.list_reports(conn, user_id=user.user_id, is_admin=_is_admin(user))


@router.get("/custom/{crid}/fields")
def get_custom_report_fields(crid: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return custom_reports_service.get_definition(conn, crid)


@router.get("/custom/{crid}/filter-values")
def custom_filter_values(crid: int, table: str, code: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return custom_reports_service.filter_values(conn, crid, table, code)


class CustomRunBody(BaseModel):
    date_filters: list[dict] = []
    list_filters: list[dict] = []


@router.post("/custom/{crid}/run")
def run_custom_report(crid: int, body: CustomRunBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return custom_reports_service.run_report(conn, crid=crid, date_filters=body.date_filters, list_filters=body.list_filters)


@router.post("/custom/{crid}/export")
def export_custom_report(crid: int, body: CustomRunBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from fastapi import Response

    result = custom_reports_service.run_report(conn, crid=crid, date_filters=body.date_filters, list_filters=body.list_filters)
    return Response(
        content=custom_reports_service.export_xls(result),
        media_type="application/vnd.ms-excel",
        headers={"Content-Disposition": 'attachment; filename="report.xls"'},
    )


class CustomEmailBody(CustomRunBody):
    to: str
    cc: str = ""
    subject: str = ""
    message: str = ""


@router.post("/custom/{crid}/email")
def email_custom_report(crid: int, body: CustomEmailBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Email button: the report (as an Excel file) mailed through the SMTP settings."""
    import re

    from fastapi import HTTPException

    from app.services import mail

    split = lambda raw: [a.strip() for a in re.split(r"[;,]", raw or "") if a.strip()]  # noqa: E731
    to, cc = split(body.to), split(body.cc)
    if not to:
        raise HTTPException(422, "To is Empty....")
    for a in to + cc:
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", a):
            raise HTTPException(422, f"The below email address is not valid... {a}")
    result = custom_reports_service.run_report(conn, crid=crid, date_filters=body.date_filters, list_filters=body.list_filters)
    name = re.sub(r"[^A-Za-z0-9_ -]", "", result["title"]) or "Report"
    mail.send_mail(conn, to, body.subject or result["title"], body.message or f"Please find the report {result['title']} attached.", attachment=(f"{name}.xls", custom_reports_service.export_xls(result)), cc=cc)
    return {"message": f"Mail sent to {len(to)} recipient(s)"}


@router.get("/custom/rights/users")
def custom_rights_users(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    return catalog_users(conn, user)


@router.get("/custom/rights/{user_id}")
def custom_rights(user_id: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _admin_only(user)
    return custom_reports_service.rights_for_user(conn, user_id)


@router.put("/custom/rights/{user_id}")
def save_custom_rights(user_id: int, body: ReportRightsBody, user: CurrentUser = Depends(get_current_user)):
    from app.core.db import with_transaction

    _admin_only(user)
    with with_transaction() as conn:
        return {"saved": custom_reports_service.save_rights(conn, user_id, body.rpt_ids)}


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


class HallVoucherFilters(DateRangeFilters):
    hb_ids: list[int] | None = None


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
def run_hall_booking_voucher(body: HallVoucherFilters, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return reports_service.hall_booking_with_voucher(conn, **body.model_dump())


@router.get("/hall-booking-voucher/bookings")
def hall_voucher_bookings(from_date: date, to_date: date, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return reports_service.hall_booking_vouchers_pick(conn, from_date=from_date, to_date=to_date)


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


class PartyGLBody(BaseModel):
    kind: str = "supplier"  # supplier | customer | ledger
    mode: str = "detail"  # detail | summary
    from_date: date
    to_date: date
    ac_ids: list[int] | None = None
    hide_zero: bool = True


@router.get("/party-gl/accounts")
def party_gl_accounts(kind: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import party_gl

    return party_gl.accounts(conn, kind)


@router.post("/party-gl")
def run_party_gl(body: PartyGLBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """General Ledger (legacy FrmRptAccGL): supplier / customer / ledger wise, summary or detail."""
    from app.services import party_gl

    if body.mode == "summary":
        return party_gl.summary(conn, kind=body.kind, d1=body.from_date, d2=body.to_date, ac_ids=body.ac_ids, hide_zero=body.hide_zero)
    return party_gl.detail(conn, kind=body.kind, d1=body.from_date, d2=body.to_date, ac_ids=body.ac_ids)
