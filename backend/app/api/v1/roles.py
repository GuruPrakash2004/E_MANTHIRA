"""Role rights matrix endpoints — see app/services/rights.py."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_EDIT, RIGHT_VIEW
from app.services import rights as rights_service

ROLE_MASTER_DOC_ID = 1160

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("/{role_id}/rights")
def get_role_rights(
    role_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(ROLE_MASTER_DOC_ID, RIGHT_VIEW))
):
    return rights_service.list_rights(conn, role_id)


@router.put("/{role_id}/rights")
def put_role_rights(role_id: int, items: list[dict[str, Any]], _: CurrentUser = Depends(require_right(ROLE_MASTER_DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        rights_service.save_rights(conn, role_id, items)
    return {"message": "Rights saved"}
