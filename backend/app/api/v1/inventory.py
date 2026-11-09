"""Inventory transaction endpoints — see app/services/inventory.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.fy import FinancialYear, get_user_fy, get_history_fy
from app.core.security import CurrentUser, get_current_user, require_right, require_right_for_form
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
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
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    doc_date: date
    lines: list[StockAdjustmentLineRequest]


@router.get("/stock-adjustments")
def list_stock_adjustments(
    top: int = Query(50, le=1000), fy: FinancialYear = Depends(get_history_fy), conn: Connection = Depends(get_conn),
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


@router.put("/stock-adjustments/{sa_id}")
def update_stock_adjustment(
    sa_id: int, body: StockAdjustmentCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_SA, RIGHT_EDIT)),
):
    values = body.model_dump()
    lines = [inv.StockAdjustmentLine(**l) for l in values.pop("lines")]
    data = inv.StockAdjustmentInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.update_stock_adjustment(conn, sa_id=sa_id, data=data, fy=fy, user_code=user.user_code)


@router.get("/stock-adjustments/{sa_id}")
def get_stock_adjustment(sa_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(inv.DOC_ID_SA, RIGHT_VIEW))):
    return inv.get_stock_adjustment(conn, sa_id=sa_id)


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
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    doc_date: date
    lines: list[StoreIssueLineRequest]


@router.get("/store-issues")
def list_store_issues(
    top: int = Query(50, le=1000), fy: FinancialYear = Depends(get_history_fy), conn: Connection = Depends(get_conn),
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


@router.put("/store-issues/{iss_id}")
def update_store_issue(
    iss_id: int, body: StoreIssueCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_ISS, RIGHT_EDIT)),
):
    values = body.model_dump()
    lines = [inv.StoreIssueLine(**l) for l in values.pop("lines")]
    data = inv.StoreIssueInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.update_store_issue(conn, iss_id=iss_id, data=data, fy=fy, user_code=user.user_code)


@router.get("/store-issues/{iss_id}")
def get_store_issue(iss_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(inv.DOC_ID_ISS, RIGHT_VIEW))):
    return inv.get_store_issue(conn, iss_id=iss_id)


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
    supp_id: int
    fields: dict  # Header / Footer Designer fields keyed by FldCode
    doc_date: date
    lines: list[PurchaseBillLineRequest]


@router.get("/purchase-bills")
def list_purchase_bills(
    top: int = Query(50, le=1000), fy: FinancialYear = Depends(get_history_fy), conn: Connection = Depends(get_conn),
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


@router.put("/purchase-bills/{pb_id}")
def update_purchase_bill(
    pb_id: int, body: PurchaseBillCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_PB, RIGHT_EDIT)),
):
    values = body.model_dump()
    lines = [inv.PurchaseBillLine(**l) for l in values.pop("lines")]
    data = inv.PurchaseBillInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.update_purchase_bill(conn, pb_id=pb_id, data=data, fy=fy, user_code=user.user_code)


@router.get("/purchase-bills/next-no")
def purchase_bill_next_no(conn: Connection = Depends(get_conn), fy: FinancialYear = Depends(get_user_fy), _: CurrentUser = Depends(require_right(inv.DOC_ID_PB, RIGHT_VIEW))):
    return inv.preview_purchase_bill_no(conn, fy=fy)


@router.get("/purchase-bills/{pb_id}")
def get_purchase_bill(pb_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(inv.DOC_ID_PB, RIGHT_VIEW))):
    return inv.get_purchase_bill(conn, pb_id=pb_id)


@router.get("/qoh")
def qoh(item_ids: str = Query(""), loc_id: int | None = Query(None), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Quantity on hand of the given items (comma separated ids), at one location or in total."""
    ids = [int(x) for x in item_ids.split(",") if x.strip().isdigit()]
    return inv.qoh_for_items(conn, item_ids=ids, loc_id=loc_id)


