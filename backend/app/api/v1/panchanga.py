"""Panchanga calendar endpoints — see app/services/panchanga.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import panchanga as panchanga_service

router = APIRouter(prefix="/panchanga", tags=["panchanga"])


@router.get("")
def list_panchanga(from_date: date, to_date: date, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return panchanga_service.list_range(conn, from_date=from_date, to_date=to_date)


class SetDayRequest(BaseModel):
    date: date
    name: str


@router.put("")
def set_panchanga_day(body: SetDayRequest, _: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        panchanga_service.set_day(conn, day=body.date, name=body.name)
    return {"message": "Updated"}


@router.delete("/{day}")
def delete_panchanga_day(day: date, _: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        panchanga_service.delete_day(conn, day=day)
    return {"message": "Deleted"}
