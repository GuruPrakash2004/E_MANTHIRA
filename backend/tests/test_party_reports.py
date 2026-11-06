"""Receivable / payable reports on SYNTHETIC postings. Real DB; everything is inserted inside a transaction that is always rolled
back. The bill-wise engine is also compared with the database's own stored procedure `mSP_AcBillWisePendReport`."""
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.legacy.tables import insert_row
from app.services import party_reports as pr

FAR = date(2099, 12, 31)


@pytest.fixture()
def conn():
    c = get_engine().connect()
    tx = c.begin()
    try:
        yield c
    finally:
        tx.rollback()
        c.close()


def _ctx(conn, kind):
    ctx = pr._kind(conn, kind)
    if "missing" in ctx:
        pytest.skip(f"this database lacks {ctx['missing']}")
    return ctx


def _party(conn, ctx, code, name, group_id=0):
    """A party master row + its accounting ledger (MstAcLed). Returns (party id, AcLedID)."""
    doc = conn.execute(text("SELECT TOP 1 DocID FROM UtlTransactions WHERE HdrTblName = :t"), {"t": ctx["table"]}).scalar()
    pid = int(conn.execute(text(f"SELECT ISNULL(MAX({ctx['id']}), 0) + 1 FROM {ctx['table']}")).scalar())  # masters are MAX(id)+1, not identity
    insert_row(conn, ctx["table"], {ctx["id"]: pid, ctx["code"]: code, ctx["name"]: name, "InActive": "N", "Authorised": "Y", "AddedBy": "T", "AddedOn": datetime(2031, 1, 1), **({ctx["group_col"]: group_id} if ctx["group_col"] else {}), "BAdd1": "12 Temple Road", "BAdd2": "Mysuru"})
    led = int(conn.execute(text("SELECT ISNULL(MAX(AcLedID), 0) + 1 FROM MstAcLed")).scalar())
    insert_row(conn, "MstAcLed", {"AcLedID": led, "AcLedName": name, "LedType": ctx["led_type"], "LedMstID": pid, "OPBal": 0, "CLBal": 0, "InActive": "N", "LedGroupId": 0, "MstDocID": doc or 0})
    return pid, led


def _post(conn, acc_type, doc_type, no, day, due, lines, adj=()):
    """One posting: lines = [(AcLedID, dr, cr)]; adj = [(AcLedID, adj_type, dr, cr, against_acc_id, new_ref)]."""
    acc = insert_row(conn, "TrnHdrAcc", {"DocType": doc_type, "AccType": acc_type, "TrnID": 0, "TrnNo": no, "TrnDate": day, "DueDate": due, "Narrn": ""}, returning="AccID")
    for led, dr, cr in lines:
        insert_row(conn, "TrnDtlAcc", {"AccID": acc, "AcLedID": led, "DrAmt": dr, "CrAmt": cr})
    for led, typ, dr, cr, against, ref in adj:
        insert_row(conn, "TrnDtlAccAdj", {"AccID": acc, "AcLedID": led, "AdjAgnstAccID": against, "DrAmt": dr, "CrAmt": cr, "AdjType": typ, "NewRefNo": ref})
    return acc


