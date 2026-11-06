"""Every menu row this database SHOWS must open something in the web app (a screen, or the honest "not available" page).
Mirrors `routeFor` in frontend/src/components/AppShellLayout.jsx (caption map, master by DocID, legacy form name)."""
import re
from pathlib import Path

from app.core.db import get_engine
from app.meta.menu import get_menu_tree

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _caption_routes() -> dict[str, str]:
    jsx = (FRONTEND / "components" / "AppShellLayout.jsx").read_text(encoding="utf-8")
    block = jsx[jsx.index("const CAPTION_ROUTE = {"): jsx.index("function routeFor")]
    return dict(re.findall(r"'([^']+)':\s*'([^']+)'", block))


def _form_routes() -> dict[str, str]:
    js = (FRONTEND / "features" / "legacy" / "registry.js").read_text(encoding="utf-8")
    block = js[js.index("export const FORM_ROUTE = {"): js.index("}\n", js.index("export const FORM_ROUTE = {"))]
    return {k.strip().strip("'").lower(): v for k, v in re.findall(r"('?[\w ]+'?):\s*'([^']+)'", block)}


def test_every_shown_menu_row_has_a_route():
    captions, forms = _caption_routes(), _form_routes()
    with get_engine().connect() as conn:
        menu = get_menu_tree(conn)
    orphans = []
    for m in menu:
        if captions.get(m["caption"]):
            continue
        if m["type"] == "Masters" and m["doc_id"]:
            continue
        if forms.get(m["form_key"].strip().lower()):
            continue
        orphans.append((m["type"], m["caption"], m["form_key"]))
    assert not orphans, f"menu rows shown in this database with no web route (add them to CAPTION_ROUTE or features/legacy/registry.js): {orphans}"


def test_stock_report_rows_resolve_by_form_name_not_caption():
    forms = _form_routes()
    assert forms["stock balance report"] == "/inventory/stock-balance-report"
    assert forms["stock ledger report"] == "/inventory/stock-ledger-report"
