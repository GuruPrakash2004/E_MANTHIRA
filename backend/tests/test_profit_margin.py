"""Profit Margin on SYNTHETIC definitions and sales / purchase tables, all created inside a transaction that is always rolled back."""
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.services import profit_margin as pm


@pytest.fixture()
def conn():
    c = get_engine().connect()
    tx = c.begin()
    try:
        miss = pm._missing(c)
        if miss:
            pytest.skip(f"this database lacks {miss}")
        c.execute(text("CREATE TABLE ZtSale (SaleNo varchar(20), SaleDate smalldatetime, ItemID int, Qty numeric(18,2), Rate numeric(18,2), Value numeric(18,2), PurRate numeric(18,2), PurValue numeric(18,2))"))
        c.execute(text("CREATE TABLE ZtPurchase (PurNo varchar(20), PurDate smalldatetime, ItemID int, PRate numeric(18,2), PValue numeric(18,2))"))
        c.execute(text("INSERT INTO ZtSale VALUES ('S1','2031-01-10',1,10,50,500,30,300), ('S2','2031-01-20',1,5,60,300,30,150), ('S3','2031-02-03',2,4,100,400,70,280), ('S4','2030-12-31',1,1,50,50,30,30)"))
        c.execute(text("INSERT INTO ZtPurchase VALUES ('P1','2030-12-01',1,20,200), ('P2','2030-12-15',1,40,400), ('P3','2030-12-20',2,80,320)"))
        yield c
    finally:
        tx.rollback()
        c.close()


def _define(c, slot, name, rate_type, cond="and ZtSale.SaleDate between @FROMDATE and @TODATE and ZtSale.ItemID in (@ID)", pur_cond=""):
    doc_id = int(c.execute(text("INSERT INTO UtlProfitMargin (DocName, RateType, CondText) OUTPUT inserted.DocID VALUES (:n, :r, '')"), {"n": name, "r": rate_type}).scalar())
    base = {"DocID": doc_id, "DocType": "SALES", "FldNoText": "Bill No", "FldNoTbl": "ZtSale", "FldNo": "SaleNo", "FldDateText": "Bill Date", "FldDateTbl": "ZtSale", "FldDate": "SaleDate",
            "FldItemText": "Item", "FldItemTbl": "ZtSale", "FldItem": "ItemID", "FldSQtyText": "Qty", "FldSQtyTbl": "ZtSale", "FldSQty": "Qty",
            "FldSRateText": "Sale Rate", "FldSRateTbl": "ZtSale", "FldSRate": "Rate", "FldSValueText": "Sale Value", "FldSValueTbl": "ZtSale", "FldSValue": "Value", "FldCond": cond}
    if rate_type == "STANDARD RATE":
        base.update({"FldPRText": "x", "FldPRTbl": "ZtSale", "FldPR": "PurRate", "FldPRVText": "y", "FldPRVTbl": "ZtSale", "FldPRV": "PurValue"})
    _insert(c, "UtlProfitDtlFlds", {**base, "Slno": 1})
    if rate_type == "AVG RATE":
        _insert(c, "UtlProfitDtlFlds", {"DocID": doc_id, "Slno": 2, "DocType": "PURCHASE", "FldItemText": "Item", "FldItemTbl": "ZtPurchase", "FldItem": "ItemID",
                                        "FldPRTbl": "ZtPurchase", "FldPR": "PRate", "FldPRVTbl": "ZtPurchase", "FldPRV": "PValue", "FldCond": pur_cond})
    return doc_id