@pytest.fixture()
def world(conn):
    """Two customers and a supplier with a small bill-wise history (all in 2031, far from real data)."""
    rc, pc = _ctx(conn, "receivable"), _ctx(conn, "payable")
    _, a = _party(conn, rc, "ZA01", "Zed Alpha")
    _, b = _party(conn, rc, "ZB01", "Zed Beta")
    _, s = _party(conn, pc, "ZS01", "Zed Supplier")
    d = date
    ob = _post(conn, "B", "OP", "OP1", d(2031, 1, 1), d(2031, 1, 31), [(a, 1000, 0)])
    inv = _post(conn, "V", "SINV", "INV-1", d(2031, 2, 1), d(2031, 2, 15), [(a, 5000, 0)], [(a, "N", 5000, 0, 0, "INV-1")])
    # R1 settles the opening bill fully (1000) and 2000 of the invoice; it was posted on 2031-02-20
    _post(conn, "V", "RCPT", "R1", d(2031, 2, 20), d(2031, 2, 20), [(a, 0, 3000)], [(a, "A", 1000, 0, ob, ""), (a, "A", 2000, 0, inv, "")])
    # R2: 500 received on account (no bill named)
    _post(conn, "V", "RCPT", "R2", d(2031, 3, 5), d(2031, 3, 5), [(a, 0, 500)])
    # Beta owes only an opening bill, due later
    _post(conn, "B", "OP", "OPB", d(2031, 1, 1), d(2031, 4, 30), [(b, 700, 0)])
    # supplier: opening 2000 payable, a purchase 800 (new ref), 600 paid against the opening bill (bill side = credit)
    sob = _post(conn, "B", "OP", "SOP", d(2031, 1, 1), d(2031, 2, 1), [(s, 0, 2000)])
    _post(conn, "V", "PB", "PB-1", d(2031, 2, 10), d(2031, 3, 10), [(s, 0, 800)], [(s, "N", 0, 800, 0, "PB-1")])
    _post(conn, "V", "PMT", "P1", d(2031, 3, 1), d(2031, 3, 1), [(s, 600, 0)], [(s, "A", 0, 600, sob, "")])
    return {"a": a, "b": b, "s": s, "rc": rc, "pc": pc}


def _bills(res, led):
    return {(x["ref"], x["doc_amt"], x["adjusted"], x["balance"]) for x in res["bills"] if x["acled_id"] == led}


def test_engine_bills_adjustments_and_balances(conn, world):
    rc = world["rc"]
    res = pr.pending_bills(conn, rc, date(2031, 12, 31), [world["a"], world["b"]])
    assert _bills(res, world["a"]) == {("INV-1", 5000.0, 2000.0, 3000.0)}  # the opening bill was settled in full and drops out
    assert _bills(res, world["b"]) == {("OPB", 700.0, 0.0, 700.0)}
    # as on a date BEFORE the receipt, the invoice and the opening bill are both still open
    early = pr.pending_bills(conn, rc, date(2031, 2, 10), [world["a"]])
    assert _bills(early, world["a"]) == {("OP1", 1000.0, 0.0, 1000.0), ("INV-1", 5000.0, 0.0, 5000.0)}
    sup = pr.pending_bills(conn, world["pc"], date(2031, 12, 31), [world["s"]])
    assert _bills(sup, world["s"]) == {("SOP", -2000.0, -600.0, -1400.0), ("PB-1", -800.0, 0.0, -800.0)}  # credit bills are negative Dr-Cr


def test_on_account_reconciles_to_the_ledger_balance(conn, world):
    rc = world["rc"]
    res = pr.pending_bills(conn, rc, date(2031, 12, 31), [world["a"], world["b"]])
    a = world["a"]
    assert res["on_account"][a] == -500.0 and res["ledger_balance"][a] == 2500.0  # 1000 + 5000 - 3000 - 500
    for led in (world["a"], world["b"]):
        bills = sum(x["balance"] for x in res["bills"] if x["acled_id"] == led)
        assert round(bills + res["on_account"][led], 2) == res["ledger_balance"][led]
    sup = pr.pending_bills(conn, world["pc"], date(2031, 12, 31), [world["s"]])
    s = world["s"]
    assert round(sum(x["balance"] for x in sup["bills"]) + sup["on_account"][s], 2) == sup["ledger_balance"][s] == -2200.0


