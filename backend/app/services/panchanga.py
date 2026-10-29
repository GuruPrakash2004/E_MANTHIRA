"""
Panchanga calendar — port of `frmUtlPanchanga`. Writes `MstPanch(PDate, PName)`.

The legacy "Details for the day" grid takes up to 11 details per day and each one is chosen from the Event master
(`MstEvent`, combo of EventName); a value that is not in the master is refused with "Please select a valid event from
master.". The calendar colours a day by the master's `ClrCode` for its event. A day can carry several details, one
`MstPanch` row each.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

MAX_DETAILS = 11  # the legacy grid offers 11 rows


def events(conn: Connection) -> list[dict]:
    """The Event master (real events only: ID 0 is the 'none' placeholder), the list the day dialog chooses from."""
    rows = conn.execute(
        text("SELECT EVENTCODE, EVENTNAME, CLRCODE FROM MstEVENT WHERE EVENTID > 0 AND ISNULL(InActive, 'N') <> 'Y' ORDER BY EVENTNAME")
    ).mappings().all()
    return [{"code": (r["EVENTCODE"] or "").strip(), "name": (r["EVENTNAME"] or "").strip(), "color": (r["CLRCODE"] or "").strip() or None} for r in rows]


def _lookup(conn: Connection) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for e in events(conn):
        out.setdefault(e["name"].lower(), e)
        out.setdefault(e["code"].lower(), e)
    return out


def list_range(conn: Connection, *, from_date: date, to_date: date) -> list[dict]:
    """One entry per day that has details: `name` = the details joined with ", " (as the legacy list does), `names` = each one."""
    rows = conn.execute(text("SELECT PDate, PName FROM MstPanch WHERE PDate >= :f AND PDate <= :t ORDER BY PDate"), {"f": from_date, "t": to_date}).mappings().all()
    ev = _lookup(conn)
    days: dict[str, dict] = {}
    for r in rows:
        iso = r["PDate"].date().isoformat()
        name = (r["PName"] or "").strip()
        if not name:
            continue
        d = days.setdefault(iso, {"date": iso, "names": [], "color": None})
        d["names"].append(name)
        if d["color"] is None and ev.get(name.lower()):
            d["color"] = ev[name.lower()]["color"]
    return [{"date": d["date"], "name": ", ".join(d["names"]), "names": d["names"], "color": d["color"]} for d in days.values()]


def set_day(conn: Connection, *, day: date, names: list[str]) -> None:
    """Replaces the day's details with `names` (an empty list clears the day), every name checked against the Event master."""
    clean: list[str] = []
    for n in names:
        n = (n or "").strip()
        if n and n.lower() not in {c.lower() for c in clean}:
            clean.append(n)
    if len(clean) > MAX_DETAILS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A day can have at most {MAX_DETAILS} details")
    ev = _lookup(conn)
    # the legacy grid checks a detail when it is edited, so a detail the day already carries (entered before the Event master
    # was filled in) stays as it is
    existing = {(r[0] or "").strip().lower(): (r[0] or "").strip() for r in conn.execute(text("SELECT PName FROM MstPanch WHERE PDate = :d"), {"d": day}).all()}
    stored: list[str] = []
    for n in clean:
        hit = ev.get(n.lower())
        if hit is not None:
            stored.append(hit["name"])
        elif n.lower() in existing:
            stored.append(existing[n.lower()])
        else:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please select a valid event from master.")
    conn.execute(text("DELETE FROM MstPanch WHERE PDate = :d"), {"d": day})
    for n in stored:
        conn.execute(text("INSERT INTO MstPanch (PDate, PName) VALUES (:d, :n)"), {"d": day, "n": n})


def delete_day(conn: Connection, *, day: date) -> None:
    conn.execute(text("DELETE FROM MstPanch WHERE PDate = :d"), {"d": day})


# ------------------------------------------------------------------------------------------------ Import from Excel
TEMPLATE_HEADER = ["PANCHANGADATE", "PANCHANGANAME"]


def _parse_date(v: str) -> date | None:
    from datetime import datetime

    v = (v or "").strip()
    for f in ("%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y", "%d %b %Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, f).date()
        except ValueError:
            pass
    return None


def import_preview(conn: Connection, rows: list[list[str]]) -> list[dict]:
    """frmImportPanchangaData.ImportData + ValidateEntry: the sheet must start with PANCHANGADATE, PANCHANGANAME; every
    row is read until the first empty date and flagged "PName Not Found in Event Master" when its name is not an event."""
    head = [(c or "").strip().upper() for c in (rows[0] if rows else [])][:2]
    if head != TEMPLATE_HEADER:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid Template...")
    ev = _lookup(conn)
    out: list[dict] = []
    for r in rows[1:]:
        raw_date = (r[0] if len(r) > 0 else "").strip()
        if not raw_date:
            break
        name = (r[1] if len(r) > 1 else "").strip().replace("'", "`")
        d = _parse_date(raw_date)
        err = ""
        if d is None:
            err = "Invalid Date"
        elif name.lower() not in ev:
            err = "PName Not Found in Event Master"
        out.append({"slno": len(out) + 1, "date": d.isoformat() if d else raw_date, "name": ev[name.lower()]["name"] if name.lower() in ev else name, "error": err})
    if not out:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "There is no data exists for importing")
    return out


def import_save(conn: Connection, rows: list[dict]) -> int:
    """SaveData: nothing is imported while any row is wrong. A day's rows replace what the day had (a day listed
    several times keeps all its names, where the EXE kept only the last one)."""
    if not rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No records found in the selected excel file!")
    ev = _lookup(conn)
    by_day: dict[date, list[str]] = {}
    for r in rows:
        d = _parse_date(str(r.get("date") or ""))
        name = str(r.get("name") or "").strip()
        if d is None or name.lower() not in ev:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Importing of data is not allowed until all the data is correct.")
        names = by_day.setdefault(d, [])
        if ev[name.lower()]["name"] not in names:
            names.append(ev[name.lower()]["name"])
    for d, names in by_day.items():
        if len(names) > MAX_DETAILS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A day can have at most {MAX_DETAILS} details")
        conn.execute(text("DELETE FROM MstPanch WHERE PDate = :d"), {"d": d})
        for n in names:
            conn.execute(text("INSERT INTO MstPanch (PDate, PName) VALUES (:d, :n)"), {"d": d, "n": n})
    return len(rows)


# ------------------------------------------------------------------------------------------------ Rathothsava date
def get_rath(conn: Connection) -> dict:
    r = conn.execute(text("SELECT TOP 1 RathDate, BlkBkg FROM UtlMisc")).mappings().first() or {}
    d = r.get("RathDate")
    return {"date": d.date().isoformat() if d else None, "enabled": (r.get("BlkBkg") or "N").strip().upper() == "Y"}


def save_rath(conn: Connection, *, day: date | None, enabled: bool) -> None:
    """btnUpdate_Click: UtlMisc.RathDate = the date, UtlMisc.BlkBkg = Y / N (the "Rathothsava Date" tick)."""
    if day is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select the Rathothsava date")
    conn.execute(text("UPDATE UtlMisc SET RathDate = :d, BlkBkg = :b"), {"d": day, "b": "Y" if enabled else "N"})
