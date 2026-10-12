"""Company Master endpoints — see app/services/company.py."""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import company as company_service

router = APIRouter(prefix="/company", tags=["company"])


def _require_admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change Company Master")


@router.get("")
def get_company(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return company_service.get_company(conn)


@router.put("")
def update_company(values: dict[str, Any], user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with with_transaction() as conn:
        return company_service.update_company(conn, values=values)


@router.get("/financial-years")
def list_financial_years(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return company_service.list_financial_years(conn)


class FinancialYearRequest(BaseModel):
    from_date: date
    to_date: date


@router.post("/financial-years", status_code=201)
def add_financial_year(body: FinancialYearRequest, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with with_transaction() as conn:
        company_service.add_financial_year(conn, from_date=body.from_date, to_date=body.to_date)
    return {"message": "Financial year added"}


class SetActiveRequest(BaseModel):
    from_date: date


@router.put("/financial-years/active")
def set_active_financial_year(body: SetActiveRequest, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with with_transaction() as conn:
        company_service.set_active_financial_year(conn, from_date=body.from_date)
    return {"message": "Active financial year updated"}
