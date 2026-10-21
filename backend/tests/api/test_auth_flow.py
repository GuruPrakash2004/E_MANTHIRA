from __future__ import annotations

from app.core.config import get_settings

P = get_settings().api_prefix


def test_health_is_public(client):
    assert client.get("/health").status_code == 200  # mounted at the root, not under /api/v1


def test_login_unknown_user(client, db_ready):
    r = client.post(f"{P}/auth/login", json={"username": "no_such_user_xyz", "password": "x"})
    assert r.status_code == 401


def test_login_wrong_password_for_admin(client, db_ready):
    r = client.post(f"{P}/auth/login", json={"username": "ADMIN", "password": "definitely-wrong-₹"})
    assert r.status_code == 401


def test_login_missing_fields_is_422(client):
    assert client.post(f"{P}/auth/login", json={}).status_code == 422


def test_refresh_with_garbage_token_is_401(client, db_ready):
    assert client.post(f"{P}/auth/refresh", params={"refresh_token": "nope"}).status_code == 401


def test_refresh_rejects_an_access_token(client, admin_headers):
    tok = admin_headers["Authorization"].split()[1]
    assert client.post(f"{P}/auth/refresh", params={"refresh_token": tok}).status_code == 401


def test_financial_years_public_list(client, db_ready):
    r = client.get(f"{P}/auth/financial-years")
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_db_settings_never_echoes_password(client):
    r = client.get(f"{P}/db-settings")
    assert r.status_code == 200
    assert not r.json().get("db_password"), "password must be write-only"


def test_today_sevas_display_is_public(client, db_ready):
    assert client.get(f"{P}/display/today-sevas").status_code < 500
