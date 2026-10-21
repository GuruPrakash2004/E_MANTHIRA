from __future__ import annotations

import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.gzip_mw import SelectiveGZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.v1 import doc_actions, mail_settings, master_extras, audit, auth, bulk_update, company, db_settings, display, donations, expense, hall_booking_entry, halls, inventory, masters, meta, panchanga, print as print_router, print_options, reports, roles, settings as settings_router, sevas, exports, trading_reports, users, utilities, vouchers, welcome
from app.core.config import get_settings
from app.core.db import get_engine, healthcheck, with_transaction
from app.core.audit import ensure_schema
from app.print import rpt_bridge_manager
from app.print.print_prefs import ensure_schema as ensure_print_prefs_schema


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Boot-time checks: DB reachable, WebAuditLog/WebPrintPref tables present
    # (idempotent). Non-fatal: the server must still boot and serve
    # /db-settings (and login) even when the configured DB is unreachable —
    # that's exactly the case the Database Settings panel exists to fix,
    # without needing a restart once reconnected (see runtime_db_settings.py).
    try:
        healthcheck()
        with with_transaction() as conn:
            ensure_schema(conn)
            ensure_print_prefs_schema(conn)
    except Exception as exc:  # noqa: BLE001
        print(f"[startup] DB not reachable yet ({exc}) — server is still up; fix via Database Settings.")
    rpt_bridge_manager.start()  # real Crystal bridge, when RptBridge.exe exists (Windows); otherwise the configured bridge URL
    try:
        yield
    finally:
        rpt_bridge_manager.stop()
    get_engine().dispose()


settings = get_settings()
app = FastAPI(title="vTemple Web API", version="0.1.0", lifespan=lifespan)

app.add_middleware(SelectiveGZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",  # any origin; the regex form echoes the caller's origin, which works with credentials
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(db_settings.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(meta.router, prefix=settings.api_prefix)
app.include_router(masters.router, prefix=settings.api_prefix)
app.include_router(master_extras.router, prefix=settings.api_prefix)
app.include_router(mail_settings.router, prefix=settings.api_prefix)
app.include_router(doc_actions.router, prefix=settings.api_prefix)
app.include_router(sevas.router, prefix=settings.api_prefix)
app.include_router(halls.router, prefix=settings.api_prefix)
app.include_router(hall_booking_entry.router, prefix=settings.api_prefix)
app.include_router(donations.router, prefix=settings.api_prefix)
app.include_router(vouchers.router, prefix=settings.api_prefix)
app.include_router(expense.router, prefix=settings.api_prefix)
app.include_router(trading_reports.router, prefix=settings.api_prefix)
app.include_router(print_router.router, prefix=settings.api_prefix)
app.include_router(print_options.router, prefix=settings.api_prefix)
app.include_router(roles.router, prefix=settings.api_prefix)
app.include_router(users.router, prefix=settings.api_prefix)
app.include_router(reports.router, prefix=settings.api_prefix)
app.include_router(settings_router.router, prefix=settings.api_prefix)
app.include_router(company.router, prefix=settings.api_prefix)
app.include_router(panchanga.router, prefix=settings.api_prefix)
app.include_router(display.router, prefix=settings.api_prefix)
app.include_router(bulk_update.router, prefix=settings.api_prefix)
app.include_router(inventory.router, prefix=settings.api_prefix)
app.include_router(audit.router, prefix=settings.api_prefix)
app.include_router(welcome.router, prefix=settings.api_prefix)
app.include_router(utilities.router, prefix=settings.api_prefix)
app.include_router(exports.router, prefix=settings.api_prefix)


@app.get("/health")
def health():
    try:
        healthcheck()
        return {"status": "ok"}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "error", "detail": str(exc)})


# --- Serve the built frontend (frontend/dist) from this same server -------------------------------------------------
# One process, one address: the site at "/" and the API under settings.api_prefix ("/api/v1"). Skipped (API only) when
# the dist folder has not been built, so `npm run dev` + `uvicorn` development keeps working. Override with FRONTEND_DIST.
_DIST = Path(settings.frontend_dist).expanduser().resolve() if settings.frontend_dist else Path(__file__).resolve().parents[2] / "frontend" / "dist"

if (_DIST / "index.html").is_file():
    # Windows maps .js to text/plain through its registry, and browsers refuse module scripts with that type (blank page).
    for _ext, _type in {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json"}.items():
        mimetypes.add_type(_type, _ext)

    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend(path: str):
        if path == settings.api_prefix.strip("/") or path.startswith(settings.api_prefix.strip("/") + "/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        target = (_DIST / path).resolve()
        if path and target.is_file() and _DIST in target.parents:
            # Vite's hashed files never change, so browsers may keep them for a year; everything else is revalidated.
            cache = "public, max-age=31536000, immutable" if target.parent.name == "assets" else "no-cache"
            return FileResponse(target, headers={"Cache-Control": cache})
        # any other path is a client-side route (React Router): hand back the app shell
        return FileResponse(_DIST / "index.html", headers={"Cache-Control": "no-cache"})
