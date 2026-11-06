"""Holiday Master, Accounting Ledger Master (bill-wise opening balances) and the Sannidhi-vs-Seva overview.
Rights come from the menu row of each legacy form (by form name, or by caption where the legacy row has none)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, require_right_for_form
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import legacy_masters as svc

router = APIRouter(tags=["legacy-masters"])

HOLIDAY = "Holiday Master"  # the menu row has no form name, so it is found by caption
LEDGER_FORM = "FRMMSTACCOUNTLED"
SANSEVA_FORM = "frmMstSanSeva"


class HolidayBody(BaseModel):
    date: date
    name: str


class OpeningBody(BaseModel):
    ref_no: str = ""
    ref_date: date
    amount: float
    dr_cr: str  # one of the side values the opening-balance endpoint returns in `sides`


# ---- Holiday Master
@router.get("/holidays")
def list_holidays(
    start: date | None = Query(None, alias="from"),
    end: date | None = Query(None, alias="to"),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right_for_form(HOLIDAY, RIGHT_VIEW, by="caption")),
):
    return svc.holidays(conn, start=start or fy.start_date, end=end or fy.end_date)


@router.post("/holidays", status_code=201)
def add_holiday(body: HolidayBody, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right_for_form(HOLIDAY, RIGHT_ADD, by="caption"))):
    with with_transaction() as conn:
        svc.add_holiday(conn, day=body.date, name=body.name, fy=fy, user_code=user.user_code)
    return {"message": "Data saved successfully...."}


@router.put("/holidays")
def update_holiday(body: HolidayBody, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right_for_form(HOLIDAY, RIGHT_EDIT, by="caption"))):
    with with_transaction() as conn:
        svc.update_holiday(conn, day=body.date, name=body.name, fy=fy, user_code=user.user_code)
    return {"message": "Updated successfully...."}


@router.delete("/holidays")
def delete_holiday(day: date = Query(..., alias="date"), fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right_for_form(HOLIDAY, RIGHT_DELETE, by="caption"))):
    with with_transaction() as conn:
        svc.delete_holiday(conn, day=day, fy=fy, user_code=user.user_code)
    return {"message": "Deleted succussfully"}


# ---- Accounting Ledger Master
@router.get("/acc-ledgers")
def list_ledgers(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(LEDGER_FORM, RIGHT_VIEW))):
    return svc.ledgers(conn, search=search)


@router.get("/acc-ledgers/{led_id}/opening")
def get_opening(led_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(LEDGER_FORM, RIGHT_VIEW))):
    return svc.opening_balances(conn, led_id)


@router.post("/acc-ledgers/{led_id}/opening", status_code=201)
def add_opening(led_id: int, body: OpeningBody, user: CurrentUser = Depends(require_right_for_form(LEDGER_FORM, RIGHT_ADD))):
    with with_transaction() as conn:
        return svc.add_opening(conn, led_id=led_id, ref_no=body.ref_no, ref_date=body.ref_date, amount=body.amount, dr_cr=body.dr_cr, user_code=user.user_code)


@router.put("/acc-ledgers/{led_id}/opening/{op_id}")
def update_opening(led_id: int, op_id: int, body: OpeningBody, user: CurrentUser = Depends(require_right_for_form(LEDGER_FORM, RIGHT_EDIT))):
    with with_transaction() as conn:
        svc.update_opening(conn, led_id=led_id, op_id=op_id, ref_date=body.ref_date, amount=body.amount, dr_cr=body.dr_cr, user_code=user.user_code)
    return {"message": "Updated successfully."}


@router.delete("/acc-ledgers/{led_id}/opening/{op_id}")
def delete_opening(led_id: int, op_id: int, user: CurrentUser = Depends(require_right_for_form(LEDGER_FORM, RIGHT_DELETE))):
    with with_transaction() as conn:
        svc.delete_opening(conn, led_id=led_id, op_id=op_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Sannidhi vs Seva overview (editing is the existing Attach Seva endpoint)
@router.get("/sannidhi-sevas")
def sannidhi_sevas(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(SANSEVA_FORM, RIGHT_VIEW))):
    return svc.sannidhi_sevas(conn)
