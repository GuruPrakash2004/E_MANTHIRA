"""Voucher Listing + Day Book. Real DB; the vouchers a test needs are inserted inside a transaction that is always rolled back."""
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.legacy.tables import insert_row
from app.services import acc_reports as ar

PAY_DOC = "Payment Voucher"


@pytest.fixture()
def conn():
    c = get_engine().connect()
    tx = c.begin()
    try:
        yield c
    finally:
        tx.rollback()
        c.close()


def _pay_doc(conn):
    for t in ar.voucher_options(conn)["types"]:
        for d in t["docs"]:
            if d["name"] == PAY_DOC:
                return d["doc_id"]
    pytest.skip("this database has no listable Payment Voucher")


def _ledger_ids(conn, n=2):
    tbl, idc, namec = ar.ledger_master(conn)
    ids = [r[0] for r in conn.execute(text(f"SELECT TOP {n} {idc} FROM {tbl} WHERE {idc} > 0 AND {namec} <> '-' ORDER BY {idc}"))]
    if len(ids) < n:
        pytest.skip("not enough ledgers")
    return ids


def _voucher(conn, no, day, narr, mode, lines, *, cancelled="N", prefix="ZT"):
    total = sum(dr for _, dr, _ in lines)
    vid = insert_row(
        conn, "TrnHdrPMTVCH",
        {"PMTVCHNO": no, "Prefix": prefix, "PrintPMTVCHNO": no, "PMTVCHDate": day, "Cancelled": cancelled, "Authorised": "Y", "NARR": narr, "VCHTYP": mode, "TOTDR": total, "TOTCR": total, "AddedBy": "T", "AddedOn": datetime(2031, 1, 1)},
        returning="PMTVCHID",
    )
    for i, (led, dr, cr) in enumerate(lines, start=1):
        insert_row(conn, "TrnDtlPMTVCH", {"PMTVCHID": vid, "SlNo": i, "AcLedID": led, "PMTVCHAmt": dr or cr, "DrAmt": dr, "CrAmt": cr, "AmtType": "DR" if dr else "CR", "AgRefAmt": 0, "NewRefAmt": 0})
    return vid


def test_voucher_listing_lines_totals_and_filters(conn):
    doc = _pay_doc(conn)
    a, b = _ledger_ids(conn)
    d1, d2 = date(2031, 1, 5), date(2031, 2, 9)  # far from any real data
    _voucher(conn, "ZT0001", d1, "first", "Cash", [(a, 100, 0), (b, 0, 100)])
    _voucher(conn, "ZT0002", d2, "second", "Bank", [(a, 250.5, 0), (b, 0, 250.5)])
    _voucher(conn, "ZT0003", d2, "voided", "Cash", [(a, 999, 0), (b, 0, 999)], cancelled="Y")

    r = ar.voucher_listing(conn, doc_id=doc, start=date(2031, 1, 1), end=date(2031, 12, 31), ledger_ids=[], prefix="ZT", fields=["NARR", "VCHTYP"])
    assert len(r["rows"]) == 6  # every detail line, the cancelled voucher's too
    assert r["total"] == {"dr": 350.5, "cr": 350.5}  # ...but a cancelled voucher is not added to the totals
    assert sum(1 for x in r["rows"] if x["cancelled"]) == 2
    assert {x["key"]: x["dr"] for x in r["by_month"]} == {"Jan 2031": 100.0, "Feb 2031": 250.5}
    assert {x["key"]: x["dr"] for x in r["by_day"]} == {"2031-01-05": 100.0, "2031-02-09": 250.5}
    first = r["rows"][0]
    assert first["no"] == "ZT0001" and first["fields"] == {"NARR": "first", "VCHTYP": "Cash"} and first["month"] == "Jan 2031"
    assert r["captions"]["fields"]["NARR"]  # the Doc Designer's caption, or the tidied column

    only_a = ar.voucher_listing(conn, doc_id=doc, start=date(2031, 1, 1), end=date(2031, 12, 31), ledger_ids=[a], prefix="ZT", fields=[])
    assert {x["ledger"] for x in only_a["rows"]} == {only_a["rows"][0]["ledger"]} and len(only_a["rows"]) == 3
    jan = ar.voucher_listing(conn, doc_id=doc, start=date(2031, 1, 1), end=date(2031, 1, 31), ledger_ids=[], prefix="ZT", fields=[])
    assert len(jan["rows"]) == 2
    assert not ar.voucher_listing(conn, doc_id=doc, start=date(2031, 1, 1), end=date(2031, 12, 31), ledger_ids=[], prefix="NOPE", fields=[])["rows"]


