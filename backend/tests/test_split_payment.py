"""Split payment on Seva Entry and Donation Receipt, on the real database (every test runs in a rolled-back transaction)."""
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.core.fy import get_active_fy
from app.services import donation as dn
from app.services import seva as sv
from app.services import split_payment as sp

FIELD_KEYS = ["SANNIDHIID", "SVAID", "MOBNUM", "KNAME", "GOTHRAID", "NAKSHATRAID", "RASHIID", "PAYMENT", "LEDGER", "LEDID", "VCHTYP",
              "SecKNAME", "SECNAKSHATRAID", "SECRASHIID", "NAMEINKAN", "REFNO", "BANKNAME", "ADDRES", "PRASADA"]


@pytest.fixture()
def seva_ctx():
    eng = get_engine()
    with eng.connect() as c:
        if not sp.available():
            pytest.skip("WebSplitPayment does not exist in this database")
        last_id = c.execute(text("SELECT MAX(SEVAID) FROM TrnHdrSEVA WHERE Cancelled='N' AND SEVAID IN (SELECT SevaID FROM TrnDtlSevaDates)")).scalar()
        if not last_id:
            pytest.skip("no saved seva to use as a template")
        last, fy = sv.get(c, last_id), get_active_fy(c)
        defaults = sp.defaults(c, "SEVA")
    if not fy.start_date <= date.today() <= fy.end_date:
        pytest.skip("today is outside the active financial year")
    if not (defaults.get("CASH") and defaults.get("UPI")):
        pytest.skip("need a usual Cash and a usual UPI account")
    fields = {k: last[k] for k in FIELD_KEYS if k in last and last[k] not in (None, "")}
    fields.setdefault("MOBNUM", "9876543210")  # the Designer makes the mobile number mandatory for UPI
    conn = eng.connect()
    tx = conn.begin()
    try:
        yield conn, fy, fields, defaults
    finally:
        tx.rollback()
        conn.close()


def _data(fields, fy, split=None):
    day = min(max(date.today(), fy.start_date), fy.end_date)
    return sv.SevaInput(fields=dict(fields), dates=[sv.SevaDate(perform_date=day)], doc_date=day, split=split)


def _parts(conn, fy, fields, defaults, upi_share=0.4):
    total = sv._prepare(conn, _data(fields, fy), fy).total_amt
    upi = round(total * upi_share, 2)
    return total, [
        sp.SplitPart("UPI", upi, defaults["UPI"]["led_id"], ref_no="UPI-REF-1"),
        sp.SplitPart("CASH", round(total - upi, 2), defaults["CASH"]["led_id"]),
    ]


def _receipt_lines(conn, seva_no):
    rid = conn.execute(text("SELECT TOP 1 RCPTVCHID FROM TrnHdrRCPTVCH WHERE NARR = :n ORDER BY RCPTVCHID DESC"), {"n": seva_no}).scalar()
    lines = conn.execute(text("SELECT SlNo, AcLedID, DrAmt, CrAmt FROM TrnDtlRCPTVCH WHERE RCPTVCHID = :i ORDER BY SlNo"), {"i": rid}).all()
    hdr = conn.execute(text("SELECT TOTDR, TOTCR FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :i"), {"i": rid}).first()
    return rid, [tuple(r) for r in lines], hdr


def test_seva_split_saves_parts_header_main_mode_and_one_dr_line_per_part(seva_ctx):
    conn, fy, fields, d = seva_ctx
    total, parts = _parts(conn, fy, fields, d)
    r = sv.create(conn, data=_data(fields, fy, parts), fy=fy, user_code="ADMIN")
    got = sv.get(conn, r["seva_id"])
    assert float(got["TotalAmt"]) == total
    # the legacy header carries ONE ordinary payment: the largest part (CASH here), its ledger and voucher type
    assert str(got["PAYMENT"]).upper() == "CASH" and int(got["LEDID"]) == d["CASH"]["led_id"]
    assert [(p["mode"], p["amount"], p["led_id"]) for p in got["split_payments"]] == [("UPI", parts[0].amount, d["UPI"]["led_id"]), ("CASH", parts[1].amount, d["CASH"]["led_id"])]
    if r["receipt_no"]:  # auto receipt on: one Cr (income) + one Dr per part
        rid, lines, hdr = _receipt_lines(conn, r["seva_no"])
        assert len(lines) == 3 and float(lines[0][3]) == total and float(lines[0][2]) == 0
        assert sorted(float(x[2]) for x in lines[1:]) == sorted(p.amount for p in parts)
        assert float(hdr[0]) == float(hdr[1]) == total
        gl = conn.execute(text("SELECT SUM(a.DrAmt), SUM(a.CrAmt) FROM TrnDtlAcc a JOIN TrnHdrAcc h ON h.AccID = a.AccID WHERE h.DocType = 'RCPTVCH' AND h.TrnID = :i"), {"i": rid}).first()
        assert float(gl[0]) == float(gl[1]) == total  # the ledger posting is balanced for the bill


