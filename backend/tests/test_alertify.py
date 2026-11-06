"""Alertify: settings rules and alert creation against the real Alertify database. Every inserted row is removed again."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.services import alertify as svc

TAG = "ZZ-TEMPLE-TEST "


def _reachable():
    try:
        svc.get_engine().connect().close()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _reachable(), reason="Alertify server not reachable")


@pytest.fixture
def cleanup():
    yield
    with svc.get_engine().begin() as c:
        c.execute(text("DELETE FROM MstAlert WHERE Title LIKE :t"), {"t": TAG + "%"})


def _rows(title):
    with svc.get_engine().connect() as c:
        return c.execute(text("SELECT * FROM MstAlert WHERE Title = :t ORDER BY DueOn"), {"t": title}).mappings().all()


def _future(days=5):
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")


def test_alert_is_written_like_alertifys_own(cleanup):
    t = TAG + "one"
    r = svc.create_alerts(t, "Doc 26SLV1 Rs 500", [{"due_date": _future(), "time": "06:30"}], remind_days=2)
    assert len(r["created"]) == 1 and not r["skipped"]
    row = _rows(t)[0]
    assert (row["AlarmSet"], row["IsAlarmReq"], row["PlaySound"], row["REMDAYS"], row["WebCreatedBy"]) == ("Y", "Y", "Y", 2, "ADMIN")
    assert row["NoteMsg"] == row["RMKS"] == "Doc 26SLV1 Rs 500"
    assert row["DueOn"] == row["AlarmDateTime"] and (row["DueOn"].hour, row["DueOn"].minute) == (6, 30)


def test_one_alert_per_date_and_no_duplicates(cleanup):
    t = TAG + "multi"
    items = [{"due_date": _future(3), "time": "07:00"}, {"due_date": _future(4), "time": "07:00"}, {"due_date": _future(4), "time": "07:00"}]
    assert len(svc.create_alerts(t, "x", items)["created"]) == 2
    again = svc.create_alerts(t, "x", items)  # double click / retry
    assert not again["created"] and {s["reason"] for s in again["skipped"]} == {"already exists"}
    assert len(_rows(t)) == 2


def test_past_dates_are_allowed(cleanup):
    t = TAG + "past"
    r = svc.create_alerts(t, "x", [{"due_date": "2020-01-01", "time": "06:00"}])
    assert len(r["created"]) == 1 and len(_rows(t)) == 1


def test_unicode_and_long_text_are_kept_or_clipped(cleanup):
    t = TAG + "தமிழ் " + "ಕನ್ನಡ"
    svc.create_alerts(t, "ಸೇವೆ " * 2000, [{"due_date": _future(), "time": "08:00"}])
    row = _rows(t)[0]
    assert row["Title"] == t and len(row["NoteMsg"]) == svc.TEXT_MAX
    long_t = TAG + "L" * 400
    svc.create_alerts(long_t, "", [{"due_date": _future(), "time": "08:00"}])
    with svc.get_engine().connect() as c:
        assert c.execute(text("SELECT LEN(Title) FROM MstAlert WHERE Title LIKE :t"), {"t": long_t[:100] + "%"}).scalar() == svc.TITLE_MAX


@pytest.mark.parametrize("title,items", [("", [{"due_date": "2030-01-01"}]), ("   ", [{"due_date": "2030-01-01"}]), ("t", []), ("t", [{"due_date": "31/12/2030"}]), ("t", [{"time": "06:00"}])])
def test_bad_input_is_refused_before_any_write(title, items):
    with pytest.raises(ValueError):
        svc.create_alerts(title, "d", items)


def test_quotes_and_sql_characters_are_just_text(cleanup):
    t = TAG + "O'Brien'; DROP TABLE MstAlert;--"
    svc.create_alerts(t, "it's \"fine\" <<x>>", [{"due_date": _future(), "time": "09:00"}])
    assert _rows(t)[0]["NoteMsg"] == "it's \"fine\" <<x>>"


def test_settings_validation_and_password_never_returned():
    pub = svc.public()
    assert "password" not in pub and "password_set" in pub
    ok, msg = svc.test({"host": ""})
    assert not ok
