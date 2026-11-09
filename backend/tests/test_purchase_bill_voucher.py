"""Saving a Purchase Bill generates its Purchase Voucher (legacy GenVch); edit refills it, delete removes it (live DB, every test rolled back)."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import text

import app.core.db as db
from app.core import fy as fymod
from app.services import inventory as inv
from app.services import trn_voucher as tv


@pytest.fixture()
def conn():
    with db.get_engine().connect() as c:
        t = c.begin()
        try:
            if tv.settings_for(c, inv.DOC_ID_PB) is None:
                pytest.skip("this database has no Purchase Bill -> voucher settings")
            yield c
        finally:
            t.rollback()


def _clean(v):
    if hasattr(v, "quantize"):
        return float(v)
    if hasattr(v, "isoformat"):
        return v.date().isoformat() if hasattr(v, "date") else v.isoformat()
    return v.strip() if isinstance(v, str) else v


def _template(c):
    """A real bill of this database as the base of a new one (fields, supplier, item lines)."""
    pid = c.execute(text("SELECT TOP 1 PBID FROM TrnHdrPB WHERE Cancelled = 'N' AND SUPPID > 0 ORDER BY PBID DESC")).scalar()
    if pid is None:
        pytest.skip("no purchase bill to base a test on")
    old = inv.get_purchase_bill(c, pb_id=pid)
    h = old["header"]
    rows = inv.doc_rules.load_fields(c, inv.DOC_ID_PB)
    fields = {
        r["FldCode"]: _clean(h[r["FldCode"]])
        for r in rows
        if (r.get("FldSection") or "Header") in ("Header", "Footer") and h.get(r["FldCode"]) is not None and r["FldCode"] not in inv_computed()
    }
    lines = [inv.PurchaseBillLine(item_id=l["ITEMID"], uom_id=l["UOMID"], qty=float(l["PBQty"]), rate=float(l["PBRate"])) for l in old["lines"]]
    return h, fields, lines


def inv_computed():
    return ("TOTQTY", "PBVALUE", "VCHID", "ISSUEDBY", "TOTAMTIWRDS", "AMTINWORDS")


def _make(c, fy, *, ledger_purchase, qty_mult=1.0):
    h, fields, lines = _template(c)
    fields["LEDIDPUR"] = ledger_purchase
    lines = [inv.PurchaseBillLine(item_id=l.item_id, uom_id=l.uom_id, qty=l.qty * qty_mult, rate=l.rate) for l in lines]
    data = inv.PurchaseBillInput(supp_id=h["SUPPID"], fields=fields, doc_date=h["PBDate"].date(), lines=lines)
    return inv.create_purchase_bill(c, data=data, fy=fy, user_code="TEST"), h, fields, data


def _voucher_rows(c, vid):
    head = c.execute(text("SELECT * FROM TrnHdrPURVCH WHERE PURVCHID = :v"), {"v": vid}).mappings().first()
    dtl = c.execute(text("SELECT AcLedID, DrAmt, CrAmt, AmtType, PURVCHAmt, AgRefAmt, NewRefAmt FROM TrnDtlPURVCH WHERE PURVCHID = :v ORDER BY SlNo"), {"v": vid}).mappings().all()
    gl = c.execute(
        text("SELECT h.AccID, h.TrnNo, h.AccType, d.AcLedID, d.DrAmt, d.CrAmt FROM TrnHdrAcc h JOIN TrnDtlAcc d ON d.AccID = h.AccID WHERE h.DocType = 'PURVCH' AND h.TrnID = :v ORDER BY d.CrAmt"),
        {"v": vid},
    ).mappings().all()
    return head, [dict(r) for r in dtl], [dict(r) for r in gl]


def test_saving_a_bill_generates_the_voucher_like_the_exe(conn):
    fy = fymod.get_active_fy(conn)
    res, h, _, _ = _make(conn, fy, ledger_purchase=23)
    assert res["voucher_id"] and res["voucher_no"]
    pb = conn.execute(text("SELECT PBID, PBNO, PrintPBNO, PBDate, SUPPID, PBVALUE, VCHID FROM TrnHdrPB WHERE PBID = :i"), {"i": res["pb_id"]}).mappings().first()
    assert pb["VCHID"] == res["voucher_id"]
    head, dtl, gl = _voucher_rows(conn, res["voucher_id"])
    # header: the bill's number, print number and date, blank prefix, TRNTYPE 'PB', TRNID = the bill, CRPERIOD 30 (UtlTrnAccSettingsHdr)
    assert head["PURVCHNO"] == pb["PBNO"] and head["PrintPURVCHNO"] == pb["PrintPBNO"] and head["PURVCHDate"] == pb["PBDate"]
    assert str(head["Prefix"]).strip() == "" and head["TRNTYPE"].strip() == "PB" and int(head["TRNID"]) == pb["PBID"] and float(head["CRPERIOD"]) == 30
    assert head["Authorised"] == "Y" and head["Cancelled"] == "N" and head["AddedBy"] == "TEST"
    # lines (UtlTrnAccSettingsDtl): CR the supplier's account, DR the Ledger Purchase, both for the bill value; no bill-adjustment amounts
    supplier_acled = conn.execute(text("SELECT AcLedID FROM MstAcLed WHERE LedType = 'S' AND LedMstID = :s"), {"s": pb["SUPPID"]}).scalar()
    value = float(pb["PBVALUE"])
    assert [(d["AmtType"], d["AcLedID"], float(d["PURVCHAmt"])) for d in dtl] == [("CR", supplier_acled, value), ("DR", 23, value)]
    assert all(float(d["AgRefAmt"]) == 0 and float(d["NewRefAmt"]) == 0 for d in dtl)
    # GL: one TrnHdrAcc (DocType PURVCH, AccType V, TrnNo = the bill number) with the same two lines, balanced
    assert len({g["AccID"] for g in gl}) == 1 and gl[0]["TrnNo"] == pb["PBNO"] and gl[0]["AccType"] == "V"
    assert round(sum(float(g["DrAmt"]) for g in gl), 2) == round(sum(float(g["CrAmt"]) for g in gl), 2) == value


def test_blank_ledger_purchase_is_written_as_account_0_like_the_exe(conn):
    fy = fymod.get_active_fy(conn)
    res, *_ = _make(conn, fy, ledger_purchase=0)
    _, dtl, gl = _voucher_rows(conn, res["voucher_id"])
    assert [d["AcLedID"] for d in dtl if d["AmtType"] == "DR"] == [0] and any(g["AcLedID"] == 0 for g in gl)  # the legacy vouchers 1, 2, 3 and 7 are exactly this


def test_editing_the_bill_refills_the_same_voucher(conn):
    fy = fymod.get_active_fy(conn)
    res, h, fields, data = _make(conn, fy, ledger_purchase=23)
    before_head, *_ = _voucher_rows(conn, res["voucher_id"])
    data.lines = [inv.PurchaseBillLine(item_id=l.item_id, uom_id=l.uom_id, qty=l.qty + 2, rate=l.rate) for l in data.lines]
    out = inv.update_purchase_bill(conn, pb_id=res["pb_id"], data=data, fy=fy, user_code="TEST2")
    assert out["voucher_id"] == res["voucher_id"]  # same voucher, same number
    head, dtl, gl = _voucher_rows(conn, res["voucher_id"])
    assert head["PURVCHNO"] == before_head["PURVCHNO"] and head["ChangedBy"] == "TEST2"
    new_value = float(conn.execute(text("SELECT PBVALUE FROM TrnHdrPB WHERE PBID = :i"), {"i": res["pb_id"]}).scalar())
    assert new_value != res["pb_value"] and {float(d["PURVCHAmt"]) for d in dtl} == {new_value}
    assert len({g["AccID"] for g in gl}) == 1 and round(sum(float(g["DrAmt"]) for g in gl), 2) == new_value  # the old posting was replaced, not doubled


def test_editing_a_bill_that_has_no_voucher_creates_one(conn):
    fy = fymod.get_active_fy(conn)
    res, h, fields, data = _make(conn, fy, ledger_purchase=23)
    tv.delete_generated(conn, inv.DOC_ID_PB, res["pb_id"], user_code="TEST")  # as an old web bill that never got one
    conn.execute(text("UPDATE TrnHdrPB SET VCHID = 0 WHERE PBID = :i"), {"i": res["pb_id"]})
    out = inv.update_purchase_bill(conn, pb_id=res["pb_id"], data=data, fy=fy, user_code="TEST")
    assert out["voucher_id"] and conn.execute(text("SELECT VCHID FROM TrnHdrPB WHERE PBID = :i"), {"i": res["pb_id"]}).scalar() == out["voucher_id"]


def test_deleting_the_bill_removes_voucher_lines_and_gl(conn):
    fy = fymod.get_active_fy(conn)
    res, *_ = _make(conn, fy, ledger_purchase=23)
    vid = res["voucher_id"]
    inv.delete_purchase_bill(conn, pb_id=res["pb_id"], user_code="TEST")
    assert conn.execute(text("SELECT COUNT(*) FROM TrnHdrPURVCH WHERE PURVCHID = :v"), {"v": vid}).scalar() == 0
    assert conn.execute(text("SELECT COUNT(*) FROM TrnDtlPURVCH WHERE PURVCHID = :v"), {"v": vid}).scalar() == 0
    assert conn.execute(text("SELECT COUNT(*) FROM TrnHdrAcc WHERE DocType = 'PURVCH' AND TrnID = :v"), {"v": vid}).scalar() == 0


def test_a_voucher_already_adjusted_in_accounting_blocks_delete_and_edit(conn):
    fy = fymod.get_active_fy(conn)
    res, h, fields, data = _make(conn, fy, ledger_purchase=23)
    acc = conn.execute(text("SELECT AccID FROM TrnHdrAcc WHERE DocType = 'PURVCH' AND TrnID = :v"), {"v": res["voucher_id"]}).scalar()
    sup = conn.execute(text("SELECT TOP 1 AcLedID FROM TrnDtlAcc WHERE AccID = :a AND CrAmt > 0"), {"a": acc}).scalar()
    cols = [r[0] for r in conn.execute(text("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('TrnDtlAccAdj')")).all()]
    vals = {c: 0 for c in cols}
    vals.update({"AccID": acc + 100000, "AcLedID": sup, "AdjAgnstAccID": acc})
    conn.execute(text(f"INSERT INTO TrnDtlAccAdj ({', '.join(f'[{c}]' for c in cols)}) VALUES ({', '.join(f':{c}' for c in cols)})"), vals)
    with pytest.raises(HTTPException) as e:
        inv.delete_purchase_bill(conn, pb_id=res["pb_id"], user_code="TEST")
    assert e.value.status_code == 409 and "accounting" in e.value.detail
    with pytest.raises(HTTPException) as e2:
        inv.update_purchase_bill(conn, pb_id=res["pb_id"], data=data, fy=fy, user_code="TEST")
    assert e2.value.status_code == 409


def test_mapping_expressions_are_limited_to_header_or_detail_columns(conn):
    setup = tv.settings_for(conn, inv.DOC_ID_PB)
    assert tv._col_expr(setup, "H.LEDIDPUR") == "h.[LEDIDPUR]" and tv._col_expr(setup, "h.PBVALUE") == "h.[PBVALUE]"
    for bad in ("1; DROP TABLE x", "h.PBVALUE + 1", "PBVALUE", "h.NoSuchColumn", "x.PBVALUE", "d.PBQTY"):  # no detail view here, so d.* is refused too
        with pytest.raises(HTTPException):
            tv._col_expr(setup, bad)
