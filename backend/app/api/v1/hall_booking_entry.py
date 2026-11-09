"""Hall Booking Entry endpoints — see app/services/hall_booking_entry.py (DocID 1280, distinct from Hall Booking/1281)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import hall_booking_entry as hbe

router = APIRouter(prefix="/hall-booking-entry", tags=["hall-booking-entry"])


class HbeCreateRequest(BaseModel):
    fields: dict  # Header / Footer / Total Designer fields keyed by FldCode
    lines: list[dict]  # Detail Designer fields keyed by FldCode, one dict per line
    receipt_date: date | None = None


@router.get("")
def list_hbe(
    search: str = "",
    top: int = Query(50, le=1000),
    fy: FinancialYear = Depends(get_history_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_VIEW)),
):
    return hbe.list_hbe(conn, fy=fy, top=top, search=search)


@router.get("/{hbe_id}")
def get_hbe(hbe_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_VIEW))):
    return hbe.get_hbe(conn, hbe_id=hbe_id)


@router.post("", status_code=201)
def create_hbe(body: HbeCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_ADD))):
    data = hbe.HbeInput(fields=body.fields, lines=body.lines, receipt_date=body.receipt_date)
    with with_transaction() as conn:
        return hbe.create_hbe(conn, data=data, fy=fy, user_code=user.user_code)


@router.put("/{hbe_id}")
def update_hbe(hbe_id: int, body: HbeCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_EDIT))):
    data = hbe.HbeInput(fields=body.fields, lines=body.lines, receipt_date=body.receipt_date)
    with with_transaction() as conn:
        return hbe.update_hbe(conn, hbe_id=hbe_id, data=data, fy=fy, user_code=user.user_code)


@router.delete("/{hbe_id}")
def delete_hbe(hbe_id: int, user: CurrentUser = Depends(require_right(hbe.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        hbe.delete_hbe(conn, hbe_id=hbe_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}
