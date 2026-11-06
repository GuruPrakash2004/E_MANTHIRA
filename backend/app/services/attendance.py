"""
Attendance (legacy frmUtlAttendance, daily) and Attendance Monthly (frmUtlAttMonth), ported from the decompiled EXE.

Tables: `MstSTAFF` (staff master) and `UtlAttendance` (AttDate, STAFFID, AttType, UpdatedBy/On, ChangedBy/On). Neither is
created or altered here: a database without them reports `available: false`.

NOTHING about the attendance rules is built into the code. The EXE kept the types ("P|HD|A"), their meaning and the
time windows as literals; here they are `UtlGSettings` rows (group `Attendance`) that an admin adds in Global Settings:

  AttTypes    CODE=Label[:weight]|CODE=Label[:weight]...   e.g. P=Present:1|HD=Half Day:0.5|A=Absent:1
              weight = what one mark counts for in the monthly totals (default 1)
  AttWindows  HH:MM=CODE,CODE;HH:MM=CODE...                e.g. 09:30=P,HD,A;11:00=HD,A;15:00=A
              from each start time, only those types may be marked, until the next start; before the first start nothing
              can be marked. No AttWindows row = every type may be marked at any time.

Until AttTypes exists the screens say the feature is not set up (`needs_setup`). Daily rules kept from the EXE: only TODAY
can be saved; every active staff member is listed; a row already marked today is locked; Save deletes the day's rows and
re-inserts the grid in one transaction. Monthly: one grid per month, a mark can only be changed where one exists.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, time

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.captions import captions as make_captions
from app.core.captions import menu_title
from app.services.settings import get_setting

REQUIRED_TABLES = ("MstSTAFF", "UtlAttendance")
GROUP = "Attendance"
TYPES_KEY, WINDOWS_KEY = "AttTypes", "AttWindows"
DAILY_FORM, MONTHLY_FORM = "FRMUTLATTENDANCE", "FRMUTLATTMONTH"
# How an admin writes the two settings in Global Settings (format only, placeholders, no real values).
SETTING_HELP = {
    TYPES_KEY: "CODE=Label:weight|CODE=Label:weight|...   (weight = what one mark counts for in the monthly totals; optional, default 1)",
    WINDOWS_KEY: "HH:MM=CODE,CODE;HH:MM=CODE,...   (from each time, only those codes can be marked; leave the setting out for no time limit)",
}
COLUMNS = {"code": "STAFFCode", "name": "STAFFName", "att_type": "AttType"}  # the real columns the headings come from


def missing_tables(conn: Connection) -> list[str]:
    have = {r[0].lower() for r in conn.execute(text("SELECT name FROM sys.tables WHERE name IN ('MstSTAFF', 'UtlAttendance')"))}
    return [t for t in REQUIRED_TABLES if t.lower() not in have]


def parse_types(value: str) -> list[dict]:
    """`CODE=Label[:weight]|...` -> [{code, label, weight}]; malformed pieces are skipped."""
    out = []
    for part in (value or "").split("|"):
        code, _, rest = part.partition("=")
        code, rest = code.strip(), rest.strip()
        if not code or not rest:
            continue
        label, weight = rest, 1.0
        head, sep, tail = rest.rpartition(":")
        if sep:
            try:
                label, weight = head.strip(), float(tail)
            except ValueError:
                label, weight = rest, 1.0
        out.append({"code": code, "label": label or code, "weight": weight})
    return out


def parse_windows(value: str) -> list[tuple[time, list[str]]]:
    out = []
    for part in (value or "").split(";"):
        start, _, codes = part.partition("=")
        try:
            hh, mm = start.strip().split(":")
            t = time(int(hh), int(mm))
        except ValueError:
            continue
        out.append((t, [c.strip() for c in codes.split(",") if c.strip()]))
    return sorted(out, key=lambda w: w[0])


def config(conn: Connection) -> dict:
    """The attendance set-up read from this database: {types, windows, missing_settings}."""
    t = get_setting(conn, GROUP, TYPES_KEY)
    w = get_setting(conn, GROUP, WINDOWS_KEY)
    types = parse_types(t["value"]) if t else []
    return {"types": types, "windows": parse_windows(w["value"]) if w else [], "missing_settings": [] if types else [TYPES_KEY], "group": GROUP}


def allowed_types(cfg: dict, now: datetime | None = None) -> list[str]:
    """The type codes a row may be given right now."""
    codes = [t["code"] for t in cfg["types"]]
    if not cfg["windows"]:
        return codes
    t = (now or datetime.now()).time()
    current: list[str] | None = None
    for start, allowed in cfg["windows"]:
        if t >= start:
            current = allowed
    return [c for c in (current or []) if c in codes]


def _gate(conn: Connection) -> dict | None:
    miss = missing_tables(conn)
    if miss:
        return {"available": False, "missing": miss}
    cfg = config(conn)
    if cfg["missing_settings"]:
        return {"available": True, "needs_setup": True, "setting_group": GROUP, "missing_settings": cfg["missing_settings"], "setting_help": SETTING_HELP}
    return None


def _heads(conn: Connection, form: str) -> dict:
    return {"title": menu_title(conn, form_key=form), "captions": make_captions(COLUMNS)}


def _staff_with_type(conn: Connection, day: date) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT s.STAFFID, s.STAFFCode, s.STAFFName, ISNULL(a.AttType, '') AS AttType "
            "FROM MstSTAFF s LEFT JOIN UtlAttendance a ON s.STAFFID = a.STAFFID AND a.AttDate = :d "
            "WHERE s.STAFFID > 0 AND s.InActive = 'N' ORDER BY s.STAFFName"
        ),
        {"d": day},
    ).mappings().all()
    return [{"staff_id": int(r["STAFFID"]), "code": (r["STAFFCode"] or "").strip(), "name": (r["STAFFName"] or "").strip(), "att_type": (r["AttType"] or "").strip()} for r in rows]


def day_sheet(conn: Connection, day: date) -> dict:
    """The grid for one date. Past dates are read-only; today's rows that already have a type are locked."""
    gate = _gate(conn)
    if gate:
        return {**gate, **_heads(conn, DAILY_FORM)}
    cfg = config(conn)
    is_today = day == date.today()
    rows = _staff_with_type(conn, day)
    for r in rows:
        r["locked"] = (not is_today) or bool(r["att_type"])
    return {
        "available": True,
        "date": day.isoformat(),
        "is_today": is_today,
        "editable": is_today and any(not r["locked"] for r in rows),
        "allowed_types": allowed_types(cfg) if is_today else [],
        "types": cfg["types"],
        "rows": rows,
        **_heads(conn, DAILY_FORM),
    }


