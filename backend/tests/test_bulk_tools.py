"""Bulk Update + item HSN upload on SYNTHETIC tables created inside a transaction that is always rolled back."""
import io
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.services import bulk_tools as bt


@pytest.fixture()
def conn():
    c = get_engine().connect()
    tx = c.begin()
    try:
        c.execute(text("CREATE TABLE ZtBulk (ZID int NOT NULL PRIMARY KEY, Nm varchar(10), Amt numeric(18,2), Due smalldatetime NULL, Flag char(1), LoginPwd varchar(20), Up AS UPPER(Nm))"))
        c.execute(text("CREATE TABLE ZtChild (CID int IDENTITY(1,1) PRIMARY KEY, ZID int)"))
        c.execute(text("INSERT INTO ZtBulk (ZID, Nm, Amt, Due, Flag, LoginPwd) VALUES (1,'alpha beta',10,'2031-01-01','N','x1'), (2,'beta',20,NULL,'N','x2'), (3,'gamma',10,'2031-01-01','Y','x3'), (4,'delta_beta',30,NULL,'N','x4')"))
        c.execute(text("INSERT INTO ZtChild (ZID) VALUES (3)"))
        yield c
    finally:
        tx.rollback()
        c.close()


def _vals(conn, col):
    return {r[0]: r[1] for r in conn.execute(text(f"SELECT ZID, {col} FROM ZtBulk"))}


def test_describe_marks_only_safe_columns_editable(conn):
    d = bt.describe(conn, "ZtBulk")
    ed = {c["name"]: c["editable"] for c in d["columns"]}
    assert d["key"] == "ZID" and ed == {"ZID": False, "Nm": True, "Amt": True, "Due": True, "Flag": True, "LoginPwd": False, "Up": False}  # key, secret-looking and computed stay read-only
    assert next(c for c in d["columns"] if c["name"] == "Nm")["length"] == 10
    t = {x["name"]: x for x in bt.tables(conn)}
    assert t["TrnHdrAcc"]["editable"] is False and t["TrnHdrSEVA"]["deletable"] is False and t["ZtBulk"]["deletable"] is True


def test_rows_filter_and_secret_masking(conn):
    r = bt.rows(conn, "ZtBulk", {"Nm": "beta"})
    assert r["total"] == 3 and {x["ZID"] for x in r["rows"]} == {1, 2, 4}
    assert all(x["LoginPwd"] == "********" for x in r["rows"])
    assert bt.rows(conn, "ZtBulk", {"Amt": "10"})["total"] == 2  # filters work on numbers and dates too (as text)
    assert bt.rows(conn, "ZtBulk", {"NoSuchColumn": "x", "Nm": ""})["total"] == 4  # unknown / empty filters are ignored


def test_complete_update_matches_the_current_value_and_converts_types(conn):
    # only the rows (of the shown ones) whose Amt is 10 change
    r = bt.update(conn, table="ZtBulk", keys=[1, 2, 3], field="Amt", mode="complete", current="10", partial="", replace="99.5", user_code="T")
    assert r["updated"] == 2 and _vals(conn, "Amt") == {1: 99.5, 2: 20.0, 3: 99.5, 4: 30.0}
    bt.update(conn, table="ZtBulk", keys=[1, 2, 3, 4], field="Flag", mode="complete", current=None, partial="", replace="Z", user_code="T")  # no current value: every shown row
    assert set(_vals(conn, "Flag").values()) == {"Z"}
    bt.update(conn, table="ZtBulk", keys=[2, 4], field="Due", mode="complete", current="", partial="", replace="2032-05-06", user_code="T")  # blank current = NULL dates
    assert {k: v for k, v in _vals(conn, "Due").items() if k in (2, 4)} == {2: bt.datetime(2032, 5, 6), 4: bt.datetime(2032, 5, 6)}
    assert _vals(conn, "Due")[1] == bt.datetime(2031, 1, 1)  # a row with a date is left alone


def test_partial_update_replaces_text_inside_the_field_only_where_it_occurs(conn):
    r = bt.update(conn, table="ZtBulk", keys=[1, 2, 3, 4], field="Nm", mode="partial", current=None, partial="beta", replace="BETA", user_code="T")
    assert r["updated"] == 3 and _vals(conn, "Nm") == {1: "alpha BETA", 2: "BETA", 3: "gamma", 4: "delta_BETA"}
    bt.update(conn, table="ZtBulk", keys=[4], field="Nm", mode="partial", current=None, partial="_", replace="-", user_code="T")  # an underscore is text, not a wildcard
    assert _vals(conn, "Nm")[4] == "delta-BETA" and _vals(conn, "Nm")[3] == "gamma"
    n = bt.update(conn, table="ZtBulk", keys=[1, 2, 3, 4], field="Nm", mode="partial", current=None, partial="%", replace="x", user_code="T")
    assert n["updated"] == 0  # a % in the search text is not a wildcard either


def test_update_validations(conn):
    def upd(**k):
        base = dict(table="ZtBulk", keys=[1], field="Nm", mode="complete", current=None, partial="", replace="x", user_code="T")
        return bt.update(conn, **{**base, **k})

    for kw, msg in (
        (dict(replace="x" * 11), "Lenght Of replace value"),  # longer than varchar(10)
        (dict(field="ZID"), "cannot be updated"),  # the key
        (dict(field="Up"), "cannot be updated"),  # computed
        (dict(field="LoginPwd"), "cannot be updated"),  # secret-looking
        (dict(field="Nope"), "cannot be updated"),
        (dict(keys=[]), "no rows"),
        (dict(mode="partial", partial=""), "text to replace"),
        (dict(mode="partial", field="Amt", partial="1"), "text fields"),
        (dict(field="Amt", replace="abc"), "must be a number"),
        (dict(field="Due", replace="not a date"), "must be a date"),
        (dict(mode="bogus"), "Complete or Partial"),
        (dict(keys=list(range(1001))), "at most"),
    ):
        with pytest.raises(HTTPException) as e:
            upd(**kw)
        assert e.value.status_code == 422 and msg.lower() in e.value.detail.lower(), (kw, e.value.detail)
    assert _vals(conn, "Nm") == {1: "alpha beta", 2: "beta", 3: "gamma", 4: "delta_beta"}  # nothing changed


