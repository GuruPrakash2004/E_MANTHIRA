"""Every authenticated GET, called as ADMIN against the real DB. Read-only.
Pass = no server error (4xx for "record 1 does not exist" or missing query
params is fine; a 5xx means a crash or a bad SQL statement)."""
from __future__ import annotations

import pytest

from app.core.config import get_settings

from ._routes import HEAVY_GETS, UNSAFE_TO_CALL, endpoints

PREFIX = get_settings().api_prefix
READS = [
    e for e in endpoints(PREFIX)
    if e.method == "GET" and e.requires_auth
    and not e.path.startswith(UNSAFE_TO_CALL)
    and not e.path.endswith(HEAVY_GETS)
]


@pytest.mark.parametrize("ep", READS, ids=lambda e: e.id)
def test_get_does_not_500(client, admin_headers, ep):
    r = client.get(ep.url(PREFIX), headers=admin_headers)
    assert r.status_code < 500, f"{ep.id} -> {r.status_code}: {r.text[:300]}"


def test_me_returns_admin(client, admin_headers):
    r = client.get(f"{PREFIX}/auth/me", headers=admin_headers)
    assert r.status_code == 200
    assert "ADMIN" in r.text.upper()


def test_menu_is_served_from_mstmenu(client, admin_headers):
    r = client.get(f"{PREFIX}/meta/menu", headers=admin_headers)
    assert r.status_code == 200 and r.json()


def test_doc_fields_come_from_utldocdsgrflds(client, admin_headers):
    r = client.get(f"{PREFIX}/meta/docs/1263/fields", headers=admin_headers)  # Seva Entry
    assert r.status_code == 200
    assert len(r.json()) > 0