def test_engine_matches_the_databases_own_stored_procedure(conn, world):
    """mSP_AcBillWisePendReport is what the EXE's ageing report calls; same postings, same answer."""
    if not conn.execute(text("SELECT 1 FROM sys.procedures WHERE name = 'mSP_AcBillWisePendReport'")).scalar():
        pytest.skip("the procedure is not in this database")
    for kind, ac_type, leds in (("receivable", "R", [world["a"], world["b"]]), ("payable", "P", [world["s"]])):
        ctx = world["rc"] if kind == "receivable" else world["pc"]
        cur = conn.connection.cursor()  # the procedure builds its result with dynamic SQL; NOCOUNT keeps the driver from stopping at a row-count message
        cur.execute("SET NOCOUNT ON; EXEC mSP_AcBillWisePendReport ?, ?", ac_type, ",".join(str(x) for x in leds))
        cols = [c[0] for c in cur.description]
        proc = [dict(zip(cols, r)) for r in cur.fetchall()]
        theirs = sorted((r["AcLedName"].strip(), r["doctype"].strip(), r["trnno"].strip(), r["trndate"].date(), float(r["docAmt"]), float(r["CumAdjamt"]), float(r["BalAmt"])) for r in proc)
        names = {w[1]: w[0] for w in conn.execute(text("SELECT AcLedName, AcLedID FROM MstAcLed WHERE AcLedID IN (" + ",".join(str(x) for x in leds) + ")")).all()}
        mine = pr.pending_bills(conn, ctx, FAR, leds)
        ours = sorted((names[x["acled_id"]], x["doc_type"], x["ref"], date.fromisoformat(x["date"]), x["doc_amt"], x["adjusted"], x["balance"]) for x in mine["bills"])
        assert ours == theirs, (kind, ours, theirs)


def test_outstanding_detail_receivable_and_payable(conn, world):
    d = pr.outstanding_detail(conn, "receivable", date(2031, 3, 31), [world["a"], world["b"]], [])
    by = {p["code"]: p for p in d["parties"]}
    assert set(by) == {"ZA01", "ZB01"}
    a = by["ZA01"]
    assert [(b["ref"], b["balance"], b["age"]) for b in a["bills"]] == [("INV-1", 3000.0, 44)]  # due 15 Feb, as on 31 Mar
    assert a["on_account"] == 500.0 and a["balance"] == 3000.0  # a 500 advance is reported separately, not netted into the bills
    assert d["total"]["balance"] == 3700.0
    p = pr.outstanding_detail(conn, "payable", date(2031, 3, 31), [world["s"]], [])
    bills = {b["ref"]: b["balance"] for b in p["parties"][0]["bills"]}
    assert bills == {"SOP": 1400.0, "PB-1": 800.0} and p["total"]["balance"] == 2200.0  # payables are shown as positive amounts


def test_outstanding_summary_opening_debit_credit(conn, world):
    s = pr.outstanding_summary(conn, "receivable", date(2031, 2, 1), date(2031, 2, 28), [world["a"]], [], 0, False)
    (r,) = s["rows"]
    assert (r["opening"], r["debit"], r["credit"], r["balance"]) == (1000.0, 5000.0, 3000.0, 3000.0)
    later = pr.outstanding_summary(conn, "receivable", date(2031, 3, 1), date(2031, 3, 31), [world["a"]], [], 0, False)
    assert (later["rows"][0]["opening"], later["rows"][0]["credit"], later["rows"][0]["balance"]) == (3000.0, 500.0, 2500.0)
    # threshold: a balance not above it is left out; "show excess" lists any non-zero balance
    assert not pr.outstanding_summary(conn, "receivable", date(2031, 2, 1), date(2031, 2, 28), [world["a"]], [], 3000, False)["rows"]
    pay = pr.outstanding_summary(conn, "payable", date(2031, 1, 1), date(2031, 12, 31), [world["s"]], [], 0, False)
    assert pay["rows"][0]["balance"] == -2200.0  # payables are credit balances
    assert pr.outstanding_summary(conn, "payable", date(2031, 1, 1), date(2031, 12, 31), [world["s"]], [], 0, True)["rows"]