def test_names_are_never_taken_from_the_user(conn):
    with pytest.raises(HTTPException) as e:
        bt.update(conn, table="ZtBulk; DROP TABLE ZtBulk", keys=[1], field="Nm", mode="complete", current=None, partial="", replace="x", user_code="T")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        bt.update(conn, table="ZtBulk", keys=[1], field="Nm = 'x' --", mode="complete", current=None, partial="", replace="x", user_code="T")
    assert conn.execute(text("SELECT COUNT(*) FROM ZtBulk")).scalar() == 4


def test_the_books_are_never_edited_here(conn):
    with pytest.raises(HTTPException) as e:
        bt.update(conn, table="TrnHdrAcc", keys=[1], field="Narrn", mode="complete", current=None, partial="", replace="x", user_code="T")
    assert e.value.status_code == 422 and "books" in e.value.detail
    with pytest.raises(HTTPException):
        bt.delete(conn, table="TrnHdrAcc", keys=[1], user_code="T")
    with pytest.raises(HTTPException) as e:
        bt.delete(conn, table="TrnHdrSEVA", keys=[1], user_code="T")  # documents are deleted on their own screens
    assert "own screens" in e.value.detail


def test_delete_checks_references_through_utldeletion_and_audits(conn):
    conn.execute(text("INSERT INTO UtlDeletion (DelTblName, TblName, FldName, DispFldName, TblCaption) VALUES ('ZtBulk', 'ZtChild', 'ZID', 'Nm', 'Child rows')"))
    with pytest.raises(HTTPException) as e:
        bt.delete(conn, table="ZtBulk", keys=[2, 3], user_code="T")  # row 3 is referred to by ZtChild
    assert e.value.status_code == 409 and "Child rows" in e.value.detail
    assert conn.execute(text("SELECT COUNT(*) FROM ZtBulk")).scalar() == 4  # nothing was deleted
    assert bt.delete(conn, table="ZtBulk", keys=[1, 2], user_code="T") == {"deleted": 2}
    assert conn.execute(text("SELECT COUNT(*) FROM ZtBulk")).scalar() == 2
    assert conn.execute(text("SELECT TOP 1 Details FROM WebAuditLog WHERE Entity = 'Bulk Update' AND EntityID = 'ZtBulk' ORDER BY ID DESC")).scalar() == "2 rows deleted"


def test_hsn_template_and_parsing():
    rows = bt._read_hsn(bt.hsn_template())
    assert rows == []  # the template is just the header
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["ITEMCODE", "hsncode"])
    ws.append(["A1", 8471])
    ws.append([None, None])
    ws.append(["B2", ""])
    buf = io.BytesIO()
    wb.save(buf)
    assert bt._read_hsn(buf.getvalue()) == [(2, "A1", "8471"), (4, "B2", "")]
    bad = Workbook()
    bad.active.append(["Code", "Other"])
    b2 = io.BytesIO()
    bad.save(b2)
    for payload, msg in ((b2.getvalue(), "valid template"), (b"not an excel file", "valid file")):
        with pytest.raises(HTTPException) as e:
            bt._read_hsn(payload)
        assert msg in e.value.detail


def test_hsn_upload_updates_only_found_items(conn):
    if bt.hsn_missing(conn):
        pytest.skip("this database has no MstItem.HSNCode")
    item_id = int(conn.execute(text("SELECT ISNULL(MAX(ItemID), 0) + 1 FROM MstItem")).scalar())
    try:  # every other column has a default
        conn.execute(text("INSERT INTO MstItem (ItemID, ItemCode, ItemName, HSNCode, AddedOn) VALUES (:i, 'ZTITEM1', 'Zt Item', '1111', GETDATE())"), {"i": item_id})
    except Exception:
        pytest.skip("cannot create a synthetic MstItem row in this schema")
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["ItemCode", "HSNCode"])
    ws.append(["ZTITEM1", "9999"])
    ws.append(["NOSUCHITEM", "5555"])
    buf = io.BytesIO()
    wb.save(buf)
    prev = bt.hsn_preview(conn, buf.getvalue())
    assert prev["ok"] == 1 and prev["skipped"] == 1 and prev["rows"][0]["current_hsn"] == "1111" and prev["rows"][1]["problem"] == "Item code not found"
    assert bt.hsn_apply(conn, buf.getvalue(), "T") == {"updated": 1, "skipped": 1}
    assert conn.execute(text("SELECT HSNCode FROM MstItem WHERE ItemCode = 'ZTITEM1'")).scalar() == "9999"


def test_hsn_reports_a_database_without_the_columns(monkeypatch):
    c = get_engine().connect()
    try:
        monkeypatch.setattr(bt, "hsn_missing", lambda _c: ["MstItem (ItemCode, HSNCode)"])
        assert bt.hsn_preview(c, bt.hsn_template())["available"] is False
        with pytest.raises(HTTPException) as e:
            bt.hsn_apply(c, bt.hsn_template(), "T")
        assert e.value.status_code == 409
    finally:
        c.close()
