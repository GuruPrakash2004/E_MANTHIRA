from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.security import create_token

from ._routes import UNSAFE_TO_CALL, endpoints

PREFIX = get_settings().api_prefix
PROTECTED = [e for e in endpoints(PREFIX) if e.requires_auth and not e.path.startswith(UNSAFE_TO_CALL)]


@pytest.mark.parametrize("ep", PROTECTED, ids=lambda e: e.id)
def test_rejects_request_without_token(client, ep):
    body = {} if ep.method in ("POST", "PUT") else None
    r = client.request(ep.method, ep.url(PREFIX), json=body)
    assert r.status_code == 401, f"{ep.id} -> {r.status_code}: {r.text[:120]}"


@pytest.mark.parametrize("ep", PROTECTED[::12], ids=lambda e: e.id)
def test_rejects_garbage_token(client, ep):
    r = client.request(ep.method, ep.url(PREFIX), headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


def _me(client, token):
    return client.get(f"{PREFIX}/auth/me", headers={"Authorization": f"Bearer {token}"})


def test_rejects_refresh_token_used_as_access(client, db_ready):
    assert _me(client, create_token(subject="1", extra={"type": "refresh"}, days=1)).status_code == 401


def test_rejects_expired_token(client, db_ready):
    assert _me(client, create_token(subject="1", extra={"type": "access"}, minutes=-5)).status_code == 401


def test_rejects_token_for_unknown_user(client, db_ready):
    assert _me(client, create_token(subject="99999999", extra={"type": "access"})).status_code == 401
