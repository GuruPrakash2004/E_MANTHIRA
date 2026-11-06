"""Voucher Listing and Day Book (legacy frmRptVoucherList / FrmRptDayBook). Read-only. The legacy menu rows carry no form name,
so rights come from the row's caption."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, require_right_for_form
from app.meta.menu import RIGHT_VIEW
from app.services import acc_reports as svc
from app.services import profit_margin as pm

router = APIRouter(prefix="/acc-reports", tags=["acc-reports"])

_vl = require_right_for_form(svc.REPORT_VOUCHER, RIGHT_VIEW, by="caption")
_db = require_right_for_form(svc.REPORT_DAYBOOK, RIGHT_VIEW, by="caption")
_pm = require_right_for_form(pm.REPORT, RIGHT_VIEW, by="caption")


class VoucherListingBody(BaseModel):
    doc_id: int
    start: date | None = None
    end: date | None = None
    ledger_ids: list[int] = []
    prefix: str = ""
    fields: list[str] = []


class DayBookBody(BaseModel):
    start: date
    end: date
    mode: str = ""


@router.get("/voucher-listing/options")
def vl_options(fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_vl)):
    return {**svc.voucher_options(conn), "fy": {"from": fy.start_date.isoformat(), "to": fy.end_date.isoformat()}}


@router.get("/voucher-listing/docs/{doc_id}")
def vl_doc(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_vl)):
    return svc.voucher_doc_info(conn, doc_id)


@router.get("/voucher-listing/ledgers")
def vl_ledgers(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_vl)):
    return svc.ledgers(conn, search)


@router.post("/voucher-listing/run")
def vl_run(body: VoucherListingBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_vl)):
    return svc.voucher_listing(conn, doc_id=body.doc_id, start=body.start, end=body.end, ledger_ids=body.ledger_ids, prefix=body.prefix, fields=body.fields)


@router.get("/day-book/options")
def db_options(fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_db)):
    return {**svc.daybook_options(conn), "fy": {"from": fy.start_date.isoformat(), "to": fy.end_date.isoformat()}}


@router.post("/day-book/run")
def db_run(body: DayBookBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_db)):
    return svc.day_book(conn, start=body.start, end=body.end, mode=body.mode)


class ProfitMarginBody(BaseModel):
    doc_id: int
    start: date
    end: date
    item_id: int | None = None


@router.get("/profit-margin/definitions")
def pm_definitions(fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_pm)):
    return {**pm.definitions(conn), "fy": {"from": fy.start_date.isoformat(), "to": fy.end_date.isoformat()}}


@router.get("/profit-margin/items")
def pm_items(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_pm)):
    return pm.items(conn, search)


@router.post("/profit-margin/run")
def pm_run(body: ProfitMarginBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(_pm)):
    return pm.run(conn, doc_id=body.doc_id, start=body.start, end=body.end, item_id=body.item_id)
