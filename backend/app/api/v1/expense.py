"""Expense Entry endpoints (DocID 1260) — see app/services/expense.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import expense as svc

router = APIRouter(prefix="/expenses", tags=["expenses"])


class LineIn(BaseModel):
    led_id: int
    amount: float
    item_desc: str = ""
    remarks: str = ""


class ExpenseCreateRequest(BaseModel):
    prefix: str = ""
    expense_date: date
    payment_mode: str
    lines: list[LineIn]
    ref_no: str = ""
    remarks: str = ""
    cheque_no: str = ""
    cheque_date: date | None = None
    cheque_amount: float | None = None
    bank_name: str = ""
    extra_fields: dict = {}


class CancelRequest(BaseModel):
    reason: str


@router.get("")
def list_expenses(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(svc.DOC_ID, RIGHT_VIEW)),
):
    return svc.list_recent(conn, fy=fy, search=search, top=top)


@router.get("/{exp_id}")
def get_expense(exp_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(svc.DOC_ID, RIGHT_VIEW))):
    return svc.get(conn, exp_id=exp_id)


@router.post("", status_code=201)
def create_expense(
    body: ExpenseCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(svc.DOC_ID, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [svc.ExpenseLine(**l) for l in values.pop("lines")]
    data = svc.ExpenseInput(**values, lines=lines)
    with with_transaction() as conn:
        return svc.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.post("/{exp_id}/cancel")
def cancel_expense(exp_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(svc.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        svc.cancel(conn, exp_id=exp_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Expense Entry Successfully!"}


@router.delete("/{exp_id}")
def delete_expense(exp_id: int, user: CurrentUser = Depends(require_right(svc.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        svc.delete(conn, exp_id=exp_id, user_code=user.user_code)
    return {"message": "Deleted Expense Entry Successfully!"}
