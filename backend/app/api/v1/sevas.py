"""Seva Entry endpoints — see app/services/seva.py for the write-set."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, get_current_user, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.api.v1.split_payments import SplitPartIn, ensure_ok, to_parts
from app.services import seva as seva_service

router = APIRouter(prefix="/sevas", tags=["sevas"])


class SevaDateIn(BaseModel):
    perform_date: date
    remarks: str = ""


class SevaCreateRequest(BaseModel):
    fields: dict  # Designer fields keyed by FldCode (the screen is rendered from UtlDocDsgrFlds)
    dates: list[SevaDateIn]
    doc_date: date
    regular: bool = False  # the "Regular Devotee" tick
    days_text: str = ""  # Date Text from the Dates Selection dialog
    rate: float | None = None  # the Rate box (blank = the Seva master's amount)
    amount: float | None = None  # the Amount box when typed (blank = Rate x number of dates)
    extra_seva_ids: list[int] = []  # more sevas for the same devotee: each becomes its own bill (create only)
    split_payments: list[SplitPartIn] | None = None  # the bill paid in parts by different modes (new table WebSplitPayment)


class CancelRequest(BaseModel):
    reason: str


@router.get("/devotee")
def devotee_lookup(mobile: str, name: str | None = None, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return seva_service.lookup_devotee(conn, mobile=mobile, name=name)


class GroupGenerateRequest(BaseModel):
    grp_id: int
    seva_id: int
    member_ids: list[int]
    fields: dict  # the entry form's Designer fields (payment, ledgers, ...) shared by every generated seva
    dates: list[SevaDateIn]
    doc_date: date


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
        fields={**body.fields, "SVAID": body.seva_id},
        dates=[seva_service.SevaDate(perform_date=d.perform_date, remarks=d.remarks) for d in body.dates],
        doc_date=body.doc_date,
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
    top: int = Query(50, le=1000),
    fy: FinancialYear = Depends(get_history_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW)),
):
    return seva_service.list_recent(conn, fy=fy, search=search, top=top)


@router.get("/next-no")
def next_no(
    sannidhi_id: int,
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_VIEW)),
):
    """The bill no the next save for this Sannidhi would get (a preview only: nothing is reserved)."""
    return seva_service.preview_no(conn, sannidhi_id=sannidhi_id, fy=fy)


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
        fields=body.fields,
        dates=[seva_service.SevaDate(perform_date=d.perform_date, remarks=d.remarks) for d in body.dates],
        doc_date=body.doc_date,
        regular=body.regular,
        days_text=body.days_text,
        rate=body.rate,
        amount=body.amount,
        split=to_parts(body.split_payments),
    )
    ensure_ok(data.split, bool(body.extra_seva_ids))
    with with_transaction() as conn:
        if body.extra_seva_ids:
            return {"bills": seva_service.create_many(conn, data=data, extra_seva_ids=body.extra_seva_ids, fy=fy, user_code=user.user_code)}
        return seva_service.create(conn, data=data, fy=fy, user_code=user.user_code)


@router.put("/{seva_id}")
def update_seva(
    seva_id: int,
    body: SevaCreateRequest,
    fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(seva_service.DOC_ID, RIGHT_EDIT)),
):
    data = seva_service.SevaInput(
        fields=body.fields,
        dates=[seva_service.SevaDate(perform_date=d.perform_date, remarks=d.remarks) for d in body.dates],
        doc_date=body.doc_date,
        regular=body.regular,
        days_text=body.days_text,
        rate=body.rate,
        amount=body.amount,
        split=to_parts(body.split_payments),
    )
    with with_transaction() as conn:
        return seva_service.update(conn, seva_id=seva_id, data=data, fy=fy, user_code=user.user_code)


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
