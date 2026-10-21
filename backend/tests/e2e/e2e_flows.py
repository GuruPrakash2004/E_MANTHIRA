"""Read-only browser flows against ALREADY-RUNNING dev servers (frontend :5173,
backend :8010). Not collected by pytest (no test_ prefix); run it directly:

    cd backend
    .\\.venv\\Scripts\\python.exe tests\\e2e\\e2e_flows.py <screenshot-dir>

It never clicks Save / Delete / Cancel. It signs in by minting an ADMIN token
(so no password is needed) and visits screens; the login screen itself is
tested separately with a wrong password.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, ".")
from playwright.sync_api import sync_playwright  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.db import get_engine  # noqa: E402
from app.core.fy import get_active_fy  # noqa: E402
from app.core.security import create_token  # noqa: E402

BASE = "http://localhost:5173"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "e2e-shots")
OUT.mkdir(parents=True, exist_ok=True)

with get_engine().connect() as c:
    uid = c.execute(text("SELECT UserID FROM MstUser WHERE UserCode='ADMIN'")).scalar()
    fy = get_active_fy(c)
ACCESS = create_token(subject=str(uid), extra={"type": "access", "fy": fy.id})
REFRESH = create_token(subject=str(uid), extra={"type": "refresh"}, days=1)

SCREENS = [
    ("dashboard", "/"), ("seva-entry", "/sevas"), ("donation", "/donations"),
    ("hall-booking", "/halls"), ("hall-booking-entry", "/halls/entry"), ("hall-status", "/halls/status"),
    ("master-sannidhi", "/masters/1255"), ("master-seva", "/masters/1265"), ("master-gothra", "/masters/1257"),
    ("master-ledger", "/masters/1204"), ("company", "/masters/17"),
    ("expenses", "/expenses"), ("payment-voucher", "/vouchers/payment"), ("receipt-voucher", "/vouchers/receipt"),
    ("journal-voucher", "/vouchers/journal"), ("reports", "/reports"), ("panchanga", "/panchanga"),
    ("inventory-stock-bal", "/inventory/stock-balance"), ("authorise", "/utilities/authorise"),
    ("audit-log", "/audit-log"), ("admin-master", "/settings/admin-master"), ("import-excel", "/settings/import-excel"),
    ("daily-sales", "/reports/daily-sales"), ("not-found", "/no-such-page"),
]
ERROR_TEXT = ("something went wrong", "unexpected application error", "cannot read properties")
results = []


def record(name, ok, detail=""):
    results.append({"flow": name, "ok": ok, "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail else ""), flush=True)


def new_bag(page):
    bag = {"console": [], "pageerror": [], "http": []}
    page.on("console", lambda m: bag["console"].append(m.text[:200]) if m.type == "error" else None)
    page.on("pageerror", lambda e: bag["pageerror"].append(str(e)[:200]))
    page.on("response", lambda r: bag["http"].append(
        f"{r.status} {r.request.method} {r.url.replace('http://localhost:8010/api/v1', '')[:90]}")
        if r.status >= 400 and "/api/v1" in r.url else None)
    return bag


def settle(page):
    page.keyboard.press("Escape")  # dismiss the welcome splash if it appears
    page.wait_for_load_state("networkidle", timeout=20000)
    page.wait_for_timeout(600)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---------- A. public: login screen (no token) ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    bag = new_bag(page)
    page.goto(BASE + "/login")
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(OUT / "login.png"))
    record("login: page renders", page.locator("input").count() >= 2, f"{page.locator('input').count()} inputs")
    page.locator("input").nth(0).fill("ADMIN")
    page.locator("input[type=password]").first.fill("wrong-password-xyz")
    page.get_by_role("button", name="Sign in").or_(page.locator("button[type=submit]")).first.click()
    try:  # the login call can take a few seconds on a slow DB; wait for the message, not a fixed delay
        page.wait_for_function(
            "() => /incorrect|invalid|wrong/i.test(document.body.innerText)", timeout=15000)
    except Exception:  # noqa: BLE001
        pass
    txt = page.inner_text("body").lower()
    record("login: wrong password shows an error and stays on /login",
           "/login" in page.url and ("incorrect" in txt or "invalid" in txt or "wrong" in txt), page.url)
    page.screenshot(path=str(OUT / "login-wrong.png"))
    record("login: no JS exceptions", not bag["pageerror"], "; ".join(bag["pageerror"]))
    ctx.close()

    # ---------- B. authenticated: every main screen ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(
        f"localStorage.setItem('vtemple_access_token','{ACCESS}');"
        f"localStorage.setItem('vtemple_refresh_token','{REFRESH}');"
        f"localStorage.setItem('vtemple_fy_id','{fy.id}');"
    )
    for name, path in SCREENS:
        page = ctx.new_page()  # fresh page per screen => clean console/network capture
        bag = new_bag(page)
        try:
            page.goto(BASE + path, wait_until="domcontentloaded")
            settle(page)
        except Exception as exc:  # noqa: BLE001
            record(f"screen {name}", False, f"navigation: {str(exc)[:120]}")
            page.close()
            continue
        body = page.inner_text("body")
        problems = []
        if "/login" in page.url and name != "not-found":
            problems.append("redirected to /login (session rejected)")
        if len(body.strip()) < 40:
            problems.append("page is blank")
        if any(t in body.lower() for t in ERROR_TEXT):
            problems.append("error boundary text on page")
        if bag["pageerror"]:
            problems.append("JS exception: " + bag["pageerror"][0])
        bad_http = [h for h in bag["http"] if not (h.startswith("404") and name == "not-found")]
        if bad_http:
            problems.append("HTTP errors: " + " | ".join(bad_http[:3]))
        if bag["console"]:
            problems.append("console errors: " + bag["console"][0][:140])
        page.screenshot(path=str(OUT / f"{name}.png"))
        record(f"screen {name} ({path})", not problems, "; ".join(problems))
        page.close()

    # ---------- C. interactions ----------
    page = ctx.new_page()
    page.goto(BASE + "/")
    settle(page)
    nav_links = page.locator("[aria-label='Main navigation'] a, nav a").count()
    record("shell: sidebar has navigation links", nav_links > 5, f"{nav_links} links")

    theme_btn = page.locator("[aria-label*='theme' i], [aria-label*='dark' i], [aria-label*='light' i]").first
    if theme_btn.count():
        before = page.evaluate("document.documentElement.getAttribute('data-mantine-color-scheme')")
        theme_btn.click()
        page.wait_for_timeout(400)
        after = page.evaluate("document.documentElement.getAttribute('data-mantine-color-scheme')")
        record("shell: theme toggle switches light/dark", before != after, f"{before} -> {after}")
        page.screenshot(path=str(OUT / "dashboard-theme-toggled.png"))
    else:
        record("shell: theme toggle switches light/dark", False, "toggle button not found")

    page.goto(BASE + "/sevas")
    settle(page)
    inputs = page.locator("input:visible, textarea:visible, [role=combobox]:visible").count()
    record("seva entry: form fields render from UtlDocDsgrFlds", inputs >= 5, f"{inputs} visible fields")

    page.goto(BASE + "/masters/1255")
    settle(page)
    m = re.search(r"(\d+) records", page.inner_text("body"))
    record("masters: Sannidhi list shows records", bool(m) and int(m.group(1)) >= 1,
           m.group(0) if m else "no 'N records' text")

    page.goto(BASE + "/reports")
    settle(page)
    record("reports: catalogue lists reports", page.locator("a, button, [role=tab]").count() > 10)
    ctx.close()

    # ---------- D. Database Settings panel (login page, no token) ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.goto(BASE + "/login")
    page.wait_for_load_state("networkidle")
    opener = page.get_by_text("Database Settings").or_(page.get_by_role("button", name="Database")).first
    if opener.count():
        opener.click()
        page.wait_for_timeout(800)
        step1 = "Step 1 of 2" in page.inner_text("body")
        record("db settings: opens on Step 1 of 2", step1)
        page.screenshot(path=str(OUT / "dbsettings-step1.png"))
        if step1:
            fields = page.locator("[role=dialog] input")
            fields.nth(0).fill("127.0.0.1")  # unreachable on purpose; never Save
            fields.nth(2).fill("sa")
            fields.nth(3).fill("not-a-real-password")
            page.get_by_role("button", name="Connect & Next").click()
            page.wait_for_timeout(8000)
            body = page.inner_text("body")
            record("db settings: unreachable server shows an error and stays on Step 1",
                   "Step 1 of 2" in body and "Step 2 of 2" not in body)
            page.screenshot(path=str(OUT / "dbsettings-error.png"))
    else:
        record("db settings: opens on Step 1 of 2", False, "could not find the Database Settings opener on /login")
    ctx.close()
    browser.close()

(OUT / "results.json").write_text(json.dumps(results, indent=1))
fails = [r for r in results if not r["ok"]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
