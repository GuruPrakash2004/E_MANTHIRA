"""Mutating endpoints with a required JSON body are sent `{}`. FastAPI must
reject it with 422 BEFORE the handler runs, so nothing is written. Anything
other than 422 means the endpoint accepted an empty payload (or crashed)."""
from __future__ import annotations

import pytest

from app.core.config import get_settings

from ._routes import UNSAFE_TO_CALL, endpoints

PREFIX = get_settings().api_prefix
WRITES = [
    e for e in endpoints(PREFIX)
    if e.method in ("POST", "PUT") and e.requires_auth and e.body_required
    and not e.path.startswith(UNSAFE_TO_CALL)
]


def test_there_are_write_endpoints_to_check():
    assert len(WRITES) > 20


@pytest.mark.parametrize("ep", WRITES, ids=lambda e: e.id)
def test_empty_body_is_rejected(client, admin_headers, ep):
    """422 from body validation, or a 4xx from a dependency/guard that runs
    first (e.g. 404 'this master has no sub-screens'). Never 2xx, never 5xx."""
    r = client.request(ep.method, ep.url(PREFIX), json={}, headers=admin_headers)
    assert 400 <= r.status_code < 500, f"{ep.id} -> {r.status_code}: {r.text[:200]}"


def test_untyped_dict_bodies_are_never_called(all_endpoints):
    """Writes with a free-form dict body accept `{}` and run, so no test may
    call them with a payload. Listed here so the gap is visible, not hidden."""
    from ._routes import endpoints as _eps  # noqa: F401
    untyped = [e.id for e in all_endpoints
               if e.method in ("POST", "PUT") and e.requires_auth and not e.body_required]
    assert untyped, "expected some endpoints with free-form/no body"