def test_party_wise_outstanding_debit_credit_columns_and_thresholds(conn, world):
    r = pr.party_outstanding(conn, "receivable", date(2031, 12, 31), [world["a"], world["b"]], [], 0, 0)
    assert {x["code"]: (x["debit"], x["credit"]) for x in r["rows"]} == {"ZA01": (2500.0, 0.0), "ZB01": (700.0, 0.0)}
    assert [x["code"] for x in pr.party_outstanding(conn, "receivable", date(2031, 12, 31), [world["a"], world["b"]], [], 1000, 0)["rows"]] == ["ZA01"]
    sup = pr.party_outstanding(conn, "payable", date(2031, 12, 31), [world["s"]], [], 0, 0)
    assert sup["rows"][0]["debit"] == 0 and sup["rows"][0]["credit"] == 2200.0
    early = pr.party_outstanding(conn, "receivable", date(2031, 2, 10), [world["a"]], [], 0, 0)  # honours the as-on date
    assert early["rows"][0]["debit"] == 6000.0


def test_ageing_buckets_partywise_and_billwise(conn, world):
    buckets = [{"from": 0, "to": 30}, {"from": 31, "to": 60}, {"from": 61, "to": None}]
    r = pr.ageing(conn, "receivable", date(2031, 3, 31), [world["a"], world["b"]], buckets, True, 0, 0)
    assert r["labels"] == ["0 to 30", "31 to 60", ">= 61"]
    by = {p["code"]: p for p in r["parties"]}
    assert by["ZA01"]["buckets"] == [0.0, 3000.0, 0.0]  # INV-1 is 44 days past due
    assert by["ZB01"]["not_due"] == 700.0 and by["ZB01"]["buckets"] == [0.0, 0.0, 0.0]  # due 30 Apr: not yet due on 31 Mar
    assert r["total"]["buckets"] == [0.0, 3000.0, 0.0] and r["total"]["not_due"] == 700.0
    assert [b["age"] for b in r["bills"] if b["party_code"] == "ZA01"] == [44]
    later = pr.ageing(conn, "receivable", date(2031, 6, 30), [world["a"]], buckets, False, 0, 0)
    assert later["parties"][0]["buckets"] == [0.0, 0.0, 3000.0] and later["bills"] == []  # 135 days past due, now in the last open range
    assert pr.ageing(conn, "receivable", date(2031, 3, 31), [world["a"]], buckets, False, 3000, 0)["parties"] == []  # not over the debit threshold


def test_ageing_needs_the_ranges_from_the_user_or_the_database(conn, world):
    with pytest.raises(HTTPException) as e:
        pr.ageing(conn, "receivable", date(2031, 3, 31), [world["a"]], [], False, 0, 0)
    assert e.value.status_code == 422 and "AgeBuckets" in e.value.detail
    conn.execute(text("INSERT INTO UtlGSettings (SetGroup, SetName, SetValue, SetCaption, Remarks, HideSetting) VALUES ('Accounting', 'AgeBuckets', '0-30;31-60;61+', 'Ageing ranges', '', 'N')"))
    r = pr.ageing(conn, "receivable", date(2031, 3, 31), [world["a"]], [], False, 0, 0)  # the ranges now come from the setting
    assert r["labels"] == ["0 to 30", "31 to 60", ">= 61"]
    assert pr.parse_buckets("0-30; 31-60 ;bad;181+") == [{"from": 0, "to": 30}, {"from": 31, "to": 60}, {"from": 181, "to": None}]


def test_reminders_omit_small_totals_and_carry_addresses(conn, world):
    r = pr.reminders(conn, "receivable", date(2031, 3, 31), [world["a"], world["b"]], [], 0)
    assert {p["code"] for p in r["parties"]} == {"ZA01", "ZB01"}
    assert next(p for p in r["parties"] if p["code"] == "ZA01")["address"] == ["12 Temple Road", "Mysuru"]
    only_big = pr.reminders(conn, "receivable", date(2031, 3, 31), [world["a"], world["b"]], [], 1000)
    assert [p["code"] for p in only_big["parties"]] == ["ZA01"] and only_big["total"]["balance"] == 3000.0


