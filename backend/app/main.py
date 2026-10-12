from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import audit, auth, bulk_update, company, db_settings, display, donations, hall_booking_entry, halls, inventory, masters, meta, panchanga, print as print_router, print_options, reports, roles, settings as settings_router, sevas, users, vouchers, welcome
from app.core.config import get_settings
from app.core.db import get_engine, healthcheck, with_transaction
from app.core.audit import ensure_schema
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
    yield
    get_engine().dispose()


settings = get_settings()
app = FastAPI(title="vTemple Web API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(db_settings.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(meta.router, prefix=settings.api_prefix)
app.include_router(masters.router, prefix=settings.api_prefix)
app.include_router(sevas.router, prefix=settings.api_prefix)
app.include_router(halls.router, prefix=settings.api_prefix)
app.include_router(hall_booking_entry.router, prefix=settings.api_prefix)
app.include_router(donations.router, prefix=settings.api_prefix)
app.include_router(vouchers.router, prefix=settings.api_prefix)
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


@app.get("/health")
def health():
    try:
        healthcheck()
        return {"status": "ok"}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "error", "detail": str(exc)})
