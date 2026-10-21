from __future__ import annotations

from ._routes import EXPECTED_PUBLIC


def test_app_has_routes(all_endpoints):
    assert len(all_endpoints) > 200


def test_openapi_schema_builds():
    from app.main import app
    assert app.openapi()["paths"], "OpenAPI schema is empty"


def test_only_expected_routes_are_public(all_endpoints):
    """Security guard: a new endpoint without get_current_user shows up here."""
    public = {(e.method, e.path) for e in all_endpoints if not e.requires_auth}
    assert public - EXPECTED_PUBLIC == set(), "unexpected unauthenticated endpoints"
    assert EXPECTED_PUBLIC - public == set(), "allowlist is stale (route now needs auth or was removed)"
