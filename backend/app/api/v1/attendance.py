"""Attendance + Attendance Monthly (legacy frmUtlAttendance / frmUtlAttMonth). Rights come from the menu item of each form."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, require_right_for_form
from app.meta.menu import RIGHT_ADD, RIGHT_VIEW
from app.services import attendance as svc

router = APIRouter(prefix="/attendance", tags=["attendance"])

DAILY_FORM = "FRMUTLATTENDANCE"
MONTHLY_FORM = "FRMUTLATTMONTH"


class DayRow(BaseModel):
    staff_id: int
    att_type: str = ""


class DayBody(BaseModel):
    rows: list[DayRow]


class CellBody(BaseModel):
    staff_id: int
    date: date
    att_type: str


@router.get("/day")
def get_day(day: date | None = None, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(DAILY_FORM, RIGHT_VIEW))):
    return svc.day_sheet(conn, day or date.today())


@router.post("/day")
def save_day(body: DayBody, user: CurrentUser = Depends(require_right_for_form(DAILY_FORM, RIGHT_ADD))):
    with with_transaction() as conn:
        return svc.save_day(conn, rows=[r.model_dump() for r in body.rows], user_code=user.user_code)


@router.get("/month")
def get_month(year: int, month: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(MONTHLY_FORM, RIGHT_VIEW))):
    return svc.month_sheet(conn, year, month)


@router.put("/month/cell")
def change_cell(body: CellBody, user: CurrentUser = Depends(require_right_for_form(MONTHLY_FORM, RIGHT_ADD))):
    with with_transaction() as conn:
        svc.change_cell(conn, staff_id=body.staff_id, day=body.date, att_type=body.att_type, user_code=user.user_code)
    return {"message": "Data Saved Sucessfully!"}
