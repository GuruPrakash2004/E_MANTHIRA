"""Attendance + Attendance Monthly. Nothing about the rules is built into the code: types, labels, weights and time windows are
`UtlGSettings` rows. Real DB; the staff / attendance tables and the settings rows a test needs are created INSIDE a
transaction that is always rolled back, so nothing is left behind."""
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import get_engine
from app.services import attendance as att

TYPES = "P=Present:1|HD=Half Day:0.5|A=Absent:1"
WINDOWS = "09:30=P,HD,A;11:00=HD,A;15:00=A"


def _set(c, name, value):
    c.execute(text("DELETE FROM UtlGSettings WHERE SetGroup = 'Attendance' AND SetName = :n"), {"n": name})
    if value is not None:
        c.execute(text("INSERT INTO UtlGSettings (SetGroup, SetName, SetValue, SetCaption, Remarks, HideSetting) VALUES ('Attendance', :n, :v, :n, '', 'N')"), {"n": name, "v": value})


@pytest.fixture()
def conn():
    c = get_engine().connect()
    tx = c.begin()
    try:
        if not c.execute(text("SELECT 1 FROM sys.tables WHERE name = 'MstSTAFF'")).scalar():
            c.execute(text("CREATE TABLE MstSTAFF (STAFFID int NOT NULL, STAFFCode varchar(20), STAFFName varchar(50), InActive char(1) NOT NULL DEFAULT 'N')"))
        if not c.execute(text("SELECT 1 FROM sys.tables WHERE name = 'UtlAttendance'")).scalar():
            c.execute(text("CREATE TABLE UtlAttendance (AttDate smalldatetime, STAFFID int, AttType varchar(2), UpdatedBy varchar(50), UpdatedOn smalldatetime, ChangedBy varchar(50), ChangedOn smalldatetime)"))
        c.execute(text("DELETE FROM UtlAttendance WHERE STAFFID IN (9001, 9002, 9003)"))
        c.execute(text("DELETE FROM MstSTAFF WHERE STAFFID IN (9001, 9002, 9003)"))
        c.execute(text("INSERT INTO MstSTAFF (STAFFID, STAFFCode, STAFFName, InActive) VALUES (9001, 'T1', 'Test Alpha', 'N'), (9002, 'T2', 'Test Beta', 'N'), (9003, 'T3', 'Test Gone', 'Y')"))
        _set(c, "AttTypes", TYPES)
        _set(c, "AttWindows", WINDOWS)
        yield c
    finally:
        tx.rollback()
        c.close()


def _ours(sheet):
    return [r for r in sheet["rows"] if r["staff_id"] in (9001, 9002, 9003)]


def _open_all(monkeypatch):
    monkeypatch.setattr(att, "allowed_types", lambda cfg, now=None: [t["code"] for t in cfg["types"]])


def test_types_and_windows_are_parsed_from_the_settings_text():
    t = att.parse_types("P=Present:1|HD=Half Day:0.5|A=Absent|bad|X=")
    assert t == [{"code": "P", "label": "Present", "weight": 1.0}, {"code": "HD", "label": "Half Day", "weight": 0.5}, {"code": "A", "label": "Absent", "weight": 1.0}]
    assert att.parse_types("L=Late: on time") == [{"code": "L", "label": "Late: on time", "weight": 1.0}]  # a colon that is not a weight stays in the label
    w = att.parse_windows("11:00=HD,A;09:30=P,HD,A;bad;15:00=A")
    assert [(x[0].hour, x[0].minute, x[1]) for x in w] == [(9, 30, ["P", "HD", "A"]), (11, 0, ["HD", "A"]), (15, 0, ["A"])]


def test_time_windows_come_from_the_setting(conn):
    cfg = att.config(conn)
    at = lambda h, m: att.allowed_types(cfg, datetime(2026, 1, 1, h, m))
    assert at(9, 0) == [] and at(9, 30) == ["P", "HD", "A"] and at(10, 59) == ["P", "HD", "A"]
    assert at(11, 0) == ["HD", "A"] and at(14, 59) == ["HD", "A"] and at(15, 0) == ["A"] and at(18, 0) == ["A"]
    _set(conn, "AttWindows", "08:00=P;12:00=A")  # a different temple, different windows: no code change
    cfg2 = att.config(conn)
    assert att.allowed_types(cfg2, datetime(2026, 1, 1, 8, 30)) == ["P"] and att.allowed_types(cfg2, datetime(2026, 1, 1, 13, 0)) == ["A"]
    _set(conn, "AttWindows", None)  # no window row = no time restriction
    assert att.allowed_types(att.config(conn), datetime(2026, 1, 1, 3, 0)) == ["P", "HD", "A"]


def test_not_set_up_until_the_types_setting_exists(conn):
    _set(conn, "AttTypes", None)
    s = att.day_sheet(conn, date.today())
    assert s["available"] and s["needs_setup"] and s["missing_settings"] == ["AttTypes"] and s["setting_group"] == "Attendance"
    assert att.month_sheet(conn, 2025, 3)["needs_setup"]
    with pytest.raises(HTTPException) as e:
        att.save_day(conn, rows=[], user_code="T")
    assert e.value.status_code == 409 and "AttTypes" in e.value.detail