def _insert(c, table, row):
    cols = {r[0] for r in c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"), {"t": table})}
    row = {k: v for k, v in row.items() if k in cols}
    c.execute(text(f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join(':' + k for k in row)})"), row)


def _by_no(res):
    return {r["Bill No"]: r for r in res["rows"]}


def test_standard_rate_difference_and_item_and_date_filters(conn):
    d = _define(conn, 1, "Margin Std", "STANDARD RATE")
    r = pm.run(conn, doc_id=d, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=1)
    assert [c["label"] for c in r["columns"]] == ["Bill No", "Bill Date", "Item", "Qty", "Sale Rate", "Sale Value", "Purchase Rate", "Purchase Value", "Difference", "DifferenceValue"]
    by = _by_no(r)
    assert set(by) == {"S1", "S2"}  # item 1 only; S4 is dated before the range
    assert (by["S1"]["Purchase Rate"], by["S1"]["Difference"], by["S1"]["DifferenceValue"]) == (30.0, 20.0, 200.0)  # 50 - 30, 500 - 300
    assert r["totals"]["DifferenceValue"] == 350.0 and r["totals"]["Sale Value"] == 800.0 and r["rate_type"] == "S"
    all_items = pm.run(conn, doc_id=d, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=None)  # @ID = every active item
    if pm.items(conn):  # needs real item masters to list anything
        assert {"S1", "S2", "S3"} <= set(_by_no(all_items))


def test_average_purchase_rate_comes_from_the_purchase_rows(conn):
    d = _define(conn, 2, "Margin Avg", "AVG RATE", cond="and ZtSale.SaleDate between @FROMDATE and @TODATE and ZtSale.ItemID in (@ID)", pur_cond="and ZtPurchase.PurDate <= @TODATE")
    r = pm.run(conn, doc_id=d, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=1)
    by = _by_no(r)
    assert by["S1"]["Purchase Rate"] == 30.0 and by["S1"]["Purchase Value"] == 300.0  # AVG of 20 and 40, AVG of 200 and 400
    assert (by["S1"]["Difference"], by["S1"]["DifferenceValue"]) == (20.0, 200.0)
    assert (by["S2"]["Difference"], by["S2"]["DifferenceValue"]) == (30.0, 0.0)  # 60 - 30, 300 - 300
    two = pm.run(conn, doc_id=d, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=2)
    assert _by_no(two)["S3"]["Purchase Rate"] == 80.0 and _by_no(two)["S3"]["Difference"] == 20.0  # item 2 has its own average


def test_unsupported_and_unsafe_definitions_are_refused(conn):
    d = _define(conn, 1, "Last", "LAST PURCHASE RATE")
    with pytest.raises(HTTPException) as e:
        pm.run(conn, doc_id=d, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=1)
    assert e.value.status_code == 422 and "LAST PURCHASE RATE" in e.value.detail
    d2 = _define(conn, 2, "Evil", "STANDARD RATE", cond="and 1 = 1; DROP TABLE ZtSale")
    with pytest.raises(HTTPException) as e:
        pm.run(conn, doc_id=d2, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=1)
    assert "not allowed" in e.value.detail
    conn.execute(text("UPDATE UtlProfitDtlFlds SET FldCond = '', FldNoTbl = 'ZtSale; DROP TABLE x' WHERE DocID = :d"), {"d": d2})
    with pytest.raises(HTTPException) as e:
        pm.run(conn, doc_id=d2, start=date(2031, 1, 1), end=date(2031, 12, 31), item_id=1)
    assert "unsupported table" in e.value.detail
    assert conn.execute(text("SELECT COUNT(*) FROM ZtSale")).scalar() == 4  # nothing was dropped or changed


def test_definitions_list_and_validation(conn):
    doc = _define(conn, 1, "Margin Std", "STANDARD RATE")
    d = pm.definitions(conn)
    assert d["available"] and any(t["doc_id"] == doc and t["name"] == "Margin Std" for t in d["types"])
    with pytest.raises(HTTPException) as e:
        pm.run(conn, doc_id=doc, start=date(2031, 2, 1), end=date(2031, 1, 1), item_id=1)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        pm.run(conn, doc_id=987654, start=date(2031, 1, 1), end=date(2031, 2, 1), item_id=1)
    assert e.value.status_code == 404


def test_reports_unavailable_without_the_tables(monkeypatch):
    c = get_engine().connect()
    try:
        monkeypatch.setattr(pm, "_missing", lambda _c: ["UtlProfitMargin"])
        assert pm.definitions(c)["available"] is False
        assert pm.run(c, doc_id=1, start=date(2031, 1, 1), end=date(2031, 2, 1), item_id=None)["missing"] == ["UtlProfitMargin"]
    finally:
        c.close()