@router.get("/line-items")
def line_items(q: str = Query(""), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Item picker rows for transaction lines (code, name, UOM, standard rate)."""
    return inv.search_line_items(conn, q=q)


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
    fields: dict  # Header Designer fields keyed by FldCode
    lines: list[PurchaseVoucherLineRequest]
    pb_id: int | None = None


@router.get("/purchase-vouchers")
def list_purchase_vouchers(
    top: int = Query(50, le=1000), fy: FinancialYear = Depends(get_history_fy), conn: Connection = Depends(get_conn),
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


@router.put("/purchase-vouchers/{purvch_id}")
def update_purchase_voucher(
    purvch_id: int, body: PurchaseVoucherCreateRequest, fy: FinancialYear = Depends(get_user_fy),
    user: CurrentUser = Depends(require_right(inv.DOC_ID_PURVCH, RIGHT_EDIT)),
):
    values = body.model_dump()
    lines = [inv.PurchaseVoucherLine(**l) for l in values.pop("lines")]
    data = inv.PurchaseVoucherInput(**values, lines=lines)
    with with_transaction() as conn:
        return inv.update_purchase_voucher(conn, purvch_id=purvch_id, data=data, fy=fy, user_code=user.user_code)


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
def list_boms(top: int = Query(50, le=1000), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_VIEW))):
    return inv.list_boms(conn, top=top)


@router.post("/boms", status_code=201)
def create_bom(body: BomCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_ADD))):
    values = body.model_dump()
    components = [inv.BomComponent(**c) for c in values.pop("components")]
    data = inv.BomInput(**values, components=components)
    with with_transaction() as conn:
        return inv.create_bom(conn, data=data, fy=fy, user_code=user.user_code)


@router.get("/boms/{bom_id}")
def get_bom(bom_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_VIEW))):
    return inv.get_bom(conn, bom_id=bom_id)


@router.put("/boms/{bom_id}")
def update_bom(bom_id: int, body: BomCreateRequest, fy: FinancialYear = Depends(get_user_fy), user: CurrentUser = Depends(require_right(inv.DOC_ID_BOM, RIGHT_EDIT))):
    values = body.model_dump()
    components = [inv.BomComponent(**c) for c in values.pop("components")]
    data = inv.BomInput(**values, components=components)
    with with_transaction() as conn:
        return inv.update_bom(conn, bom_id=bom_id, data=data, fy=fy, user_code=user.user_code)


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
    _: CurrentUser = Depends(require_right_for_form("FRMUTLCURSTK", RIGHT_VIEW)),
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
    _: CurrentUser = Depends(require_right_for_form("Stock Balance Report", RIGHT_VIEW)),
):
    return inv.stock_balance_report(conn, as_of_date=as_of_date, loc_id=loc_id, item_group_id=item_group_id, item_code_like=item_code)


@router.get("/stock-ledger-report")
def stock_ledger_report(
    item_id: int = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
    loc_id: int | None = Query(None),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right_for_form("Stock Ledger Report", RIGHT_VIEW)),
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
    _: CurrentUser = Depends(require_right_for_form("Stock Ledger Report", RIGHT_VIEW)),
):
    from app.services import stock_reports

    ids = _csv_ints(item_ids)
    if group_ids:
        ids += stock_reports.items_in_groups(conn, _csv_ints(group_ids))
    return stock_reports.ledger(conn, fy=fy, from_date=from_date, to_date=to_date, item_ids=sorted(set(ids)), loc_id=loc_id)


# ---- Add Items (paste a list of item codes / saved item lists) - legacy frmUtlAddItems ----


class ValidateCodesBody(BaseModel):
    codes: list[str]


class SaveItemListBody(BaseModel):
    remarks: str = ""
    item_ids: list[int]


@router.get("/item-lists")
def item_lists(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import item_lists as il

    return {"available": il.available(), "names": il.list_names(conn)}


@router.post("/item-lists/validate")
def item_lists_validate(body: ValidateCodesBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import item_lists as il

    return il.validate_codes(conn, body.codes)


@router.get("/item-lists/{name}")
def item_list_load(name: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    from app.services import item_lists as il

    return il.load_list(conn, name)


@router.put("/item-lists/{name}")
def item_list_save(name: str, body: SaveItemListBody, _: CurrentUser = Depends(get_current_user)):
    from app.services import item_lists as il

    with with_transaction() as conn:
        n = il.save_list(conn, name, body.remarks, body.item_ids)
    return {"message": "Item list saved", "count": n}


@router.delete("/item-lists/{name}")
def item_list_remove(name: str, _: CurrentUser = Depends(get_current_user)):
    from app.services import item_lists as il

    with with_transaction() as conn:
        il.remove_list(conn, name)
    return {"message": "Item list deleted!"}


@router.get("/reports/stock-balance-docwise")
def stock_balance_docwise(
    from_date: date,
    to_date: date,
    item_ids: str | None = None,
    group_ids: str | None = None,
    loc_id: int | None = None,
    show_value: bool = False,
    hide_zero: bool = True,
    conn: Connection = Depends(get_conn),
    fy: FinancialYear = Depends(get_user_fy),
    _: CurrentUser = Depends(require_right_for_form("Stock Balance Report", RIGHT_VIEW)),
):
    """Stock Balance Report, "OP << document wise >> Balance" (legacy frmRptStockBal.ViewClDetailed)."""
    from app.services import stock_docwise

    return stock_docwise.balance_docwise(
        conn, fy=fy, from_date=from_date, to_date=to_date, loc_id=loc_id, item_ids=_csv_ints(item_ids) or None, group_ids=_csv_ints(group_ids) or None, show_value=show_value, hide_zero=hide_zero
    )


@router.get("/stock-rules")
def stock_rules(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Inventory > AllowNegative (legacy svtModule.CHKAllowNegativeStock): when 'N' a stock-out document cannot take more than the
    quantity on hand and its QOH column is shown; when 'Y' the QOH column is hidden and stock may go negative."""
    return {"allow_negative": inv.allow_negative_stock(conn)}


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
    _: CurrentUser = Depends(require_right_for_form("Stock Balance Report", RIGHT_VIEW)),
):
    from app.services import stock_reports

    return stock_reports.balance(
        conn, fy=fy, from_date=from_date, to_date=to_date, loc_id=loc_id, item_ids=_csv_ints(item_ids) or None, group_ids=_csv_ints(group_ids) or None, show_value=show_value, hide_zero=hide_zero
    )
