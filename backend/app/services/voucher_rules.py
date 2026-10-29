"""
Checks the legacy voucher form (frmTrnVch) makes that the plain Dr/Cr totals do not cover: every account head must exist
and be active, and a receipt that belongs to a Hall Booking is managed from that booking.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection


def check_heads(conn: Connection, lines) -> None:
    """Each line's account head (MstLed) must exist ("A/c Head does not exist!!") and not be InActive."""
    for l in lines:
        row = conn.execute(text("SELECT InActive FROM MstLed WHERE LEDID = :i"), {"i": l.ac_led_id}).first()
        if row is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A/c Head does not exist!!")
        if str(row[0] or "N").strip().upper() == "Y":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This Account Head is InActive! Please select an Active one from the list.")


def assert_not_hall_receipt(conn: Connection, receipt_id: int) -> None:
    """A receipt generated for a Hall Booking keeps that booking's advance / balance in step: change or delete it from
    Hall Booking > Receipt Info (the web app's safeguard; the legacy voucher form would leave the booking out of step)."""
    if conn.execute(text("SELECT TOP 1 1 FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :i AND HBID > 0"), {"i": receipt_id}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "This receipt belongs to a Hall Booking. Change or delete it from Hall Booking > Receipt Info.")
