"""Company Master endpoints — see app/services/company.py."""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import company as company_service

router = APIRouter(prefix="/company", tags=["company"])


def _require_admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change Company Master")


@router.get("/layout")
def get_layout(_: CurrentUser = Depends(get_current_user)):
    return company_service.get_layout()


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


@router.delete("/financial-years/{from_date}")
def remove_financial_year(from_date: date, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with with_transaction() as conn:
        company_service.remove_financial_year(conn, from_date=from_date)
    return {"message": "Financial year removed"}


@router.get("/image")
def get_company_image(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    img = company_service.get_company_image(conn)
    if img is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No company image")
    media = "image/png" if img[1:4] == b"PNG" else "image/jpeg"
    return Response(content=img, media_type=media)


@router.put("/image")
async def set_company_image(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    content = await file.read()
    if not content or len(content) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose an image up to 5 MB")
    with with_transaction() as conn:
        company_service.set_company_image(conn, content=content)
    return {"message": "Image updated"}
