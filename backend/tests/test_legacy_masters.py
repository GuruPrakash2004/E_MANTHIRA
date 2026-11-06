"""Holiday Master + ledger opening balances (frmMstHoliday / frmMstOPBalLed). Real DB, every test rolled back."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.core.fy import get_active_fy
from app.services import legacy_masters as lm


@pytest.fixture()
def ctx():
    eng = get_engine()
    conn = eng.connect()
    tx = conn.begin()
    try:
        fy = get_active_fy(conn)
        yield conn, fy
    finally:
        tx.rollback()
        conn.close()


def _free_day(conn, fy):
    taken = {r[0].date() for r in conn.execute(text("SELECT Hdate FROM MstHoliday"))}
    d = fy.start_date + timedelta(days=40)
    while d in taken:
        d += timedelta(days=1)
    return d


def test_holiday_add_update_delete(ctx):
    conn, fy = ctx
    if lm.missing(conn, *lm.HOLIDAY_TABLES):
        pytest.skip("no MstHoliday")
    d = _free_day(conn, fy)
    lm.add_holiday(conn, day=d, name="Test Festival", fy=fy, user_code="T")
    got = [r for r in lm.holidays(conn, start=fy.start_date, end=fy.end_date)["rows"] if r["date"] == d.isoformat()]
    assert got and got[0]["name"] == "Test Festival"
    with pytest.raises(HTTPException) as e:  # one holiday per date
        lm.add_holiday(conn, day=d, name="Again", fy=fy, user_code="T")
    assert e.value.status_code == 409 and "already exists" in e.value.detail.lower()
    lm.update_holiday(conn, day=d, name="Renamed", fy=fy, user_code="T")
    assert conn.execute(text("SELECT HolidayName FROM MstHoliday WHERE Hdate = :d"), {"d": d}).scalar() == "Renamed"
    lm.delete_holiday(conn, day=d, fy=fy, user_code="T")
    assert not conn.execute(text("SELECT 1 FROM MstHoliday WHERE Hdate = :d"), {"d": d}).scalar()
    with pytest.raises(HTTPException) as e:
        lm.delete_holiday(conn, day=d, fy=fy, user_code="T")
    assert e.value.status_code == 404


@pytest.mark.parametrize("name,err", [("", "should not be blank"), ("   ", "should not be blank"), ("12345", "in words")])
def test_holiday_name_rules(ctx, name, err):
    conn, fy = ctx
    if lm.missing(conn, *lm.HOLIDAY_TABLES):
        pytest.skip("no MstHoliday")
    with pytest.raises(HTTPException) as e:
        lm.add_holiday(conn, day=fy.start_date, name=name, fy=fy, user_code="T")
    assert err in e.value.detail


def test_holiday_date_must_be_in_financial_year(ctx):
    conn, fy = ctx
    if lm.missing(conn, *lm.HOLIDAY_TABLES):
        pytest.skip("no MstHoliday")
    with pytest.raises(HTTPException) as e:
        lm.add_holiday(conn, day=fy.end_date + timedelta(days=5), name="Outside", fy=fy, user_code="T")
    assert e.value.status_code == 422 and "financial year" in e.value.detail


def _ledger_id(conn):
    return conn.execute(text("SELECT TOP 1 AcLedID FROM MstAcLed WHERE AcLedName <> '-' AND AcLedID > 0 ORDER BY AcLedID")).scalar()


def _posting(conn, led, op):
    return conn.execute(
        text("SELECT h.AccID, h.DocType, h.AccType, h.TrnNo, d.DrAmt, d.CrAmt FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID WHERE d.AcLedID = :l AND h.TrnID = :t AND h.DocType = 'OP'"),
        {"l": led, "t": op},
    ).mappings().all()


def test_opening_balance_posts_like_the_exe(ctx):
    conn, fy = ctx
    if lm.missing(conn, *lm.OPENING_TABLES):
        pytest.skip("database lacks the opening-balance tables")
    led = _ledger_id(conn)
    if not led:
        pytest.skip("no ledger")
    r = lm.add_opening(conn, led_id=led, ref_no="OB-TEST-1", ref_date=fy.start_date, amount=1500.5, dr_cr="D", user_code="T")
    op = r["op_id"]
    row = conn.execute(text("SELECT OPRefNo, OpAmt, DrCr, DocType FROM MstLedBillWiseOPBal WHERE OPID = :i"), {"i": op}).mappings().first()
    assert (row["OPRefNo"], float(row["OpAmt"]), row["DrCr"].strip()) == ("OB-TEST-1", 1500.5, "D")
    p = _posting(conn, led, op)
    assert len(p) == 1 and p[0]["AccType"] == "B" and p[0]["TrnNo"] == "OB-TEST-1"  # ONE unbalanced detail line, as the EXE writes
    assert (float(p[0]["DrAmt"]), float(p[0]["CrAmt"])) == (1500.5, 0)
    assert lm.opening_balances(conn, led)["totals"]["D"] >= 1500.5

    lm.update_opening(conn, led_id=led, op_id=op, ref_date=fy.start_date, amount=200, dr_cr="C", user_code="T")
    p = _posting(conn, led, op)
    assert len(p) == 1 and (float(p[0]["DrAmt"]), float(p[0]["CrAmt"])) == (0, 200)  # re-posted on the other side, not duplicated

    lm.delete_opening(conn, led_id=led, op_id=op, user_code="T")
    assert not _posting(conn, led, op)
    assert not conn.execute(text("SELECT 1 FROM MstLedBillWiseOPBal WHERE OPID = :i"), {"i": op}).scalar()


def test_opening_balance_rules(ctx):
    conn, fy = ctx
    if lm.missing(conn, *lm.OPENING_TABLES):
        pytest.skip("database lacks the opening-balance tables")
    led = _ledger_id(conn)
    add = lambda **k: lm.add_opening(conn, led_id=led, ref_no=k.get("ref", "R1"), ref_date=fy.start_date, amount=k.get("amt", 10), dr_cr=k.get("side", "D"), user_code="T")
    for kwargs, msg in (({"ref": " "}, "RefNo"), ({"amt": 0}, "greater than 0"), ({"side": "X"}, "Invalid Account Type")):
        with pytest.raises(HTTPException) as e:
            add(**kwargs)
        assert msg in e.value.detail
    add()
    with pytest.raises(HTTPException) as e:  # same ref no on the same ledger
        add()
    assert e.value.status_code == 409


def test_unknown_ledger_and_missing_tables(ctx, monkeypatch):
    conn, fy = ctx
    if not lm.missing(conn, *lm.OPENING_TABLES):
        with pytest.raises(HTTPException) as e:
            lm.opening_balances(conn, 999999)
        assert e.value.status_code == 404
    monkeypatch.setattr(lm, "missing", lambda _c, *t: list(t[:1]))
    assert lm.holidays(conn, start=fy.start_date, end=fy.end_date)["available"] is False
    assert lm.ledgers(conn)["available"] is False
    assert lm.sannidhi_sevas(conn)["available"] is False
    with pytest.raises(HTTPException) as e:
        lm.add_holiday(conn, day=fy.start_date, name="x", fy=fy, user_code="T")
    assert e.value.status_code == 409


def test_sannidhi_sevas_overview(ctx):
    conn, _ = ctx
    if lm.missing(conn, *lm.SANSEVA_TABLES):
        pytest.skip("no MstSanSeva")
    o = lm.sannidhi_sevas(conn)
    assert o["available"] and o["total_sevas"] >= 0
    assert all(r["seva_count"] <= o["total_sevas"] for r in o["rows"])


def test_sides_titles_and_captions_come_from_the_database(ctx):
    conn, _ = ctx
    if lm.missing(conn, *lm.OPENING_TABLES):
        pytest.skip("database lacks the opening-balance tables")
    # the two sides are the books' own amount columns (DrAmt / CrAmt): no typed list in the code
    cols = [r[0] for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'TrnDtlAcc' AND column_name LIKE '%Amt'"))]
    assert [x["label"] + "Amt" for x in lm.sides(conn)] == cols
    led = _ledger_id(conn)
    o = lm.opening_balances(conn, led)
    menu = conn.execute(text("SELECT TOP 1 MenuItemCaption FROM MstMenu WHERE UPPER(FrmName) = 'FRMMSTACCOUNTLED'")).scalar()
    assert o["title"] == (menu or "").strip()  # the title is the menu row's own caption
    assert o["captions"]["ref_no"] == "OP Ref No"  # tidied from the real column OPRefNo
    assert lm.ledgers(conn)["rows"][0]["type"] in ("L", "C", "S", "-")  # the stored code, not a typed name