def save_day(conn: Connection, *, rows: list[dict], user_code: str) -> dict:
    """Legacy btnSave: delete today's rows, insert one per staff member shown, all or nothing."""
    miss = missing_tables(conn)
    if miss:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This database has no {', '.join(miss)}")
    cfg = config(conn)
    if cfg["missing_settings"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Attendance is not set up in this database (add the setting {cfg['missing_settings'][0]} in Global Settings)")
    labels = {t["code"]: t["label"] for t in cfg["types"]}
    today = date.today()
    current = {r["staff_id"]: r["att_type"] for r in _staff_with_type(conn, today)}
    allowed = allowed_types(cfg)
    out: list[tuple[int, str]] = []
    for r in rows:
        sid, new = int(r.get("staff_id") or 0), str(r.get("att_type") or "").strip()
        if sid not in current:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Staff {sid} is not an active staff member")
        if current[sid]:
            new = current[sid]  # already marked today: the legacy grid locks the row, so it keeps what it has
        elif new and new not in labels:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"'{new}' is not an attendance type of this database")
        elif new and new not in allowed:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{labels[new]} cannot be marked at this time" + (f" (allowed now: {', '.join(labels[c] for c in allowed)})" if allowed else " (nothing can be marked right now)"),
            )
        out.append((sid, new))
    conn.execute(text("DELETE FROM UtlAttendance WHERE AttDate = :d"), {"d": today})
    now = datetime.now().replace(second=0, microsecond=0)
    for sid, typ in out:
        conn.execute(
            text("INSERT INTO UtlAttendance (AttDate, STAFFID, AttType, UpdatedBy, UpdatedOn) VALUES (:d, :s, :t, :u, :o)"),
            {"d": today, "s": sid, "t": typ, "u": user_code, "o": now},
        )
    audit.record(conn, entity="Attendance", entity_id=today.isoformat(), action="A", user_code=user_code, details=f"{sum(1 for _, t in out if t)} marked of {len(out)}")
    return {"saved": len(out), "marked": sum(1 for _, t in out if t)}


def month_sheet(conn: Connection, year: int, month: int) -> dict:
    gate = _gate(conn)
    if gate:
        return {**gate, **_heads(conn, MONTHLY_FORM)}
    cfg = config(conn)
    weight = {t["code"]: t["weight"] for t in cfg["types"]}
    days = calendar.monthrange(year, month)[1]
    first, last = date(year, month, 1), date(year, month, days)
    staff = {
        int(r["STAFFID"]): {"staff_id": int(r["STAFFID"]), "code": (r["STAFFCode"] or "").strip(), "name": (r["STAFFName"] or "").strip(), "days": {}}
        for r in conn.execute(text("SELECT STAFFID, STAFFCode, STAFFName FROM MstSTAFF WHERE STAFFID > 0 AND InActive = 'N' ORDER BY STAFFName")).mappings()
    }
    for r in conn.execute(
        text("SELECT STAFFID, AttDate, AttType FROM UtlAttendance WHERE AttDate BETWEEN :a AND :b AND ISNULL(AttType, '') <> ''"), {"a": first, "b": last}
    ).mappings():
        if int(r["STAFFID"]) in staff:
            staff[int(r["STAFFID"])]["days"][r["AttDate"].day] = (r["AttType"] or "").strip()
    rows = []
    for s in staff.values():
        marks = list(s["days"].values())
        # one total per configured type: how many marks of it, times its weight (the EXE counted a half day as 0.5)
        rows.append({**s, "totals": {t["code"]: round(marks.count(t["code"]) * weight[t["code"]], 2) for t in cfg["types"]}})
    return {"available": True, "year": year, "month": month, "days": list(range(1, days + 1)), "types": cfg["types"], "rows": rows, **_heads(conn, MONTHLY_FORM)}


def change_cell(conn: Connection, *, staff_id: int, day: date, att_type: str, user_code: str) -> None:
    """Legacy monthly Save: only an existing mark can be changed; stamps ChangedBy / ChangedOn."""
    miss = missing_tables(conn)
    if miss:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This database has no {', '.join(miss)}")
    cfg = config(conn)
    if att_type not in {t["code"] for t in cfg["types"]}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose one of the attendance types of this database")
    n = conn.execute(
        text("UPDATE UtlAttendance SET AttType = :t, ChangedBy = :u, ChangedOn = :o WHERE STAFFID = :s AND AttDate = :d AND ISNULL(AttType, '') <> ''"),
        {"t": att_type, "u": user_code, "o": datetime.now().replace(second=0, microsecond=0), "s": staff_id, "d": day},
    ).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no attendance marked for that staff member on that day")
    audit.record(conn, entity="Attendance Monthly", entity_id=f"{staff_id}@{day.isoformat()}", action="E", user_code=user_code, details=att_type)
