"""Seva Entry endpoints — see app/services/seva.py for the write-set."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import seva as seva_service

router = APIRouter(prefix="/sevas", tags=["sevas"])


class SevaDateIn(BaseModel):
    perform_date: date
    remarks: str = ""


class SevaCreateRequest(BaseModel):
    sannidhi_id: int
    seva_id: int
    mobile: str
    name: str
    name_kn: str | None = None
    gothra_id: int | None = None
    nakshatra_id: int | None = None
    rashi_id: int | None = None
    name2: str | None = None
    nakshatra2_id: int | None = None
    rashi2_id: int | None = None
    timing_text: str | None = None
    payment_mode: str
    bank_name: str | None = None
    cheque_no: str | None = None
    cheque_date: date | None = None
    reference_no: str | None = None
    address: str | None = None
    ledger_id: int
    cash_bank_ledger_id: int
    voucher_type: str
    rate: float
    dates: list[SevaDateIn]
    doc_date: date
    is_regular: bool = False
    prasada: bool = False
    add1: str | None = None
    add2: str | None = None
    add3: str | None = None
    add4: str | None = None
    mobile_no: str | None = None
    extra_fields: dict = {}


class CancelRequest(BaseModel):
    reason: str


@router.get("/devotee")
def devotee_lookup(mobile: str, name: str | None = None, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return seva_service.lookup_devotee(conn, mobile=mobile, name=name)


class GroupGenerateRequest(BaseModel):
    grp_id: int
    seva_id: int
    member_ids: list[int]
    # everything the entry form supplies for every generated seva
    payment_mode: str
    bank_name: str | None = None
    cheque_no: str | None = None
    cheque_date: date | None = None
    reference_no: str | None = None
    ledger_id: int
    cash_bank_ledger_id: int
    voucher_type: str
    timing_text: str | None = None
    dates: list[SevaDateIn]
    doc_date: date
    extra_fields: dict = {}


@router.get("/group-seva/groups")
def group_seva_groups(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW))):
    return seva_service.group_sevas(conn)


@router.get("/group-seva/{grp_id}/members")
def group_seva_members(grp_id: int, seva_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW))):
    return seva_service.group_members(conn, grp_id=grp_id, seva_id=seva_id)


@router.post("/group-seva/generate", status_code=201)
def group_seva_generate(
    body: GroupGenerateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_ADD)),
):
    template = seva_service.SevaInput(
        sannidhi_id=0, seva_id=body.seva_id, mobile="", name="", name_kn=None, gothra_id=None, nakshatra_id=None, rashi_id=None,
        name2=None, nakshatra2_id=None, rashi2_id=None, timing_text=body.timing_text, payment_mode=body.payment_mode, bank_name=body.bank_name,
        cheque_no=body.cheque_no, cheque_date=body.cheque_date, reference_no=body.reference_no, address=None, ledger_id=body.ledger_id,
        cash_bank_ledger_id=body.cash_bank_ledger_id, voucher_type=body.voucher_type, rate=0,
        dates=[seva_service.SevaDate(perform_date=d.perform_date, remarks=d.remarks) for d in body.dates],
        doc_date=body.doc_date, extra_fields=body.extra_fields,
    )
    with with_transaction() as conn:
        created = seva_service.generate_group(conn, grp_id=body.grp_id, seva_id=body.seva_id, member_ids=body.member_ids, template=template, fy=fy, user_code=user.user_code)
    return {"created": created}


@router.get("/regular-devotees")
def regular_devotees(name: str = "", top: int = Query(0, ge=0, le=500), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW))):
    return seva_service.regular_devotees(conn, name=name, top=top)


@router.get("/last")
def last_seva(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW))):
    return seva_service.last_entry(conn)


@router.get("")
def list_sevas(
    search: str = "",
    top: int = Query(50, le=200),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW)),
):
    return seva_service.list_recent(conn, fy=fy, search=search, top=top)


@router.get("/{seva_id}")
def get_seva(seva_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW))):
    return seva_service.get(conn, seva_id)


@router.post("", status_code=201)
def create_seva(
    body: SevaCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_ADD)),
):
    data = seva_service.SevaInput(
        **{**body.model_dump(exclude={"dates"}), "dates": [seva_service.SevaDate(perform_date=d.perform_date, remarks=d.remarks) for d in body.dates]}
    )
    with with_transaction() as conn:
        return seva_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.post("/{seva_id}/cancel")
def cancel_seva(seva_id: int, body: CancelRequest, user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        seva_service.cancel(conn, seva_id=seva_id, reason=body.reason, user_code=user.user_code)
    return {"message": "Cancelled Seva Entry Successfully!"}


@router.delete("/{seva_id}")
def delete_seva(seva_id: int, user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_DELETE))):
    with with_transaction() as conn:
        seva_service.delete(conn, seva_id=seva_id, user_code=user.user_code)
    return {"message": "Deleted Seva Entry Successfully!"}
