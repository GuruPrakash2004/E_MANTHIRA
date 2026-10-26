"""Header + detail Designer documents (Group Seva) — see app/services/header_detail_doc.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import header_detail_doc as hdd

router = APIRouter(tags=["header-detail-docs"])


class CreateRequest(BaseModel):
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    lines: list[dict]  # Detail Designer fields keyed by FldCode, one dict per line
    doc_date: date


class CancelRequest(BaseModel):
    reason: str


def _register(spec: hdd.Spec) -> None:
    base = f"/{spec.kind}"

    @router.get(base, name=f"list_{spec.short}")
    def _list(
        search: str = "", top: int = Query(50, le=1000), fy: FinancialYear = Depends(get_history_fy), conn: Connection = Depends(get_conn),
        _: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_VIEW)),
    ):
        return hdd.list_recent(conn, spec, fy=fy, search=search, top=top)

    @router.get(base + "/{row_id}", name=f"get_{spec.short}")
    def _get(row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_VIEW))):
        return hdd.get(conn, spec, row_id)

    @router.post(base, status_code=201, name=f"create_{spec.short}")
    def _create(body: CreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_ADD))):
        with with_transaction() as conn:
            return hdd.create(conn, spec, fields=body.fields, lines=body.lines, doc_date=body.doc_date, fy=fy, user_code=user.user_code)

    @router.post(base + "/{row_id}/cancel", name=f"cancel_{spec.short}")
    def _cancel(row_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_EDIT))):
        with with_transaction() as conn:
            hdd.cancel(conn, spec, row_id=row_id, reason=body.reason, user_code=user.user_code)
        return {"message": f"Cancelled {spec.name} Successfully!"}

    @router.delete(base + "/{row_id}", name=f"delete_{spec.short}")
    def _delete(row_id: int, user: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_DELETE))):
        with with_transaction() as conn:
            hdd.delete(conn, spec, row_id=row_id, user_code=user.user_code)
        return {"message": f"Deleted {spec.name} Successfully!"}


for _spec in hdd.SPECS.values():
    _register(_spec)