def test_listing_keeps_lines_whose_ledger_is_missing(conn):
    doc = _pay_doc(conn)
    (a,) = _ledger_ids(conn, 1)
    _voucher(conn, "ZT0009", date(2031, 3, 3), "x", "Cash", [(a, 40, 0), (987654, 0, 40)])  # a ledger id the master does not have
    r = ar.voucher_listing(conn, doc_id=doc, start=date(2031, 3, 1), end=date(2031, 3, 31), ledger_ids=[], prefix="ZT", fields=[])
    assert len(r["rows"]) == 2 and r["total"] == {"dr": 40.0, "cr": 40.0}  # the books still add up
    assert "" in {x["ledger"] for x in r["rows"]}


def test_listing_rejects_unknown_field_doc_and_prefix_use(conn):
    doc = _pay_doc(conn)
    with pytest.raises(HTTPException) as e:
        ar.voucher_listing(conn, doc_id=doc, start=None, end=None, ledger_ids=[], prefix="", fields=["NoSuchColumn; DROP TABLE x"])
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        ar.voucher_listing(conn, doc_id=987654, start=None, end=None, ledger_ids=[], prefix="", fields=[])
    assert e.value.status_code == 404


def test_options_come_from_the_doc_designer(conn):
    o = ar.voucher_options(conn)
    expect = {r[0] for r in conn.execute(text("SELECT DocName FROM UtlTransactions WHERE DocType = 'Voucher'"))}
    got = {d["name"] for t in o["types"] for d in t["docs"]}
    assert got and got <= {x.strip() for x in expect}  # only vouchers the designer defines (and whose tables exist)
    info = ar.voucher_doc_info(conn, _pay_doc(conn))
    assert all(f["code"] and f["caption"] is not None for f in info["fields"])


def test_day_book_rows_groups_and_mode(conn):
    if not ar._daybook_sources(conn)[0]:
        pytest.skip("no day-book source in this database")
    a, b = _ledger_ids(conn)
    _voucher(conn, "ZT0101", date(2031, 5, 2), "rent", "Cash", [(a, 300, 0), (b, 0, 300)])
    _voucher(conn, "ZT0102", date(2031, 5, 3), "bank pay", "Bank", [(a, 700, 0), (b, 0, 700)])
    _voucher(conn, "ZT0103", date(2031, 5, 3), "voided", "Cash", [(a, 50, 0), (b, 0, 50)], cancelled="Y")
    r = ar.day_book(conn, start=date(2031, 5, 1), end=date(2031, 5, 31))
    rows = [x for x in r["rows"] if x["no"].startswith("ZT01")]
    assert [x["no"] for x in rows] == ["ZT0101", "ZT0102", "ZT0103"]  # DocType, DocDate, TrnID like the EXE
    assert all(x["paid"] == x["amount"] and x["received"] == 0 for x in rows)
    assert r["total"]["paid"] == 1000.0 and r["total"]["received"] == 0  # the cancelled one is shown, not totalled
    assert r["groups"][0]["paid"] == 1000.0 and r["groups"][0]["doc_type"] == PAY_DOC  # the label is the designer's document name
    assert "Cash" in ar.daybook_options(conn)["modes"] and "Bank" in ar.daybook_options(conn)["modes"]
    cash = ar.day_book(conn, start=date(2031, 5, 1), end=date(2031, 5, 31), mode="Cash")
    assert [x["no"] for x in cash["rows"]] == ["ZT0101", "ZT0103"] and cash["total"]["paid"] == 300.0


def test_day_book_validates_range_and_reports_skipped_sources(conn):
    with pytest.raises(HTTPException) as e:
        ar.day_book(conn, start=date(2031, 6, 2), end=date(2031, 6, 1))
    assert e.value.status_code == 422
    ok, skipped = ar._daybook_sources(conn)
    assert {s["label"] for s in ok}.isdisjoint({s["label"] for s in skipped})  # every source is either used or explained
    for s in skipped:
        assert s["reason"]
