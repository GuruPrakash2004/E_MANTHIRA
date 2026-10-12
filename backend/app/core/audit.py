"""
Audit trail — port of `svtModule.RecordAuditLog`.

The legacy app writes to a separate `<DB>AuditLog` database using per-document
SQL templates from `UtlTransactions.AuditSQLHdr/AuditSQLDtl`. That database
was not included in the sample backup (doc 01 §11), so this new app writes
to a small `WebAuditLog` table in the main database instead — one row per
create/edit/delete/cancel, with a JSON snapshot of what changed.

This is the ONE deliberate new table allowed by CLAUDE.md rule 1 (prefixed
`Web`, created idempotently here, never touching legacy tables).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings


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

    exists = conn.execute(text("SELECT 1 FROM sys.tables WHERE name = 'WebAuditLog'")).scalar()
    if exists:
        return
    conn.execute(
        text(
            """
            CREATE TABLE WebAuditLog (
                ID INT IDENTITY(1,1) PRIMARY KEY,
                AtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                UserCode NVARCHAR(50) NULL,
                Entity NVARCHAR(100) NOT NULL,
                EntityID NVARCHAR(50) NOT NULL,
                Action CHAR(1) NOT NULL,   -- A / M / D / C (add/modify/delete/cancel)
                Details NVARCHAR(MAX) NULL
            )
            """
        )
    )


def record(conn: Connection, *, entity: str, entity_id: object, action: str, user_code: str, details: str | None = None) -> None:
    conn.execute(
        text(
            "INSERT INTO WebAuditLog (UserCode, Entity, EntityID, Action, Details) "
            "VALUES (:u, :e, :id, :a, :d)"
        ),
        {"u": user_code, "e": entity, "id": str(entity_id), "a": action[:1].upper(), "d": details},
    )
