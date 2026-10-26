"""Credit Note / Debit Note / Contra Voucher endpoints — one set per kind, see app/services/gen_voucher.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import gen_voucher as gv

router = APIRouter(tags=["vouchers"])


class LineRequest(BaseModel):
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


class CreateRequest(BaseModel):
    prefix: str = ""
    voucher_date: date
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    lines: list[LineRequest]


class CancelRequest(BaseModel):
    reason: str


def _register(spec: gv.Spec) -> None:
    base = f"/vouchers/{spec.kind}"

    @router.get(base, name=f"list_{spec.short}")
    def _list(
        search: str = "", top: int = Query(50, le=1000), fy: FinancialYear = Depends(get_history_fy), conn: Connection = Depends(get_conn),
        _: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_VIEW)),
    ):
        return gv.list_recent(conn, spec, fy=fy, search=search, top=top)

    @router.post(base, status_code=201, name=f"create_{spec.short}")
    def _create(body: CreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_ADD))):
        data = gv.VoucherInput(
            prefix=body.prefix, voucher_date=body.voucher_date, fields=body.fields,
            lines=[gv.VoucherLine(l.ac_led_id, l.dr_amt, l.cr_amt) for l in body.lines],
        )
        with with_transaction() as conn:
            return gv.create(conn, spec, data=data, fy=fy, user_code=user.user_code)

    @router.post(base + "/{voucher_id}/cancel", name=f"cancel_{spec.short}")
    def _cancel(voucher_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_EDIT))):
        with with_transaction() as conn:
            gv.cancel(conn, spec, voucher_id=voucher_id, reason=body.reason, user_code=user.user_code)
        return {"message": f"Cancelled {spec.name} Successfully!"}

    @router.delete(base + "/{voucher_id}", name=f"delete_{spec.short}")
    def _delete(voucher_id: int, user: CurrentUser = Depends(require_right(spec.doc_id, RIGHT_DELETE))):
        with with_transaction() as conn:
            gv.delete(conn, spec, voucher_id=voucher_id, user_code=user.user_code)
        return {"message": f"Deleted {spec.name} Successfully!"}


for _spec in gv.SPECS.values():
    _register(_spec)
