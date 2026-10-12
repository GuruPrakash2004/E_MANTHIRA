"""
Proves the fixed overlap check (D-04) rejects bookings the legacy check
would have silently allowed. See app/services/hall.py module docstring for
the exact legacy bug (`newFrom >= HBSTARTDT AND newTo <= HBENDDT`, which only
catches a new booking fully CONTAINED inside an existing one).

Uses a hall (KESHAVA SADHANA, id 2) that has no real bookings in the sample
data, and cleans up everything it creates.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import text

from app.core.db import with_transaction
from app.services import hall as hall_service

TEST_HALL_ID = 2


def _legacy_would_flag(existing_from: date, existing_to: date, new_from: date, new_to: date) -> bool:
    """The exact (buggy) legacy SQL condition, for comparison in this test."""
    return new_from >= existing_from and new_to <= existing_to


def test_fixed_overlap_rejects_cases_legacy_missed(conn):
    existing_from, existing_to = date(2027, 1, 10), date(2027, 1, 15)

    cases = [
        # (new_from, new_to, legacy catches it?, must be rejected by us)
        ((date(2027, 1, 13), date(2027, 1, 18)), False, True),  # starts inside, ends after
        ((date(2027, 1, 5), date(2027, 1, 12)), False, True),  # starts before, ends inside
        ((date(2027, 1, 1), date(2027, 1, 20)), False, True),  # completely contains the existing booking
        ((date(2027, 1, 11), date(2027, 1, 14)), True, True),  # fully inside — legacy catches this one too
        ((date(2027, 1, 20), date(2027, 1, 25)), False, False),  # genuinely free — must stay allowed
    ]

    with with_transaction() as tx:
        hb_id = _make_test_booking(tx, existing_from, existing_to)
        try:
            for (new_from, new_to), legacy_catches, must_reject in cases:
                assert _legacy_would_flag(existing_from, existing_to, new_from, new_to) == legacy_catches
                is_free = hall_service.check_availability(tx, hall_id=TEST_HALL_ID, start_date=new_from, end_date=new_to)
                assert is_free == (not must_reject), f"{new_from}..{new_to}: expected free={not must_reject}, got free={is_free}"
        finally:
            tx.execute(text("DELETE FROM TrnST WHERE HBID = :id"), {"id": hb_id})
            tx.execute(text("DELETE FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id})


def _make_test_booking(conn, start: date, end: date) -> int:
    from app.legacy.tables import insert_row

    hb_id = insert_row(
        conn,
        "TrnHdrHB",
        {
            "HBNO": "TESTOVERLAP001",
            "Prefix": "TST",
            "PrintHBNO": "TESTOVERLAP001",
            "HBDate": start,
            "Authorised": "Y",
            "Cancelled": "N",
            "AddedBy": "TEST",
            "AddedOn": datetime.now(),
            "TYPE": "HALL BOOKING",
            "HALLID": TEST_HALL_ID,
            "HBSTARTDT": start,
            "HBENDDT": end,
            "CONTACTNO": "0000000000",
            "AMOUNT": 1,
            "TOTAMT": 1,
            "NETPAY": 1,
            "BALAMT": 1,
        },
        returning="HBID",
    )
    return hb_id
