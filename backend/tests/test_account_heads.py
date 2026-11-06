"""Account heads of the voucher grids vs the legacy frmTrnVch rules, on the real database (nothing is committed)."""
import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.services import account_heads as ah
from app.services import voucher_rules
from app.services.payment import VoucherLine


@pytest.fixture()
def conn():
    with get_engine().connect() as c:
        yield c
        c.rollback()


def _allowed_group_ids(conn, doc_id, amt_type):
    rows = conn.execute(
        text(
            "WITH t AS (SELECT LedGroupID FROM MstLedGroup WHERE LedGroupID IN (SELECT LedGroupID FROM UtlAccAmtTypeLedGrps WHERE DocID = :d AND AmtType = :a) "
            "UNION ALL SELECT g.LedGroupID FROM MstLedGroup g JOIN t ON g.PLedGroupID = t.LedGroupID) SELECT LedGroupID FROM t OPTION (MAXRECURSION 32767)"
        ),
        {"d": doc_id, "a": amt_type},
    ).all()
    return {int(r[0]) for r in rows}


def test_side_maps_to_the_legacy_amount_type():
    assert [ah.amt_type(s) for s in ("DR", "TO", "CR", "BY", "x", None)] == ["TO", "TO", "BY", "BY", None, None]


@pytest.mark.parametrize("doc_id,side", [(1224, "DR"), (1224, "CR"), (1248, "DR"), (1248, "CR"), (1254, "DR"), (1254, "CR")])
def test_list_is_exactly_the_ledgers_in_the_allowed_groups(conn, doc_id, side):
    got = ah.list_heads(conn, doc_id=doc_id, side=side)
    assert got["restricted"] is True
    allowed = _allowed_group_ids(conn, doc_id, ah.amt_type(side))
    expected = {
        int(r[0])
        for r in conn.execute(
            text("SELECT a.AcLedID FROM MstAcLed a JOIN MstLed l ON a.LedMstID = l.LEDID WHERE a.LedType = 'L' AND ISNULL(l.InActive,'') <> 'Y'")
        ).all()
        if True
    }
    in_groups = {
        int(r[0])
        for r in conn.execute(
            text("SELECT a.AcLedID FROM MstAcLed a JOIN MstLed l ON a.LedMstID = l.LEDID WHERE a.LedType = 'L' AND ISNULL(l.InActive,'') <> 'Y' AND a.LedGroupID IN :g").bindparams(
                __import__("sqlalchemy").bindparam("g", expanding=True)
            ),
            {"g": list(allowed) or [-1]},
        ).all()
    }
    assert {i["value"] for i in got["items"]} == in_groups <= expected
    assert all(i["group"] for i in got["items"])


def test_journal_is_narrower_than_payment_because_its_group_rule_is(conn):
    pay = {i["value"] for i in ah.list_heads(conn, doc_id=1224, side="DR")["items"]}
    jnl = {i["value"] for i in ah.list_heads(conn, doc_id=1254, side="DR")["items"]}
    assert jnl < pay


def test_document_without_rows_gets_every_active_head(conn):
    got = ah.list_heads(conn, doc_id=1272, side="DR")  # Purchase Voucher has no UtlAccAmtTypeLedGrps rows
    assert got["restricted"] is False
    n = conn.execute(text("SELECT COUNT(*) FROM MstAcLed WHERE ISNULL(InActive,'N') = 'N' AND AcLedID > 0")).scalar()
    assert len(got["items"]) == min(n, ah.MAX_ROWS)


def test_search_filters_on_name(conn):
    items = ah.list_heads(conn, doc_id=1224, side="DR", search="cash")["items"]
    assert items and all("cash" in i["label"].lower() for i in items)
    assert ah.list_heads(conn, doc_id=1224, side="DR", search="zzzzzz-none")["items"] == []


def test_inactive_heads_are_not_listed_and_are_refused(conn):
    new_id = conn.execute(text("SELECT MAX(AcLedID) + 1 FROM MstAcLed")).scalar()
    conn.execute(
        text("INSERT INTO MstAcLed (AcLedID, AcLedName, LedType, LedMstID, InActive, LedGroupId) VALUES (:i, 'ZZ-TEST INACTIVE', 'L', 0, 'Y', 2)"), {"i": new_id}
    )
    assert "ZZ-TEST INACTIVE" not in [i["label"] for i in ah.list_heads(conn, doc_id=1272, side="DR", search="ZZ-TEST")["items"]]
    assert ah.problem(conn, new_id) == "This Account Head is InActive! Please select an Active one from the list."
    with pytest.raises(HTTPException) as e:
        voucher_rules.check_heads(conn, [VoucherLine(ac_led_id=new_id, dr_amt=1)])
    assert e.value.status_code == 422 and "InActive" in e.value.detail


def test_unknown_head_is_refused(conn):
    assert ah.problem(conn, 987654) == "A/c Head does not exist!!"
    assert ah.detail(conn, 987654)["found"] is False
    with pytest.raises(HTTPException):
        voucher_rules.check_heads(conn, [VoucherLine(ac_led_id=987654, dr_amt=1)])


def test_a_party_that_is_not_authorised_is_refused(conn):
    sup = conn.execute(text("SELECT TOP 1 SuppID FROM MstSupp")).scalar()
    if sup is None:
        pytest.skip("no supplier in this database")
    conn.execute(text("UPDATE MstSupp SET Authorised = 'N' WHERE SuppID = :s"), {"s": sup})
    new_id = conn.execute(text("SELECT MAX(AcLedID) + 1 FROM MstAcLed")).scalar()
    conn.execute(
        text("INSERT INTO MstAcLed (AcLedID, AcLedName, LedType, LedMstID, InActive, LedGroupId) VALUES (:i, 'ZZ-TEST PARTY', 'S', :s, 'N', 2)"), {"i": new_id, "s": sup}
    )
    assert ah.problem(conn, new_id) == "Selected Party [ZZ-TEST PARTY] Not Approved...."
    conn.execute(text("UPDATE MstSupp SET Authorised = 'Y' WHERE SuppID = :s"), {"s": sup})
    assert ah.problem(conn, new_id) is None


def test_balance_is_debits_less_credits_of_the_posting_table(conn):
    row = conn.execute(text("SELECT TOP 1 AcLedID FROM TrnDtlAcc GROUP BY AcLedID HAVING SUM(DrAmt - CrAmt) <> 0 ORDER BY AcLedID")).first()
    ac = int(row[0])
    raw = float(conn.execute(text("SELECT SUM(DrAmt - CrAmt) FROM TrnDtlAcc WHERE AcLedID = :i"), {"i": ac}).scalar())
    assert ah.balance(conn, ac) == round(raw, 2)
    d = ah.detail(conn, ac)
    assert d["balance"] == abs(round(raw, 2)) and d["balance_side"] == ("Dr" if raw > 0 else "Cr")
    assert ah.balance(conn, 987654) == 0.0