def test_day_sheet_lists_active_staff_and_serves_captions_from_columns(conn):
    s = att.day_sheet(conn, date.today())
    assert s["available"] and s["is_today"] and [t["code"] for t in s["types"]] == ["P", "HD", "A"]
    assert {r["staff_id"] for r in _ours(s)} == {9001, 9002}
    assert all(not r["locked"] and r["att_type"] == "" for r in _ours(s))
    assert s["captions"]["code"] == "Staff Code" and s["captions"]["name"] == "Staff Name"  # real column names, tidied


def test_save_day_writes_rows_and_locks_marked(conn, monkeypatch):
    _open_all(monkeypatch)
    r = att.save_day(conn, rows=[{"staff_id": 9001, "att_type": "P"}, {"staff_id": 9002, "att_type": ""}], user_code="T")
    assert r["saved"] >= 2
    stored = dict(conn.execute(text("SELECT STAFFID, AttType FROM UtlAttendance WHERE AttDate = :d AND STAFFID IN (9001, 9002)"), {"d": date.today()}).all())
    assert stored == {9001: "P", 9002: ""}
    att.save_day(conn, rows=[{"staff_id": 9001, "att_type": "A"}, {"staff_id": 9002, "att_type": "HD"}], user_code="T")
    stored = dict(conn.execute(text("SELECT STAFFID, AttType FROM UtlAttendance WHERE AttDate = :d AND STAFFID IN (9001, 9002)"), {"d": date.today()}).all())
    assert stored == {9001: "P", 9002: "HD"}
    assert all(r["locked"] for r in _ours(att.day_sheet(conn, date.today())))


def test_type_not_allowed_now_or_unknown(conn, monkeypatch):
    monkeypatch.setattr(att, "allowed_types", lambda cfg, now=None: ["A"])
    with pytest.raises(HTTPException) as e:
        att.save_day(conn, rows=[{"staff_id": 9001, "att_type": "P"}], user_code="T")
    assert e.value.status_code == 422 and "allowed now: Absent" in e.value.detail
    with pytest.raises(HTTPException) as e:
        att.save_day(conn, rows=[{"staff_id": 9001, "att_type": "ZZ"}], user_code="T")
    assert "not an attendance type" in e.value.detail


def test_unknown_staff_rejected(conn, monkeypatch):
    _open_all(monkeypatch)
    with pytest.raises(HTTPException) as e:
        att.save_day(conn, rows=[{"staff_id": 9003, "att_type": "P"}], user_code="T")  # inactive
    assert e.value.status_code == 422


def test_past_day_is_read_only(conn):
    s = att.day_sheet(conn, date(2020, 1, 1))
    assert not s["editable"] and all(r["locked"] for r in _ours(s))


def test_month_totals_use_the_configured_weights(conn):
    for d, t in ((date(2025, 3, 3), "P"), (date(2025, 3, 4), "P"), (date(2025, 3, 5), "HD"), (date(2025, 3, 6), "A")):
        conn.execute(text("INSERT INTO UtlAttendance (AttDate, STAFFID, AttType, UpdatedBy) VALUES (:d, 9001, :t, 'T')"), {"d": d, "t": t})
    conn.execute(text("INSERT INTO UtlAttendance (AttDate, STAFFID, AttType, UpdatedBy) VALUES ('2024-03-03', 9001, 'A', 'T')"))  # same month, other year
    row = next(r for r in att.month_sheet(conn, 2025, 3)["rows"] if r["staff_id"] == 9001)
    assert row["totals"] == {"P": 2.0, "HD": 0.5, "A": 1.0} and row["days"][5] == "HD"
    _set(conn, "AttTypes", "P=Present:1|HD=Half Day:0.25|A=Absent:2")  # another temple weighs differently: just data
    row = next(r for r in att.month_sheet(conn, 2025, 3)["rows"] if r["staff_id"] == 9001)
    assert row["totals"] == {"P": 2.0, "HD": 0.25, "A": 2.0}
    att.change_cell(conn, staff_id=9001, day=date(2025, 3, 6), att_type="P", user_code="T")
    assert next(r for r in att.month_sheet(conn, 2025, 3)["rows"] if r["staff_id"] == 9001)["totals"]["P"] == 3.0
    assert conn.execute(text("SELECT ChangedBy FROM UtlAttendance WHERE STAFFID = 9001 AND AttDate = '2025-03-06'")).scalar() == "T"
    with pytest.raises(HTTPException) as e:
        att.change_cell(conn, staff_id=9001, day=date(2025, 3, 20), att_type="P", user_code="T")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        att.change_cell(conn, staff_id=9001, day=date(2025, 3, 6), att_type="X", user_code="T")


def test_database_without_the_tables_says_so(monkeypatch):
    c = get_engine().connect()
    try:
        monkeypatch.setattr(att, "missing_tables", lambda _c: ["MstSTAFF"])
        assert att.day_sheet(c, date.today())["missing"] == ["MstSTAFF"] and not att.day_sheet(c, date.today())["available"]
        assert not att.month_sheet(c, 2025, 3)["available"]
        with pytest.raises(HTTPException) as e:
            att.save_day(c, rows=[], user_code="T")
        assert e.value.status_code == 409
    finally:
        c.close()
