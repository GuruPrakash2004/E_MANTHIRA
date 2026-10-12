"""
Panchanga calendar — port of `frmUtlPanchanga` (doc 07 §5.7). Writes
`MstPanch(PDate, PName)`; "double-click a day -> details dialog", "Import
from Excel (validates PName exists in MstEVENT.EVENTCODE, replaces same
date)". Note: this client's real `MstPanch` data (66 rows, e.g. 'Amavasya',
'Rathosthava') does NOT correspond to any real `MstEVENT` row (only the
placeholder EVENTID=0 exists there) — so `PName` is treated as free text
here, with `MstEVENT` used only as an OPTIONAL colour hint when it happens
to match, not a hard foreign key the legacy Excel importer would enforce
against actual usage.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection


def list_range(conn: Connection, *, from_date: date, to_date: date) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT p.PDate, p.PName, e.CLRCODE
            FROM MstPanch p
            LEFT JOIN MstEVENT e ON e.EVENTCODE = p.PName AND e.EVENTID <> 0
            WHERE p.PDate >= :f AND p.PDate <= :t
            ORDER BY p.PDate
            """
        ),
        {"f": from_date, "t": to_date},
    ).mappings().all()
    return [{"date": r["PDate"].date().isoformat(), "name": r["PName"], "color": r["CLRCODE"]} for r in rows]


def set_day(conn: Connection, *, day: date, name: str) -> None:
    """"Replaces same date" — same semantics as the legacy Excel importer."""
    conn.execute(text("DELETE FROM MstPanch WHERE PDate = :d"), {"d": day})
    if name.strip():
        conn.execute(text("INSERT INTO MstPanch (PDate, PName) VALUES (:d, :n)"), {"d": day, "n": name.strip()})


def delete_day(conn: Connection, *, day: date) -> None:
    conn.execute(text("DELETE FROM MstPanch WHERE PDate = :d"), {"d": day})
