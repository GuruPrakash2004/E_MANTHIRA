"""Rights are enforced by the server on printing, mail/SMS/labels, Panchanga, Shared Documents and the trade/stock reports."""
import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.core import security
from app.core.security import CurrentUser
from app.main import app
from app.meta import menu as meta_menu


def _names(dep, out):
    for d in dep.dependencies:
        out.append(getattr(d.call, "__qualname__", ""))
        _names(d, out)
    return out


def _routes(prefix):
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith(prefix)]


def _guarded(route):
    return any("require_right" in n for n in _names(route.dependant, []))


@pytest.mark.parametrize("prefix", ["/api/v1/print/bulk/{doc_id}", "/api/v1/print/{doc_id}/"])
def test_print_routes_with_a_doc_in_the_path_need_a_right(prefix):
    rows = [r for r in _routes("/api/v1/print/") if r.path.startswith(prefix)]
    assert rows
    assert all(_guarded(r) for r in rows), [r.path for r in rows if not _guarded(r)]


def test_mail_sms_label_routes_need_a_right():
    for r in _routes("/api/v1/doc-actions/"):
        if any(k in r.path for k in ("email", "sms", "labels", "label-templates")) and "{doc_id}" in r.path:
            assert _guarded(r), r.path


def test_panchanga_writes_and_shared_document_writes_need_a_right():
    for r in _routes("/api/v1/panchanga"):
        if r.methods & {"PUT", "DELETE", "POST"}:
            assert _guarded(r), (r.methods, r.path)
    for r in _routes("/api/v1/utilities/shared-docs"):
        assert _guarded(r), (r.methods, r.path)


def test_stock_reports_need_a_right():
    for path in ("/api/v1/trade-reports/stock-level", "/api/v1/trade-reports/stock-ageing", "/api/v1/inventory/stock-balance-report", "/api/v1/inventory/stock-ledger-report"):
        assert any(_guarded(r) for r in _routes(path) if r.path == path), path


def test_check_right_denies_a_user_without_the_print_right(monkeypatch):
    monkeypatch.setattr(meta_menu, "resolve_menu_item_id", lambda conn, doc_id: 77)
    # Add, Edit, Delete, View yes; Print (position 4) no
    monkeypatch.setattr(meta_menu, "get_rights_string", lambda conn, **kw: "111010000000")
    user = CurrentUser(user_id=9, user_code="CLERK", role_id=3, fin_year_id=None)
    assert security.check_right(None, user, 1263, meta_menu.RIGHT_VIEW) is user
    with pytest.raises(HTTPException) as e:
        security.check_right(None, user, 1263, meta_menu.RIGHT_PRINT)
    assert e.value.status_code == 403