def test_amounts_must_add_up_and_two_parts_are_needed(seva_ctx):
    conn, fy, fields, d = seva_ctx
    total, parts = _parts(conn, fy, fields, d)
    before = conn.execute(text("SELECT COUNT(*) FROM TrnHdrSEVA")).scalar()
    parts[0].amount += 1
    with pytest.raises(HTTPException) as e:
        sv.create(conn, data=_data(fields, fy, parts), fy=fy, user_code="ADMIN")
    assert e.value.status_code == 422 and "add up" in e.value.detail
    with pytest.raises(HTTPException) as e:
        sv.create(conn, data=_data(fields, fy, parts[:1]), fy=fy, user_code="ADMIN")
    assert e.value.status_code == 422 and "at least two" in e.value.detail
    assert conn.execute(text("SELECT COUNT(*) FROM TrnHdrSEVA")).scalar() == before  # nothing was written


def test_a_part_cannot_use_the_income_ledger_or_a_zero_amount_or_an_unknown_mode(seva_ctx):
    conn, fy, fields, d = seva_ctx
    total, parts = _parts(conn, fy, fields, d)
    income = int(fields["LEDGER"])
    with pytest.raises(HTTPException) as e:
        sv.create(conn, data=_data(fields, fy, [sp.SplitPart("UPI", parts[0].amount, income), parts[1]]), fy=fy, user_code="ADMIN")
    assert "same ledger" in e.value.detail
    with pytest.raises(HTTPException) as e:
        sv.create(conn, data=_data(fields, fy, [sp.SplitPart("UPI", 0, parts[0].led_id), parts[1]]), fy=fy, user_code="ADMIN")
    assert "Greater than 0" in e.value.detail
    with pytest.raises(HTTPException) as e:
        sv.create(conn, data=_data(fields, fy, [sp.SplitPart("BARTER", parts[0].amount, parts[0].led_id), parts[1]]), fy=fy, user_code="ADMIN")
    assert "not a payment mode" in e.value.detail


def test_edit_replaces_the_parts_and_turning_split_off_removes_them(seva_ctx):
    conn, fy, fields, d = seva_ctx
    total, parts = _parts(conn, fy, fields, d)
    r = sv.create(conn, data=_data(fields, fy, parts), fy=fy, user_code="ADMIN")
    _, again = _parts(conn, fy, fields, d, upi_share=0.7)
    sv.update(conn, seva_id=r["seva_id"], data=_data(fields, fy, again), fy=fy, user_code="ADMIN")
    got = sv.get(conn, r["seva_id"])
    assert str(got["PAYMENT"]).upper() == "UPI"  # the larger part is now UPI
    assert [(p["mode"], p["amount"]) for p in got["split_payments"]] == [(p.mode, p.amount) for p in again]
    if r["receipt_no"]:
        assert len(_receipt_lines(conn, r["seva_no"])[1]) == 3
    sv.update(conn, seva_id=r["seva_id"], data=_data(dict(fields), fy, None), fy=fy, user_code="ADMIN")
    assert sv.get(conn, r["seva_id"])["split_payments"] == []


def test_delete_removes_the_parts(seva_ctx):
    conn, fy, fields, d = seva_ctx
    _, parts = _parts(conn, fy, fields, d)
    r = sv.create(conn, data=_data(fields, fy, parts), fy=fy, user_code="ADMIN")
    sv.delete(conn, seva_id=r["seva_id"], user_code="ADMIN")
    assert conn.execute(text("SELECT COUNT(*) FROM WebSplitPayment WHERE DocType='SEVA' AND DocID=:i"), {"i": r["seva_id"]}).scalar() == 0


