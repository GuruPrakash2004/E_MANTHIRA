"""
Audit trail — port of `svtModule.RecordAuditLog`.

The legacy app writes to a separate `<DB>AuditLog` database using per-document
SQL templates from `UtlTransactions.AuditSQLHdr/AuditSQLDtl`. That database
was not included in the sample backup (doc 01 §11), so this new app writes
to a small `WebAuditLog` table in the main database instead — one row per
create/edit/delete/cancel, with a JSON snapshot of what changed.

If the table is absent in a database it is NOT created: auditing degrades to a no-op.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

import logging

from app.core import capabilities
from app.core.config import get_settings

log = logging.getLogger(__name__)


def ensure_schema(conn: Connection) -> None:
    if get_settings().is_mysql:
        # The fresh MySQL sample schema already creates WebAuditLog (see
        # sql/mysql_schema.sql) — nothing to do, just confirm it's there.
        exists = conn.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'WebAuditLog'")
        ).scalar()
        if not exists:
            raise RuntimeError("WebAuditLog table missing — run backend/sql/mysql_schema.sql first")
        return

    # Create the web-only tables a legacy database lacks (user decision 2026-11-04; see core/web_schema.py). If the login
    # cannot create them, that feature just stays off.
    from app.core import web_schema

    web_schema.provision()  # own autocommit connection: never inside this transaction
    if not conn.execute(text("SELECT 1 FROM sys.tables WHERE name = 'WebAuditLog'")).scalar():
        log.warning("WebAuditLog is not present in this database - web audit trail disabled")


def record(conn: Connection, *, entity: str, entity_id: object, action: str, user_code: str, details: str | None = None) -> None:
    if not capabilities.has_table("WebAuditLog"):
        return
    conn.execute(
        text(
            "INSERT INTO WebAuditLog (UserCode, Entity, EntityID, Action, Details) "
            "VALUES (:u, :e, :id, :a, :d)"
        ),
        {"u": user_code, "e": entity, "id": str(entity_id), "a": action[:1].upper(), "d": details},
    )
