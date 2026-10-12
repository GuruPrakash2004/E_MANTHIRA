"""
Public seva display board — port of "Display in Browser" (doc 07 §5.9):
"public read-only page /display showing today's/next sevas (replaces
WebDisplayURL)". `UtlGSettings.WebDisplayURL` is live-configured for this
client (http://192.168.1.49/displayseva/ — a real, actively-used setting,
not idle cruft), so this replaces an actual deployed feature.

Deliberately UNAUTHENTICATED — the whole point is a public board (e.g. a TV
screen at the temple counter) devotees can see without logging in. Read-only,
no write endpoints here, so there's nothing this can leak or corrupt.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn

router = APIRouter(prefix="/display", tags=["display"])


@router.get("/today-sevas")
def today_sevas(conn: Connection = Depends(get_conn)):
    today = date.today()
    rows = conn.execute(
        text(
            """
            SELECT h.KNAME, h.SECKNAME, s.SANNIDHINAME, sv.SVADISPNAME, h.DaysPrintText
            FROM TrnHdrSEVA h
            LEFT JOIN MstSANNIDHI s ON s.SANNIDHIID = h.SANNIDHIID
            LEFT JOIN MstSVA sv ON sv.SVAID = h.SVAID
            WHERE h.Cancelled = 'N' AND h.SEVADate >= :today AND h.SEVADate < DATEADD(day, 1, CAST(:today AS date))
            ORDER BY h.SEVAID
            """
        ),
        {"today": today},
    ).mappings().all()
    return [
        {
            "name": r["KNAME"],
            "name2": r["SECKNAME"] or "",
            "sannidhi": r["SANNIDHINAME"] or "",
            "seva": r["SVADISPNAME"] or "",
            "date_text": r["DaysPrintText"] or "",
        }
        for r in rows
    ]
