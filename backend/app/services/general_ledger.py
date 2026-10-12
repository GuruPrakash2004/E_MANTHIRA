"""
General Ledger report — port of `FrmRptAccGL` (doc 07 §5.8): "from-to,
ledger/customer/supplier, summary/detail, multiple accounts, hide zero" ·
`TrnHdrAcc`/`TrnDtlAcc` + `vwAcLed` + `vwLedMainGrp`, opening balance before
from-date within FY.

Opening balance = `vwAcLed.OPBal` (the ledger's book-opening for the current
FY) + every posting dated on/after the FY start but before `from_date`.
Closing = opening + everything posted in [from_date, to_date]. One
ledger "card" per requested AcLedID, exactly like flipping to that
ledger's page in a physical ledger book.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection


def _ledger_name(conn: Connection, ac_led_id: int) -> tuple[str, float]:
    row = conn.execute(text("SELECT AcLedName, OPBal FROM vwAcLed WHERE AcLedID = :id"), {"id": ac_led_id}).mappings().first()
    if row is None:
        return f"Ledger {ac_led_id}", 0.0
    return row["AcLedName"], float(row["OPBal"] or 0)


def _movement(conn: Connection, *, ac_led_id: int, start: date, end_excl: date) -> float:
    """Net Dr-Cr movement for one ledger in [start, end_excl)."""
    row = conn.execute(
        text(
            """
            SELECT COALESCE(SUM(d.DrAmt), 0) - COALESCE(SUM(d.CrAmt), 0) AS net
            FROM TrnDtlAcc d JOIN TrnHdrAcc h ON h.AccID = d.AccID
            WHERE d.AcLedID = :led AND h.TrnDate >= :start AND h.TrnDate < :end_excl
            """
        ),
        {"led": ac_led_id, "start": start, "end_excl": end_excl},
    ).scalar()
    return float(row or 0)


def general_ledger(
    conn: Connection,
    *,
    ac_led_ids: list[int],
    from_date: date,
    to_date: date,
    fy_start_date: date,
    mode: str = "detail",  # "detail" | "summary"
    hide_zero: bool = False,
) -> list[dict]:
    from datetime import timedelta

    to_date_excl = to_date + timedelta(days=1)
    cards = []
    for ac_led_id in ac_led_ids:
        name, op_bal = _ledger_name(conn, ac_led_id)
        opening = op_bal + _movement(conn, ac_led_id=ac_led_id, start=fy_start_date, end_excl=from_date)

        rows = []
        if mode == "detail":
            stmt = text(
                """
                SELECT h.TrnDate, h.DocType, h.TrnNo, h.Narrn, d.DrAmt, d.CrAmt
                FROM TrnDtlAcc d JOIN TrnHdrAcc h ON h.AccID = d.AccID
                WHERE d.AcLedID = :led AND h.TrnDate >= :from_date AND h.TrnDate < :to_date_excl
                ORDER BY h.TrnDate, d.AccID
                """
            )
            running = opening
            for r in conn.execute(stmt, {"led": ac_led_id, "from_date": from_date, "to_date_excl": to_date_excl}).mappings():
                dr = float(r["DrAmt"] or 0)
                cr = float(r["CrAmt"] or 0)
                running += dr - cr
                rows.append(
                    {
                        "date": r["TrnDate"].date().isoformat(),
                        "doc_type": r["DocType"],
                        "trn_no": r["TrnNo"],
                        "narration": r["Narrn"],
                        "dr": dr,
                        "cr": cr,
                        "balance": round(running, 2),
                    }
                )
            closing = running
        else:
            closing = opening + _movement(conn, ac_led_id=ac_led_id, start=from_date, end_excl=to_date_excl)

        if hide_zero and round(opening, 2) == 0 and round(closing, 2) == 0:
            continue

        cards.append(
            {
                "ac_led_id": ac_led_id,
                "name": name,
                "opening": round(opening, 2),
                "closing": round(closing, 2),
                "total_dr": round(sum(r["dr"] for r in rows), 2),
                "total_cr": round(sum(r["cr"] for r in rows), 2),
                "rows": rows,
            }
        )
    return cards
