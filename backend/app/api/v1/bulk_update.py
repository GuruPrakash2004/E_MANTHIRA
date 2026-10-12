"""Bulk Master/Transaction Update endpoints — see app/services/bulk_update.py."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import bulk_update as bulk_update_service

router = APIRouter(prefix="/bulk-update", tags=["bulk-update"])


def _require_admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can use Bulk Update")


@router.get("/definitions")
def list_definitions(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    return bulk_update_service.list_definitions(conn)


@router.get("/{row_id}")
def get_definition(row_id: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    return bulk_update_service.get_definition(conn, row_id)


class ListRowsRequest(BaseModel):
    filters: dict[str, str] = {}


@router.post("/{row_id}/rows/search")
def list_rows(row_id: int, body: ListRowsRequest, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    return bulk_update_service.list_rows(conn, row_id=row_id, filters=body.filters)


class SaveRowsRequest(BaseModel):
    rows: list[dict[str, Any]]


@router.put("/{row_id}/rows")
def save_rows(row_id: int, body: SaveRowsRequest, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with with_transaction() as conn:
        updated = bulk_update_service.save_rows(conn, row_id=row_id, rows=body.rows, user_code=user.user_code)
    return {"message": f"Updated {updated} row(s)"}
