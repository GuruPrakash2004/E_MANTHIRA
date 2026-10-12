"""
Remembers each user's last-chosen print option per document — the same
"once you pick a format it becomes the one that comes up next time" feel as
the legacy EXE's per-user option memory, without touching `UtlOption`
(`DefaultPrint` stays the shared admin-configured fallback for users who
have never picked one). New `Web`-prefixed table, created idempotently here
— same pattern as `app/core/audit.py` (CLAUDE.md rule 1).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings


def ensure_schema(conn: Connection) -> None:
    if get_settings().is_mysql:
        return
    exists = conn.execute(text("SELECT 1 FROM sys.tables WHERE name = 'WebPrintPref'")).scalar()
    if exists:
        return
    conn.execute(
        text(
            """
            CREATE TABLE WebPrintPref (
                UserCode NVARCHAR(50) NOT NULL,
                DocID INT NOT NULL,
                OptionName NVARCHAR(100) NOT NULL,
                ChangedOn DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_WebPrintPref PRIMARY KEY (UserCode, DocID)
            )
            """
        )
    )


def get_preferred_option(conn: Connection, user_code: str, doc_id: int) -> str | None:
    return conn.execute(
        text("SELECT OptionName FROM WebPrintPref WHERE UserCode = :u AND DocID = :d"),
        {"u": user_code, "d": doc_id},
    ).scalar()


def set_preferred_option(conn: Connection, user_code: str, doc_id: int, option_name: str) -> None:
    updated = conn.execute(
        text(
            "UPDATE WebPrintPref SET OptionName = :o, ChangedOn = SYSUTCDATETIME() "
            "WHERE UserCode = :u AND DocID = :d"
        ),
        {"o": option_name, "u": user_code, "d": doc_id},
    ).rowcount
    if not updated:
        conn.execute(
            text("INSERT INTO WebPrintPref (UserCode, DocID, OptionName) VALUES (:u, :d, :o)"),
            {"u": user_code, "d": doc_id, "o": option_name},
        )
