"""
Inventory transactions — Stock Adjustment Entry (DocID 1268), Store Issue
Note (1270), Purchase Bill (1271), Purchase Voucher (1272), Bill of
Material (1149). Confirmed zero real historical usage in this client's data
(every one of these 5 tables has 0 rows, 4 of 5 menu items are MenuShow='N')
— built anyway per explicit request, faithfully against the real schema and
the field-level designer metadata in `vTemple_Analysis/03_Data_Dictionary.md`
§DocID 1268/1270/1271, since there was no real data to reverse-engineer
conventions from (unlike every other document in this app).

Stock effect is recorded in `UtlStockList` (the legacy stock ledger table —
confirmed live in this DB, referenced by `getStockDetails`/`getPurchaseDetails`
stored procs): one row per item per document, `StkMultiplier` +1 inward
(Purchase Bill, Stock Adjustment "Add") or -1 outward (Store Issue, Stock
Adjustment "Reduce").

Purchase Bill does NOT auto-generate a Purchase Voucher — `TrnHdrPB.VCHID`
is a normal (nullable) forward-reference column, and `TrnHdrPURVCH` has no
narration/total columns of its own (they'd have to come from the linked
document), meaning the two are meant to be created and linked as separate
steps, not one atomic save — same shape as Hall Booking's manual
"Generate Voucher" panel, so we follow that same pattern here rather than
inventing an unverified auto-post convention.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row
from app.meta.numbering import next_doc_no
from app.services import ledger


def _post_stock(
    conn: Connection,
    *,
    doc_id: int,
    doc_name: str,
    doc_type: str,
    doc_no: str,
    doc_date: date,
    loc_id: int,
    lines: list[dict],  # {item_id, uom_id (unused by UtlStockList but kept for detail rows), qty, rate, multiplier}
) -> None:
    for i, line in enumerate(lines, start=1):
        insert_row(
            conn,
            "UtlStockList",
            {
                "UTDocID": doc_id,
                "DocID": doc_id,
                "DocName": doc_name,
                "DocType": doc_type,
                "DocNo": doc_no,
                "DocDate": doc_date,
                "ItemID": line["item_id"],
                "ItemSlno": i,
                "LocID": loc_id,
                "StkMultiplier": line["multiplier"],
                "Qty": line["qty"],
                "Rate": line.get("rate") or 0,
                "Particulars": doc_name,
                "ValuationReq": "Y",
                "StkRate": line.get("rate") or 0,
                "ReVal": "N",
                "DelFlag": "N",
            },
        )


# ---------------------------------------------------------------- Stock Adjustment Entry (1268)

DOC_ID_SA = 1268
PREFIX_SA = "SA"


@dataclass
class StockAdjustmentLine:
    item_id: int
    uom_id: int
    qty: float
    rate: float = 0
    adj_type: str = "Add"  # "Add" | "Reduce"
    remarks: str = ""


@dataclass
class StockAdjustmentInput:
    loc_id: int
    adj_by: str
    remarks: str
    doc_date: date
    lines: list[StockAdjustmentLine]


def create_stock_adjustment(conn: Connection, *, data: StockAdjustmentInput, fy: FinancialYear, user_code: str) -> dict:
    assert_date_in_fy(data.doc_date, fy)
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one item line")
    for l in data.lines:
        if l.qty <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
        if l.adj_type not in ("Add", "Reduce"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Adjust type must be Add or Reduce")

    doc_no = next_doc_no(
        conn, table_name="TrnHdrSA", no_column="SANO", prefix=PREFIX_SA,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    total_qty = sum(l.qty for l in data.lines)

    sa_id = insert_row(
        conn, "TrnHdrSA",
        {
            "SANO": doc_no, "Prefix": PREFIX_SA, "PrintSANO": doc_no, "SADate": data.doc_date,
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "LOCID": data.loc_id, "RMKS": data.remarks, "TOTQTY": total_qty, "ADJBY": data.adj_by,
        },
        returning="SAID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn, "TrnDtlSA",
            {
                "SAID": sa_id, "SlNo": i, "ItemSlNO": i, "ITEMID": l.item_id, "UOMID": l.uom_id,
                "ShortClosed": "N", "ShortClosedBy": 0, "StkQty": l.qty, "SAQty": l.qty, "SARate": l.rate,
                "SAAmt": round(l.qty * l.rate, 2), "ADJTYPE": l.adj_type, "DRMKS": l.remarks,
            },
        )

    _post_stock(
        conn, doc_id=DOC_ID_SA, doc_name="Stock Adjustment Entry", doc_type="SA", doc_no=doc_no, doc_date=data.doc_date,
        loc_id=data.loc_id,
        lines=[{"item_id": l.item_id, "qty": l.qty, "rate": l.rate, "multiplier": 1 if l.adj_type == "Add" else -1} for l in data.lines],
    )
    audit.record(conn, entity="Stock Adjustment Entry", entity_id=sa_id, action="A", user_code=user_code, details=doc_no)
    return {"sa_id": sa_id, "sa_no": doc_no, "total_qty": total_qty}


def list_stock_adjustments(conn: Connection, *, fy: FinancialYear, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT SAID, SANO, PrintSANO, SADate, RMKS, ADJBY, TOTQTY, Cancelled FROM TrnHdrSA WHERE SADate BETWEEN :fs AND :fe ORDER BY SAID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), {"fs": fy.start_date, "fe": fy.end_date}).mappings().all()
    return [dict(r) for r in rows]


def delete_stock_adjustment(conn: Connection, *, sa_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT SANO FROM TrnHdrSA WHERE SAID = :id"), {"id": sa_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stock Adjustment not found")
    conn.execute(text("DELETE FROM UtlStockList WHERE DocID = :d AND DocNo = :n"), {"d": DOC_ID_SA, "n": row["SANO"]})
    conn.execute(text("DELETE FROM TrnDtlSA WHERE SAID = :id"), {"id": sa_id})
    conn.execute(text("DELETE FROM TrnHdrSA WHERE SAID = :id"), {"id": sa_id})
    audit.record(conn, entity="Stock Adjustment Entry", entity_id=sa_id, action="D", user_code=user_code)


# ---------------------------------------------------------------- Store Issue Note (1270)

DOC_ID_ISS = 1270
PREFIX_ISS = "ISS"


@dataclass
class StoreIssueLine:
    item_id: int
    uom_id: int
    qty: float
    remarks: str = ""


@dataclass
class StoreIssueInput:
    loc_id: int
    issue_by: str
    remarks: str
    doc_date: date
    lines: list[StoreIssueLine]


def create_store_issue(conn: Connection, *, data: StoreIssueInput, fy: FinancialYear, user_code: str) -> dict:
    assert_date_in_fy(data.doc_date, fy)
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one item line")
    for l in data.lines:
        if l.qty <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    doc_no = next_doc_no(
        conn, table_name="TrnHdrISS", no_column="ISSNO", prefix=PREFIX_ISS,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    total_qty = sum(l.qty for l in data.lines)

    iss_id = insert_row(
        conn, "TrnHdrISS",
        {
            "ISSNO": doc_no, "Prefix": PREFIX_ISS, "PrintISSNO": doc_no, "ISSDate": data.doc_date,
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "LOCID": data.loc_id, "RMKS": data.remarks, "TOTQTY": total_qty, "ISSUEBY": data.issue_by,
        },
        returning="ISSID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn, "TrnDtlISS",
            {
                "ISSID": iss_id, "SlNo": i, "ItemSlNO": i, "ITEMID": l.item_id, "UOMID": l.uom_id,
                "ShortClosed": "N", "ShortClosedBy": 0, "StkQty": l.qty, "ISSQty": l.qty, "DRMKS": l.remarks,
            },
        )

    _post_stock(
        conn, doc_id=DOC_ID_ISS, doc_name="Store Issue Note", doc_type="ISS", doc_no=doc_no, doc_date=data.doc_date,
        loc_id=data.loc_id, lines=[{"item_id": l.item_id, "qty": l.qty, "multiplier": -1} for l in data.lines],
    )
    audit.record(conn, entity="Store Issue Note", entity_id=iss_id, action="A", user_code=user_code, details=doc_no)
    return {"iss_id": iss_id, "iss_no": doc_no, "total_qty": total_qty}


def list_store_issues(conn: Connection, *, fy: FinancialYear, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT ISSID, ISSNO, PrintISSNO, ISSDate, RMKS, ISSUEBY, TOTQTY, Cancelled FROM TrnHdrISS WHERE ISSDate BETWEEN :fs AND :fe ORDER BY ISSID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), {"fs": fy.start_date, "fe": fy.end_date}).mappings().all()
    return [dict(r) for r in rows]


def delete_store_issue(conn: Connection, *, iss_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT ISSNO FROM TrnHdrISS WHERE ISSID = :id"), {"id": iss_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store Issue Note not found")
    conn.execute(text("DELETE FROM UtlStockList WHERE DocID = :d AND DocNo = :n"), {"d": DOC_ID_ISS, "n": row["ISSNO"]})
    conn.execute(text("DELETE FROM TrnDtlISS WHERE ISSID = :id"), {"id": iss_id})
    conn.execute(text("DELETE FROM TrnHdrISS WHERE ISSID = :id"), {"id": iss_id})
    audit.record(conn, entity="Store Issue Note", entity_id=iss_id, action="D", user_code=user_code)


# ---------------------------------------------------------------- Purchase Bill (1271)

DOC_ID_PB = 1271
PREFIX_PB = "PB"


@dataclass
class PurchaseBillLine:
    item_id: int
    uom_id: int
    qty: float
    rate: float


@dataclass
class PurchaseBillInput:
    loc_id: int
    supp_id: int
    ledid_pur: int
    ref_no: str
    ref_date: date | None
    remarks: str
    doc_date: date
    lines: list[PurchaseBillLine]


def create_purchase_bill(conn: Connection, *, data: PurchaseBillInput, fy: FinancialYear, user_code: str) -> dict:
    assert_date_in_fy(data.doc_date, fy)
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one item line")
    for l in data.lines:
        if l.qty <= 0 or l.rate <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    supp = conn.execute(
        text("SELECT SUPPNAME, BAdd1, BAdd2, City, State, PinCode, Country FROM MstSUPP WHERE SUPPID = :id"),
        {"id": data.supp_id},
    ).mappings().first()

    doc_no = next_doc_no(
        conn, table_name="TrnHdrPB", no_column="PBNO", prefix=PREFIX_PB,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    total_qty = sum(l.qty for l in data.lines)
    pb_value = round(sum(l.qty * l.rate for l in data.lines), 2)

    pb_id = insert_row(
        conn, "TrnHdrPB",
        {
            "PBNO": doc_no, "Prefix": PREFIX_PB, "PrintPBNO": doc_no, "PBDate": data.doc_date,
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "SUPPID": data.supp_id,
            "PartyName": supp["SUPPNAME"] if supp else "",
            "PartyAdd1": supp["BAdd1"] if supp else "",
            "PartyAdd2": supp["BAdd2"] if supp else "",
            "PartyCity": supp["City"] if supp else "",
            "PartyState": supp["State"] if supp else "",
            "PartyPinCode": supp["PinCode"] if supp else "",
            "PartyCountry": supp["Country"] if supp else "",
            "LOCID": data.loc_id, "LEDIDPUR": data.ledid_pur, "TOTQTY": total_qty, "PBVALUE": pb_value,
            "RMKS": data.remarks, "REFNO": data.ref_no, "REFDT": data.ref_date, "ISSUEDBY": user_code,
        },
        returning="PBID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn, "TrnDtlPB",
            {
                "PBID": pb_id, "SlNo": i, "ItemSlNO": i, "ITEMID": l.item_id, "UOMID": l.uom_id,
                "ShortClosed": "N", "ShortClosedBy": 0, "StkQty": l.qty, "PBQty": l.qty, "PBRate": l.rate,
                "PBAmt": round(l.qty * l.rate, 2),
            },
        )

    _post_stock(
        conn, doc_id=DOC_ID_PB, doc_name="Purchase Bill", doc_type="PB", doc_no=doc_no, doc_date=data.doc_date,
        loc_id=data.loc_id,
        lines=[{"item_id": l.item_id, "qty": l.qty, "rate": l.rate, "multiplier": 1} for l in data.lines],
    )
    audit.record(conn, entity="Purchase Bill", entity_id=pb_id, action="A", user_code=user_code, details=doc_no)
    return {"pb_id": pb_id, "pb_no": doc_no, "total_qty": total_qty, "pb_value": pb_value}


def list_purchase_bills(conn: Connection, *, fy: FinancialYear, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT PBID, PBNO, PrintPBNO, PBDate, PartyName, TOTQTY, PBVALUE, VCHID, Cancelled FROM TrnHdrPB WHERE PBDate BETWEEN :fs AND :fe ORDER BY PBID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), {"fs": fy.start_date, "fe": fy.end_date}).mappings().all()
    return [dict(r) for r in rows]


def delete_purchase_bill(conn: Connection, *, pb_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT PBNO FROM TrnHdrPB WHERE PBID = :id"), {"id": pb_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase Bill not found")
    conn.execute(text("DELETE FROM UtlStockList WHERE DocID = :d AND DocNo = :n"), {"d": DOC_ID_PB, "n": row["PBNO"]})
    conn.execute(text("DELETE FROM TrnDtlPB WHERE PBID = :id"), {"id": pb_id})
    conn.execute(text("DELETE FROM TrnHdrPB WHERE PBID = :id"), {"id": pb_id})
    audit.record(conn, entity="Purchase Bill", entity_id=pb_id, action="D", user_code=user_code)


# ---------------------------------------------------------------- Purchase Voucher (1272)

DOC_ID_PURVCH = 1272
PREFIX_PURVCH = ""  # confirmed: the one real UtlDocNoPrefix row for this doc has an empty prefix


@dataclass
class PurchaseVoucherLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


@dataclass
class PurchaseVoucherInput:
    voucher_date: date
    cr_period: int  # credit period in days
    lines: list[PurchaseVoucherLine]
    pb_id: int | None = None  # optional link to the Purchase Bill this accounts for


def create_purchase_voucher(conn: Connection, *, data: PurchaseVoucherInput, fy: FinancialYear, user_code: str) -> dict:
    assert_date_in_fy(data.voucher_date, fy)
    if len(data.lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)
    if total_dr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")

    doc_no = next_doc_no(
        conn, table_name="TrnHdrPURVCH", no_column="PURVCHNO", prefix=PREFIX_PURVCH,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )

    purvch_id = insert_row(
        conn, "TrnHdrPURVCH",
        {
            "PURVCHNO": doc_no, "Prefix": PREFIX_PURVCH, "PrintPURVCHNO": doc_no, "PURVCHDate": data.voucher_date,
            "Authorised": "Y", "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "CRPERIOD": data.cr_period, "TRNTYPE": "PB" if data.pb_id else "PURVCH", "TRNID": data.pb_id or 0,
        },
        returning="PURVCHID",
    )
    for i, l in enumerate(data.lines, start=1):
        insert_row(
            conn, "TrnDtlPURVCH",
            {
                "PURVCHID": purvch_id, "SlNo": i, "AcLedID": l.ac_led_id, "PURVCHAmt": l.dr_amt or l.cr_amt,
                "CrAmt": l.cr_amt, "DrAmt": l.dr_amt, "AmtType": "DR" if l.dr_amt else "CR", "AgRefAmt": 0, "NewRefAmt": 0,
            },
        )

    if data.pb_id:
        conn.execute(text("UPDATE TrnHdrPB SET VCHID = :v WHERE PBID = :id"), {"v": purvch_id, "id": data.pb_id})

    ledger.post(
        conn, doc_type="PURVCH", trn_id=purvch_id, trn_no=doc_no, trn_date=data.voucher_date, due_date=data.voucher_date,
        narration=f"Purchase Voucher {doc_no}",
        lines=[
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt)
            for l in data.lines
        ],
    )

    audit.record(conn, entity="Purchase Voucher", entity_id=purvch_id, action="A", user_code=user_code, details=doc_no)
    return {"purvch_id": purvch_id, "purvch_no": doc_no, "amount": total_dr}


def list_purchase_vouchers(conn: Connection, *, fy: FinancialYear, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT PURVCHID, PURVCHNO, PrintPURVCHNO, PURVCHDate, CRPERIOD, Cancelled FROM TrnHdrPURVCH WHERE PURVCHDate BETWEEN :fs AND :fe ORDER BY PURVCHID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), {"fs": fy.start_date, "fe": fy.end_date}).mappings().all()
    return [dict(r) for r in rows]


def delete_purchase_voucher(conn: Connection, *, purvch_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT PURVCHNO FROM TrnHdrPURVCH WHERE PURVCHID = :id"), {"id": purvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase Voucher not found")
    ledger.delete_posting(conn, doc_type="PURVCH", trn_no=row["PURVCHNO"], trn_id=purvch_id)
    conn.execute(text("UPDATE TrnHdrPB SET VCHID = NULL WHERE VCHID = :id"), {"id": purvch_id})
    conn.execute(text("DELETE FROM TrnDtlPURVCH WHERE PURVCHID = :id"), {"id": purvch_id})
    conn.execute(text("DELETE FROM TrnHdrPURVCH WHERE PURVCHID = :id"), {"id": purvch_id})
    audit.record(conn, entity="Purchase Voucher", entity_id=purvch_id, action="D", user_code=user_code)


# ---------------------------------------------------------------- Bill of Material (1149)

DOC_ID_BOM = 1149
PREFIX_BOM = "BOM"  # no UtlDocNoPrefix row exists for this doc — fixed prefix, no real usage to confirm otherwise


@dataclass
class BomComponent:
    item_id: int
    qty: float


@dataclass
class BomInput:
    bom_item_id: int  # the finished item this recipe produces
    eff_from: date
    eff_to: date | None
    remarks: str
    components: list[BomComponent]


def create_bom(conn: Connection, *, data: BomInput, fy: FinancialYear, user_code: str) -> dict:
    assert_date_in_fy(data.eff_from, fy)
    if not data.components:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one component")
    for c in data.components:
        if c.qty <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    doc_no = next_doc_no(
        conn, table_name="MstHdrBOM", no_column="BOMNO", prefix=PREFIX_BOM,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )

    bom_id = insert_row(
        conn, "MstHdrBOM",
        {
            "BOMNO": doc_no, "Prefix": PREFIX_BOM, "PrintBOMNO": doc_no, "BOMDate": data.eff_from,
            "Authorised": "Y", "AuthBy": user_code, "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "BOMItemID": data.bom_item_id, "EffFrom": data.eff_from, "EffTo": data.eff_to,
            "LatestBOM": "Y", "HRMKS": data.remarks,
        },
        returning="BOMID",
    )
    for i, c in enumerate(data.components, start=1):
        insert_row(conn, "MstDtlBOM", {"BOMID": bom_id, "SlNo": i, "ITEMID": c.item_id, "Qty": c.qty})

    audit.record(conn, entity="Bill of Material", entity_id=bom_id, action="A", user_code=user_code, details=doc_no)
    return {"bom_id": bom_id, "bom_no": doc_no}


def list_boms(conn: Connection, *, top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = f"SELECT BOMID, BOMNO, PrintBOMNO, BOMDate, BOMItemID, EffFrom, EffTo, LatestBOM, Cancelled FROM MstHdrBOM ORDER BY BOMID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql)).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- Current Stock Balance (report)
#
# Port of frmRptCurStockBal — reads TrnQOH (ITEMID, LOCID, CLBal), the
# legacy app's running closing-balance table, one row per item per
# location. Zero real rows in this client's data (same as every table in
# this module, see module docstring) but the join is schema-verified.


def current_stock_balance(conn: Connection, *, loc_id: int | None = None, item_code_like: str | None = None) -> list[dict]:
    where = ["q.CLBal <> 0"]
    params: dict = {}
    if loc_id:
        where.append("q.LOCID = :loc_id")
        params["loc_id"] = loc_id
    if item_code_like:
        where.append("i.ITEMCODE LIKE :code")
        params["code"] = f"%{item_code_like}%"

    sql = f"""
        SELECT i.ITEMCODE AS item_code, i.ITEMNAME AS item_name, u.UOMCODE AS uom_code,
               l.LOCCODE AS loc_code, l.LOCNAME AS loc_name, q.CLBal AS balance
        FROM TrnQOH q
        JOIN MstItem i ON i.ITEMID = q.ITEMID
        JOIN MstLOC l ON l.LOCID = q.LOCID
        LEFT JOIN MstUOM u ON u.UOMID = i.UOMID
        WHERE {' AND '.join(where)}
        ORDER BY i.ITEMCODE, l.LOCCODE
    """
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


# ---------------------------------------------------------------- Item Referencer / Where Used (report)
#
# Port of frmRptWhereUsed — given a raw-material/component item, lists
# every Bill of Material it's used in (MstHdrBOM/MstDtlBOM), with the
# finished item it goes into and the quantity per unit. Zero real BOM
# rows in this client's data (see module docstring) but schema-verified.


def where_used(conn: Connection, *, item_id: int) -> list[dict]:
    sql = """
        SELECT h.BOMNO AS bom_no, h.BOMDate AS bom_date,
               fg.ITEMCODE AS finished_item_code, fg.ITEMNAME AS finished_item_name,
               d.Qty AS qty_per_unit, u.UOMCODE AS uom_code, h.LatestBOM AS latest
        FROM MstDtlBOM d
        JOIN MstHdrBOM h ON h.BOMID = d.BOMID
        JOIN MstItem fg ON fg.ITEMID = h.BOMItemID
        LEFT JOIN MstUOM u ON u.UOMID = fg.UOMID
        WHERE d.ITEMID = :item_id AND h.Cancelled = 'N'
        ORDER BY h.BOMDate DESC
    """
    return [dict(r) for r in conn.execute(text(sql), {"item_id": item_id}).mappings().all()]


# ---------------------------------------------------------------- Stock Balance Report / Stock Ledger Report
#
# Port of frmRptStockBal / frmRptStockLed — confirmed real, distinct legacy
# forms (not ad-hoc admin-SQL templates like the Stock Level Report family
# deferred earlier). Both read UtlStockList, the same stock ledger table
# inventory.py's own transactions post to. Zero real rows in this client's
# data today (see module docstring) but schema- and logic-verified.


def stock_balance_report(
    conn: Connection, *, as_of_date, loc_id: int | None = None, item_group_id: int | None = None, item_code_like: str | None = None
) -> list[dict]:
    """As-of-date balance per item (+ location), with the last recorded
    inward rate (legacy's fallback valuation path when "Standard Rate" isn't
    used — see frmRptStockBal's `Rate` subquery: last StkMultiplier=1 row
    where ValuationReq='N')."""
    where = ["s.DocDate <= :as_of", "s.DelFlag = 'N'"]
    params: dict = {"as_of": as_of_date}
    if loc_id:
        where.append("s.LOCID = :loc_id")
        params["loc_id"] = loc_id
    if item_group_id:
        where.append("i.ITEMGroupID = :grp_id")
        params["grp_id"] = item_group_id
    if item_code_like:
        where.append("i.ITEMCODE LIKE :code")
        params["code"] = f"%{item_code_like}%"

    sql = f"""
        SELECT g.ITEMGROUPNAME AS item_group, i.ITEMCODE AS item_code, i.ITEMNAME AS item_name, u.UOMCODE AS uom_code,
               SUM(s.StkMultiplier * s.Qty) AS balance,
               ISNULL((SELECT TOP 1 r.Rate FROM UtlStockList r
                       WHERE r.ITEMID = i.ITEMID AND r.StkMultiplier = 1 AND r.ValuationReq = 'N' AND r.DocDate <= :as_of
                       ORDER BY r.DocDate DESC, r.RowID DESC), 0) AS rate
        FROM UtlStockList s
        JOIN MstItem i ON i.ITEMID = s.ItemID
        LEFT JOIN MstItemGroup g ON g.ITEMGROUPID = i.ITEMGroupID
        LEFT JOIN MstUOM u ON u.UOMID = i.UOMID
        WHERE {' AND '.join(where)}
        GROUP BY g.ITEMGROUPNAME, i.ITEMID, i.ITEMCODE, i.ITEMNAME, u.UOMCODE
        HAVING SUM(s.StkMultiplier * s.Qty) <> 0
        ORDER BY i.ITEMCODE
    """
    rows = conn.execute(text(sql), params).mappings().all()
    return [{**dict(r), "value": round(float(r["balance"]) * float(r["rate"]), 2)} for r in rows]


def stock_ledger_report(conn: Connection, *, item_id: int, loc_id: int | None, from_date, to_date) -> list[dict]:
    """Transaction-by-transaction movement for one item, with a running
    balance (SQL Server windowed SUM — supported since 2012, CLAUDE.md's
    "2014-compatible SQL" ceiling)."""
    where = ["s.ItemID = :item_id", "s.DocDate BETWEEN :fs AND :fe", "s.DelFlag = 'N'"]
    params: dict = {"item_id": item_id, "fs": from_date, "fe": to_date}
    if loc_id:
        where.append("s.LOCID = :loc_id")
        params["loc_id"] = loc_id

    sql = f"""
        SELECT s.DocDate AS doc_date, s.DocType AS doc_type, s.DocName AS doc_name, s.DocNo AS doc_no,
               s.Particulars AS particulars,
               CASE WHEN s.StkMultiplier > 0 THEN s.Qty ELSE 0 END AS in_qty,
               CASE WHEN s.StkMultiplier < 0 THEN s.Qty ELSE 0 END AS out_qty,
               SUM(s.StkMultiplier * s.Qty) OVER (ORDER BY s.DocDate, s.RowID ROWS UNBOUNDED PRECEDING) AS running_balance
        FROM UtlStockList s
        WHERE {' AND '.join(where)}
        ORDER BY s.DocDate, s.RowID
    """
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def delete_bom(conn: Connection, *, bom_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT BOMID FROM MstHdrBOM WHERE BOMID = :id"), {"id": bom_id}).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bill of Material not found")
    conn.execute(text("DELETE FROM MstDtlBOM WHERE BOMID = :id"), {"id": bom_id})
    conn.execute(text("DELETE FROM MstHdrBOM WHERE BOMID = :id"), {"id": bom_id})
    audit.record(conn, entity="Bill of Material", entity_id=bom_id, action="D", user_code=user_code)
