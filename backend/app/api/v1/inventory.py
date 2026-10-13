"""Inventory transaction endpoints — see app/services/inventory.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy
from app.core.security import CurrentUser, get_current_user, require_right
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_VIEW
from app.services import inventory as inv

router = APIRouter(prefix="/inventory", tags=["inventory"])


# ---- Stock Adjustment Entry ----


class StockAdjustmentLineRequest(BaseModel):
    item_id: int
    uom_id: int
    qty: float
    rate: float = 0
    adj_type: str = "Add"
    remarks: str = ""


class StockAdjustmentCreateRequest(BaseModel):
    loc_id: int
    adj_by: str
    remarks: str = ""
    doc_date: date
    lines: list[StockAdjustmentLineRequest]


@router.get("/stock-adjustments")
def list_stock_adjustments(
    top: int = Query(50, le=200), fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(inv.DOC_ID_SA, RIGHT_VIEW)),
):
    return inv.list_stock_adjustments(conn, fy=fy, top=top)


@router.post("/stock-adjustments", status_code=201)
def create_stock_adjustment(
    body: StockAdjustmentCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_SA, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [inv.StockAdjustmentLine(**l) for l in values.pop("lines")]
    data = inv.StockAdjustmentInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.create_stock_adjustment(conn, data=data, fy=fy, user_code=user.user_code)


@router.delete("/stock-adjustments/{sa_id}")
def delete_stock_adjustment(sa_id: int, user: CurrentUser = Depends(require_right(inv.DOC_ID_SA, RIGHT_DELETE))):
    with with_transaction() as conn:
        inv.delete_stock_adjustment(conn, sa_id=sa_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Store Issue Note ----


class StoreIssueLineRequest(BaseModel):
    item_id: int
    uom_id: int
    qty: float
    remarks: str = ""


class StoreIssueCreateRequest(BaseModel):
    loc_id: int
    issue_by: str
    remarks: str = ""
    doc_date: date
    lines: list[StoreIssueLineRequest]


@router.get("/store-issues")
def list_store_issues(
    top: int = Query(50, le=200), fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(inv.DOC_ID_ISS, RIGHT_VIEW)),
):
    return inv.list_store_issues(conn, fy=fy, top=top)


@router.post("/store-issues", status_code=201)
def create_store_issue(
    body: StoreIssueCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_ISS, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [inv.StoreIssueLine(**l) for l in values.pop("lines")]
    data = inv.StoreIssueInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.create_store_issue(conn, data=data, fy=fy, user_code=user.user_code)


@router.delete("/store-issues/{iss_id}")
def delete_store_issue(iss_id: int, user: CurrentUser = Depends(require_right(inv.DOC_ID_ISS, RIGHT_DELETE))):
    with with_transaction() as conn:
        inv.delete_store_issue(conn, iss_id=iss_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Purchase Bill ----


class PurchaseBillLineRequest(BaseModel):
    item_id: int
    uom_id: int
    qty: float
    rate: float


class PurchaseBillCreateRequest(BaseModel):
    loc_id: int
    supp_id: int
    ledid_pur: int
    ref_no: str = ""
    ref_date: date | None = None
    remarks: str = ""
    doc_date: date
    lines: list[PurchaseBillLineRequest]


@router.get("/purchase-bills")
def list_purchase_bills(
    top: int = Query(50, le=200), fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(inv.DOC_ID_PB, RIGHT_VIEW)),
):
    return inv.list_purchase_bills(conn, fy=fy, top=top)


@router.post("/purchase-bills", status_code=201)
def create_purchase_bill(
    body: PurchaseBillCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_PB, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [inv.PurchaseBillLine(**l) for l in values.pop("lines")]
    data = inv.PurchaseBillInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.create_purchase_bill(conn, data=data, fy=fy, user_code=user.user_code)


@router.delete("/purchase-bills/{pb_id}")
def delete_purchase_bill(pb_id: int, user: CurrentUser = Depends(require_right(inv.DOC_ID_PB, RIGHT_DELETE))):
    with with_transaction() as conn:
        inv.delete_purchase_bill(conn, pb_id=pb_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Purchase Voucher ----


class PurchaseVoucherLineRequest(BaseModel):
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


class PurchaseVoucherCreateRequest(BaseModel):
    voucher_date: date
    cr_period: int = 0
    lines: list[PurchaseVoucherLineRequest]
    pb_id: int | None = None


@router.get("/purchase-vouchers")
def list_purchase_vouchers(
    top: int = Query(50, le=200), fy: FinancialYear = Depends(get_user_fy), conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right(inv.DOC_ID_PURVCH, RIGHT_VIEW)),
):
    return inv.list_purchase_vouchers(conn, fy=fy, top=top)


@router.post("/purchase-vouchers", status_code=201)
def create_purchase_voucher(
    body: PurchaseVoucherCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_PURVCH, RIGHT_ADD)),
):
    values = body.model_dump()
    lines = [inv.PurchaseVoucherLine(**l) for l in values.pop("lines")]
    data = inv.PurchaseVoucherInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.create_purchase_voucher(conn, data=data, fy=fy, user_code=user.user_code)


@router.delete("/purchase-vouchers/{purvch_id}")
def delete_purchase_voucher(purvch_id: int, user: CurrentUser = Depends(require_right(inv.DOC_ID_PURVCH, RIGHT_DELETE))):
    with with_transaction() as conn:
        inv.delete_purchase_voucher(conn, purvch_id=purvch_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Bill of Material ----


class BomComponentRequest(BaseModel):
    item_id: int
    qty: float


class BomCreateRequest(BaseModel):
    bom_item_id: int
    eff_from: date
    eff_to: date | None = None
    remarks: str = ""
    components: list[BomComponentRequest]


@router.get("/boms")
def list_boms(top: int = Query(50, le=200), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_VIEW))):
    return inv.list_boms(conn, top=top)


@router.post("/boms", status_code=201)
def create_bom(body: BomCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_ADD))):
    values = body.model_dump()
    components = [inv.BomComponent(**c) for c in values.pop("components")]
    data = inv.BomInput(**values, components=components)
    with with_transaction() as conn:
        return inv.create_bom(conn, data=data, fy=fy, user_code=user.user_code)


@router.delete("/boms/{bom_id}")
def delete_bom(bom_id: int, user: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_DELETE))):
    with with_transaction() as conn:
        inv.delete_bom(conn, bom_id=bom_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Current Stock Balance (report) — port of frmRptCurStockBal ----


@router.get("/stock-balance")
def current_stock_balance(
    loc_id: int | None = Query(None),
    item_code: str | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return inv.current_stock_balance(conn, loc_id=loc_id, item_code_like=item_code)


# ---- Item Referencer / Where Used (report) — port of frmRptWhereUsed ----


@router.get("/where-used")
def where_used(item_id: int = Query(...), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return inv.where_used(conn, item_id=item_id)


# ---- Stock Balance Report / Stock Ledger Report — port of frmRptStockBal / frmRptStockLed ----


@router.get("/stock-balance-report")
def stock_balance_report(
    as_of_date: date = Query(...),
    loc_id: int | None = Query(None),
    item_group_id: int | None = Query(None),
    item_code: str | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return inv.stock_balance_report(conn, as_of_date=as_of_date, loc_id=loc_id, item_group_id=item_group_id, item_code_like=item_code)


@router.get("/stock-ledger-report")
def stock_ledger_report(
    item_id: int = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
    loc_id: int | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    return inv.stock_ledger_report(conn, item_id=item_id, loc_id=loc_id, from_date=from_date, to_date=to_date)


# ---- Item Quick Referencer / History — port of frmRptStkRef ----


@router.get("/item-referencer/items")
def referencer_items(q: str = Query(""), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import item_referencer

    return item_referencer.search_items(conn, q)


@router.get("/item-referencer/{item_id}")
def referencer_item(item_id: int, conn: Connection = Depends(get_conn), fy: FinancialYear = Depends(get_user_fy), _: CurrentUser = Depends(get_current_user)):
    from fastapi import HTTPException

    from app.services import item_referencer

    info = item_referencer.item_info(conn, item_id, fy)
    if info is None:
        raise HTTPException(404, "Item not found")
    return info


@router.get("/item-referencer/{item_id}/transactions")
def referencer_transactions(
    item_id: int,
    from_date: date = Query(...),
    to_date: date = Query(...),
    doc_name: str | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    from app.services import item_referencer

    return item_referencer.history(conn, item_id, from_date, to_date, doc_name)


# ---- Stock Ledger / Stock Balance (legacy frmRptStockLed / frmRptStockBal) ----


def _csv_ints(v: str | None) -> list[int]:
    return [int(x) for x in v.split(",") if x.strip().lstrip("-").isdigit()] if v else []


@router.get("/reports/lookups")
def stock_report_lookups(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import stock_reports

    return {"locations": stock_reports.locations(conn), "item_groups": stock_reports.item_groups(conn), **stock_reports.balance_info(conn)}


@router.get("/reports/stock-ledger")
def stock_ledger_multi(
    from_date: date,
    to_date: date,
    item_ids: str | None = None,
    group_ids: str | None = None,
    loc_id: int | None = None,
    conn: Connection = Depends(get_conn),
    fy: FinancialYear = Depends(get_user_fy),
    _: CurrentUser = Depends(get_current_user),
):
    from app.services import stock_reports

    ids = _csv_ints(item_ids)
    if group_ids:
        ids += stock_reports.items_in_groups(conn, _csv_ints(group_ids))
    return stock_reports.ledger(conn, fy=fy, from_date=from_date, to_date=to_date, item_ids=sorted(set(ids)), loc_id=loc_id)


@router.get("/reports/stock-balance")
def stock_balance_multi(
    from_date: date,
    to_date: date,
    item_ids: str | None = None,
    group_ids: str | None = None,
    loc_id: int | None = None,
    show_value: bool = False,
    hide_zero: bool = True,
    conn: Connection = Depends(get_conn),
    fy: FinancialYear = Depends(get_user_fy),
    _: CurrentUser = Depends(get_current_user),
):
    from app.services import stock_reports

    return stock_reports.balance(
        conn, fy=fy, from_date=from_date, to_date=to_date, loc_id=loc_id, item_ids=_csv_ints(item_ids) or None, group_ids=_csv_ints(group_ids) or None, show_value=show_value, hide_zero=hide_zero
    )
