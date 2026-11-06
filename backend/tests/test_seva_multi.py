"""Several sevas for one devotee in one save (seva.create_many). Needs the real DB; everything runs in a transaction that is rolled back."""
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.core.fy import get_active_fy
from app.services import seva as sv

FIELD_KEYS = ["SANNIDHIID", "SVAID", "MOBNUM", "KNAME", "GOTHRAID", "NAKSHATRAID", "RASHIID", "PAYMENT", "LEDGER", "LEDID", "VCHTYP",
              "SecKNAME", "SECNAKSHATRAID", "SECRASHIID", "NAMEINKAN", "REFNO", "BANKNAME", "ADDRES", "PRASADA"]


@pytest.fixture()
def ctx():
    eng = get_engine()
    with eng.connect() as c:
        last_id = c.execute(text("SELECT MAX(SEVAID) FROM TrnHdrSEVA WHERE Cancelled='N' AND SEVAID IN (SELECT SevaID FROM TrnDtlSevaDates)")).scalar()
        if not last_id:
            pytest.skip("no saved seva to use as a template")
        last = sv.get(c, last_id)
        fy = get_active_fy(c)
        paid = [int(r[0]) for r in c.execute(text("SELECT SVAID FROM MstSVA WHERE SVAID > 0 AND AMT > 0 AND SVAID <> :m ORDER BY SVAID"), {"m": int(last["SVAID"])})]
        free = c.execute(text("SELECT TOP 1 SVAID FROM MstSVA WHERE SVAID > 0 AND AMT = 0")).scalar()
    if not fy.start_date <= date.today() <= fy.end_date:
        pytest.skip("today is outside this database's active financial year, so no bill can be saved")
    if len(paid) < 2:
        pytest.skip("need at least two more sevas with a rate")
    fields = {k: last[k] for k in FIELD_KEYS if k in last and last[k] not in (None, "")}
    conn = eng.connect()
    tx = conn.begin()
    try:
        yield conn, fy, fields, paid, free
    finally:
        tx.rollback()
        conn.close()


def _data(fields, fy):
    day = min(max(date.today(), fy.start_date), fy.end_date)  # a date inside whichever financial year this database has active
    return sv.SevaInput(fields=fields, dates=[sv.SevaDate(perform_date=day)], doc_date=day)


def _count(conn):
    return conn.execute(text("SELECT COUNT(*) FROM TrnHdrSEVA")).scalar()


def test_one_bill_per_seva_with_receipts(ctx):
    conn, fy, fields, paid, _ = ctx
    before = _count(conn)
    bills = sv.create_many(conn, data=_data(fields, fy), extra_seva_ids=paid[:2], fy=fy, user_code="ADMIN")
    assert len(bills) == 3 and _count(conn) == before + 3
    assert len({b["seva_no"] for b in bills}) == 3  # own bill number each
    assert [b["seva_id"] for b in bills] == sorted(b["seva_id"] for b in bills)
    saved = {int(conn.execute(text("SELECT SVAID FROM TrnHdrSEVA WHERE SEVAID = :i"), {"i": b["seva_id"]}).scalar()) for b in bills}
    assert saved == {int(fields["SVAID"]), *paid[:2]}
    for b in bills:  # one receipt + GL posting per bill (when the temple has auto-receipt on)
        if b["receipt_no"]:
            assert conn.execute(text("SELECT COUNT(*) FROM TrnHdrRCPTVCH WHERE RCPTVCHNO = :n"), {"n": b["receipt_no"]}).scalar() >= 1


def test_duplicate_of_main_seva_is_ignored(ctx):
    conn, fy, fields, paid, _ = ctx
    bills = sv.create_many(conn, data=_data(fields, fy), extra_seva_ids=[int(fields["SVAID"]), paid[0], paid[0]], fy=fy, user_code="ADMIN")
    assert len(bills) == 2


def test_failure_names_the_seva_and_writes_nothing(ctx):
    conn, fy, fields, paid, free = ctx
    if not free:
        pytest.skip("no zero-rate seva to force a failure")
    before = _count(conn)
    nested = conn.begin_nested()  # the endpoint's transaction rolls back as a whole; a savepoint does the same here
    with pytest.raises(HTTPException) as exc:
        sv.create_many(conn, data=_data(fields, fy), extra_seva_ids=[paid[0], free], fy=fy, user_code="ADMIN")
    nested.rollback()
    assert "greater than 0" in exc.value.detail.lower() and ": " in exc.value.detail  # "<seva name>: <reason>"
    assert _count(conn) == before


def test_unknown_seva_is_rejected(ctx):
    conn, fy, fields, _, _ = ctx
    with pytest.raises(HTTPException) as exc:
        sv.create_many(conn, data=_data(fields, fy), extra_seva_ids=[999999], fy=fy, user_code="ADMIN")
    assert exc.value.status_code == 422
