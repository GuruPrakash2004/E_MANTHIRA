"""Welcome video picking: per-day and every-N-hours picks are stable for everyone, random-each-sign-in avoids the last clip (no DB needed)."""
from datetime import datetime

from app.api.v1 import welcome


def _state(mode, hours=3, builtin=False, n=4):
    return {
        "enabled": True, "mode": mode, "hours": hours, "builtin_active": builtin,
        "videos": [{"id": f"v{i}", "name": f"V{i}", "file": f"v{i}.mp4", "size": 1, "active": True} for i in range(n)],
    }


def _all_present(monkeypatch):
    monkeypatch.setattr(welcome, "_path", lambda v: type("P", (), {"is_file": lambda self: True})())


def test_day_pick_is_stable_through_the_day_and_changes_at_midnight(monkeypatch):
    _all_present(monkeypatch)
    st = _state("day")
    a, changes = welcome._pick(st, datetime(2026, 11, 9, 8, 0))
    assert welcome._pick(st, datetime(2026, 11, 9, 23, 59))[0] == a
    assert changes == datetime(2026, 11, 10, 0, 0)
    days = {welcome._pick(st, datetime(2026, 11, d, 12, 0))[0] for d in range(1, 29)}
    assert len(days) > 1  # not the same clip every day


def test_hours_pick_holds_inside_a_block_and_next_change_is_the_block_end(monkeypatch):
    _all_present(monkeypatch)
    st = _state("hours", hours=3)
    a, changes = welcome._pick(st, datetime(2026, 11, 9, 7, 10))  # block 06:00-09:00
    assert welcome._pick(st, datetime(2026, 11, 9, 8, 59))[0] == a
    assert changes == datetime(2026, 11, 9, 9, 0)
    blocks = {welcome._pick(st, datetime(2026, 11, 9, h, 0))[0] for h in range(0, 24, 3)}
    assert len(blocks) > 1


def test_last_block_of_the_day_ends_at_midnight(monkeypatch):
    _all_present(monkeypatch)
    st = _state("hours", hours=5)  # blocks 0-5, 5-10, 10-15, 15-20, 20-24(25 would pass midnight)
    _, changes = welcome._pick(st, datetime(2026, 11, 9, 21, 0))
    assert changes == datetime(2026, 11, 10, 0, 0)


def test_login_pick_avoids_the_clip_just_seen(monkeypatch):
    _all_present(monkeypatch)
    st = _state("login", n=3)
    for _ in range(40):
        assert welcome._pick(st, datetime(2026, 11, 9, 9, 0), exclude="v1")[0] != "v1"


def test_single_clip_always_plays_even_if_it_was_just_seen(monkeypatch):
    _all_present(monkeypatch)
    st = _state("login", n=1)
    assert welcome._pick(st, datetime(2026, 11, 9, 9, 0), exclude="v0")[0] == "v0"


def test_empty_pool_means_the_builtin_clips_and_builtin_can_be_in_the_pool(monkeypatch):
    _all_present(monkeypatch)
    st = _state("day", n=0)
    assert welcome._pick(st, datetime(2026, 11, 9, 9, 0))[0] is None
    st = _state("day", n=0, builtin=True)
    assert welcome._pick(st, datetime(2026, 11, 9, 9, 0))[0] == welcome.BUILTIN


def test_unticked_clips_are_never_picked(monkeypatch):
    _all_present(monkeypatch)
    st = _state("login", n=3)
    st["videos"][0]["active"] = False
    st["videos"][2]["active"] = False
    for _ in range(20):
        assert welcome._pick(st, datetime(2026, 11, 9, 9, 0))[0] == "v1"