def test_ordinary_unsplit_bill_is_untouched(seva_ctx):
    conn, fy, fields, d = seva_ctx
    r = sv.create(conn, data=_data(fields, fy), fy=fy, user_code="ADMIN")
    assert sv.get(conn, r["seva_id"])["split_payments"] == []
    if r["receipt_no"]:
        assert len(_receipt_lines(conn, r["seva_no"])[1]) == 2  # the usual one Cr + one Dr


def test_header_main_part_is_the_largest_and_first_on_a_tie():
    a, b = sp.SplitPart("UPI", 500, 1), sp.SplitPart("CASH", 500, 2)
    assert sp.main_part([a, b]) is a and sp.main_part([a, sp.SplitPart("CASH", 600, 2)]).mode == "CASH"


def test_defaults_come_from_the_temples_own_bills():
    with get_engine().connect() as c:
        if not sp.available():
            pytest.skip("no split table")
        d = sp.defaults(c, "SEVA")
        assert {"CASH", "UPI"} <= set(d)
        usual_upi = c.execute(text("SELECT TOP 1 LEDID FROM TrnHdrSEVA WHERE UPPER(PAYMENT)='UPI' GROUP BY LEDID ORDER BY COUNT(*) DESC")).scalar()
        assert d["UPI"]["led_id"] == int(usual_upi)
        assert sp.vch_type_for(c, "SEVA", "UPI") == "Bank" and sp.vch_type_for(c, "SEVA", "CASH") == "Cash"


@pytest.fixture()
def donation_ctx():
    eng = get_engine()
    with eng.connect() as c:
        if not sp.available():
            pytest.skip("no split table")
        last_id = c.execute(text("SELECT MAX(DONRECID) FROM TrnHdrDONREC WHERE Cancelled='N'")).scalar()
        if not last_id:
            pytest.skip("no saved donation to use as a template")
        last, fy, d = dn.get(c, last_id), get_active_fy(c), sp.defaults(c, "DONREC")
    if not fy.start_date <= date.today() <= fy.end_date or not (d.get("CASH") and d.get("UPI")):
        pytest.skip("cannot save a donation here today")
    conn = eng.connect()
    tx = conn.begin()
    try:
        yield conn, fy, last, d
    finally:
        tx.rollback()
        conn.close()


def test_donation_split_posts_one_dr_line_per_part(donation_ctx):
    conn, fy, last, d = donation_ctx
    lines = [{"SEVAID": l["SEVAID"], "SEVANME": l["SEVANME"], "AMOUNT": 1000} for l in last["lines"][:1]] or [{"SEVAID": 0, "SEVANME": "DONATION", "AMOUNT": 1000}]
    fields = {k: v for k, v in last.items() if k not in ("lines", "split_payments")}
    parts = [sp.SplitPart("UPI", 400, d["UPI"]["led_id"], ref_no="R1"), sp.SplitPart("CASH", 600, d["CASH"]["led_id"])]
    data = dn.DonationInput(prefix=str(last.get("Prefix") or ""), doc_date=min(max(date.today(), fy.start_date), fy.end_date), fields=fields, lines=lines, split=parts)
    r = dn.create(conn, data=data, fy=fy, user_code="ADMIN")
    got = dn.get(conn, r["donrec_id"])
    assert str(got["PAYMNTMODE"]).upper() == "CASH" and int(got["LEDID"]) == d["CASH"]["led_id"]  # header = the larger part
    assert [(p["mode"], p["amount"]) for p in got["split_payments"]] == [("UPI", 400.0), ("CASH", 600.0)]
    if r["receipt_no"]:
        rid = conn.execute(text("SELECT TOP 1 RCPTVCHID FROM TrnHdrRCPTVCH WHERE RCPTVCHNO = :n ORDER BY RCPTVCHID DESC"), {"n": r["receipt_no"]}).scalar()
        rows = conn.execute(text("SELECT AcLedID, DrAmt, CrAmt FROM TrnDtlRCPTVCH WHERE RCPTVCHID = :i ORDER BY SlNo"), {"i": rid}).all()
        assert len(rows) == 3 and float(rows[0][2]) == 1000.0 and sorted(float(x[1]) for x in rows[1:]) == [400.0, 600.0]
    dn.delete(conn, donrec_id=r["donrec_id"], user_code="ADMIN")
    assert conn.execute(text("SELECT COUNT(*) FROM WebSplitPayment WHERE DocType='DONREC' AND DocID=:i"), {"i": r["donrec_id"]}).scalar() == 0