def test_party_lists_and_unavailable_databases(conn, world, monkeypatch):
    assert [p["code"] for p in pr.parties(conn, "receivable", "ZA0")] == ["ZA01"]
    assert pr.options(conn, "receivable", "Customer OutStanding")["available"]
    monkeypatch.setattr(pr, "_kind", lambda c, k: {"missing": ["TrnDtlAccAdj"], "kind": k})
    assert pr.outstanding_detail(conn, "receivable", FAR, [], [])["available"] is False
    assert pr.ageing(conn, "receivable", FAR, [], [{"from": 0, "to": None}], False, 0, 0)["missing"] == ["TrnDtlAccAdj"]
    assert pr.parties(conn, "receivable") == []


def test_existing_outstanding_screen_works_without_the_procedure_and_view(conn, world):
    """The Customer / Supplier OutStanding screen (trading_reports) falls back to the engine when a database has no
    mSP_RptAccBillWisePend_* procedure or vwAcLed view; the figures are the ones asserted above."""
    from app.services import trading_reports as tr

    a, b, s = world["a"], world["b"], world["s"]
    detail = tr.party_outstanding_detail(conn, party="C", to_date=date(2031, 3, 31), ac_ids=[a, b])
    if conn.execute(text("SELECT 1 FROM sys.procedures WHERE name = 'mSP_RptAccBillWisePend_Cust'")).first():
        pytest.skip("this database has its own procedure; the fallback is not used")
    rows = {(r["party_code"], r["trn_no"]): (r["doc_amt"], r["rcvd_amt"], r["balance"]) for r in detail["rows"]}
    assert rows == {("ZA01", "INV-1"): (5000.0, 2000.0, 3000.0), ("ZB01", "OPB"): (700.0, 0.0, 700.0)}
    sup = tr.party_outstanding_detail(conn, party="S", to_date=date(2031, 3, 31), ac_ids=[s])
    assert {r["trn_no"]: r["balance"] for r in sup["rows"]} == {"SOP": 1400.0, "PB-1": 800.0}  # payables as positive amounts
    summary = tr.party_outstanding(conn, party="C", from_date=date(2031, 2, 1), to_date=date(2031, 2, 28), receivable=True, min_amount=0, show_all_nonzero=False, group_ids=None, ac_ids=[a])
    (row,) = summary["rows"]
    assert (row["party_code"], row["opening"], row["debit"], row["credit"], row["balance"]) == ("ZA01", 1000.0, 5000.0, 3000.0, 3000.0)
    assert summary["totals"]["balance"] == 3000.0


def test_payment_plan_spreads_a_payment_over_bills_in_due_date_order(conn, world):
    s = world["s"]
    plan = pr.payment_plan(conn, date(2031, 3, 31), [s], 0, {s: 1500})
    (p,) = plan["parties"]
    assert p["balance"] == 2200.0 and p["pay"] == 1500.0
    by = {b["ref"]: b["allocate"] for b in p["bills"]}
    assert by == {"SOP": 1400.0, "PB-1": 100.0}  # SOP is due first (1 Feb), then PB-1 (10 Mar); 1500 - 1400 = 100 to the next bill
    assert p["allocated"] == 1500.0 and p["on_account"] == 0.0
    over = pr.payment_plan(conn, date(2031, 3, 31), [s], 0, {s: 5000})["parties"][0]
    assert over["allocated"] == 2200.0 and over["on_account"] == 2800.0  # more than is owed: the rest is left on account
    assert pr.payment_plan(conn, date(2031, 3, 31), [s], 0, {})["parties"][0]["allocated"] == 0.0
    assert not pr.payment_plan(conn, date(2031, 3, 31), [s], 1000, {})["parties"]  # owes 2200, more than the 1000 limit
