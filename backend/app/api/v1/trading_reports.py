"""Trading-module reports still listed in the legacy menu — see app/services/trading_reports.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user
from app.services import trading_reports as svc

router = APIRouter(prefix="/trade-reports", tags=["trade-reports"])


def _ints(csv: str | None) -> list[int] | None:
    return [int(x) for x in csv.split(",") if x.strip().lstrip("-").isdigit()] if csv else None


@router.get("/availability")
def availability(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.availability(conn)


@router.get("/stock-level/templates")
def stock_level_templates(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.stock_level_templates(conn)


@router.get("/stock-level")
def stock_level(
    template: str = Query(...),
    as_on: date = Query(...),
    fy: FinancialYear = Depends(get_user_fy),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return svc.stock_level_report(conn, template=template, as_on=as_on, fy_start=fy.start_date.date() if hasattr(fy.start_date, "date") else fy.start_date)


@router.get("/stock-ageing")
def stock_ageing(
    as_on: date = Query(...),
    ranges: str = Query(..., description="e.g. 0-30,31-60,61-90,91- (blank end = open-ended)"),
    item_group_ids: str | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    parsed: list[tuple[int, int | None]] = []
    for part in ranges.split(","):
        lo, _, hi = part.partition("-")
        if lo.strip().isdigit():
            parsed.append((int(lo), int(hi) if hi.strip().isdigit() else None))
    return svc.stock_ageing(conn, as_on=as_on, ranges=parsed, item_group_ids=_ints(item_group_ids))


@router.get("/party-outstanding")
def party_outstanding(
    party: str = Query("C", pattern="^[CS]$"),
    from_date: date = Query(...),
    to_date: date = Query(...),
    receivable: bool = Query(True),
    min_amount: float = Query(0),
    show_all_nonzero: bool = Query(False),
    group_ids: str | None = Query(None),
    ac_ids: str | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return svc.party_outstanding(
        conn, party=party, from_date=from_date, to_date=to_date, receivable=receivable,
        min_amount=min_amount, show_all_nonzero=show_all_nonzero, group_ids=_ints(group_ids), ac_ids=_ints(ac_ids),
    )


@router.get("/party-outstanding-detail")
def party_outstanding_detail(
    party: str = Query("C", pattern="^[CS]$"),
    to_date: date = Query(...),
    ac_ids: str | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return svc.party_outstanding_detail(conn, party=party, to_date=to_date, ac_ids=_ints(ac_ids))


@router.get("/sales/trips")
def sales_trips(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import sales_reports

    return sales_reports.trips(conn)


@router.get("/sales/daily")
def daily_sales(
    from_date: date,
    to_date: date,
    trip_no: str = "",
    by_user: bool = False,
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    from app.services import sales_reports

    return sales_reports.daily_sales(conn, d1=from_date, d2=to_date, trip=trip_no, by_user=by_user)


@router.get("/sales/product-summary")
def product_sales(
    from_date: date,
    to_date: date,
    trip_no: str = "",
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    from app.services import sales_reports

    return sales_reports.product_sales(conn, d1=from_date, d2=to_date, trip=trip_no)
