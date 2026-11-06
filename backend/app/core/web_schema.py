"""
Self-provisioning of the web-only tables (user decision 2026-11-04, replaces the old "never create tables" rule).

A client database restored from the legacy EXE has none of the `Web*` tables the web app uses. On start-up, and every time
the Database Settings panel points the app at another database, whatever is missing here is created, once, so every
feature works without anyone running scripts.

Strict limits, so the legacy EXE keeps working side by side:
  * only the four tables below are ever created (new tables; no existing table or column is touched);
  * each is `IF NOT EXISTS`, so running it again does nothing;
  * one extra data row: the "Ask the Data" menu entry (same shape as the other web-only menu rows), only when absent;
  * missing COLUMNS of tables the database already has are added (add_missing_columns), from app/core/schema_manifest.json
    (made from the reference DB by tools/make_schema_manifest.py): always nullable, never identity or computed, never
    dropped / renamed / retyped, never a table the database does not have (those features show "not available");
  * a login without CREATE rights is not an error: it is logged and the feature stays hidden ("not available").
Exact copies of backend/tools/create_*.sql / add_ask_menu.sql and of the WebAuditLog / WebPrintPref definitions.
"""
from __future__ import annotations

import json
import logging
import re
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import cache

log = logging.getLogger("uvicorn.error")

_TABLES: dict[str, str] = {
    "WebAuditLog": """
        CREATE TABLE dbo.WebAuditLog (
            ID        int IDENTITY(1,1) NOT NULL PRIMARY KEY,
            AtUtc     datetime2      NOT NULL DEFAULT (SYSUTCDATETIME()),
            UserCode  nvarchar(100)  NULL,
            Entity    nvarchar(200)  NOT NULL,
            EntityID  nvarchar(100)  NOT NULL,
            Action    char(1)        NOT NULL,
            Details   nvarchar(max)  NULL
        )""",
    "WebPrintPref": """
        CREATE TABLE dbo.WebPrintPref (
            UserCode    nvarchar(100) NOT NULL,
            DocID       int           NOT NULL,
            OptionName  nvarchar(200) NOT NULL,
            ChangedOn   datetime2     NOT NULL DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT PK_WebPrintPref PRIMARY KEY (UserCode, DocID)
        )""",
    "WebAiQueryHistory": """
        CREATE TABLE dbo.WebAiQueryHistory (
            ID           int IDENTITY(1,1) NOT NULL PRIMARY KEY,
            UserCode     nvarchar(50)   NULL,
            AskedAt      datetime       NOT NULL DEFAULT (GETDATE()),
            Lang         varchar(5)     NULL,
            Question     nvarchar(1000) NOT NULL,
            GeneratedSql nvarchar(max)  NULL,
            ChartType    varchar(20)    NULL,
            [RowCount]   int            NULL,
            AnswerText   nvarchar(max)  NULL,
            Status       varchar(10)    NOT NULL DEFAULT ('ok'),
            Rating       tinyint        NULL
        );
        CREATE INDEX IX_WebAiQueryHistory_User ON dbo.WebAiQueryHistory (UserCode, AskedAt DESC)""",
    "WebSplitPayment": """
        CREATE TABLE dbo.WebSplitPayment (
            SplitID       int IDENTITY(1,1) NOT NULL PRIMARY KEY,
            DocType       varchar(10)    NOT NULL,
            DocID         int            NOT NULL,
            SlNo          int            NOT NULL,
            PayMode       varchar(20)    NOT NULL,
            Amount        numeric(18,2)  NOT NULL,
            CashBankLedID int            NOT NULL,
            RefNo         nvarchar(60)   NULL,
            ChqDate       datetime       NULL,
            BankName      nvarchar(60)   NULL,
            AddedBy       nvarchar(50)   NULL,
            AddedOn       datetime       NOT NULL DEFAULT (GETDATE())
        );
        CREATE INDEX IX_WebSplitPayment_Doc ON dbo.WebSplitPayment (DocType, DocID)""",
}

_ASK_MENU = """
    INSERT INTO MstMenu (MenuItemID, MenuItemCaption, MenuItemName, Menuindex, MenuItemType, DocID, CustomReport, MenuShow, FrmName,
                         IconName, MenuGroupName, IsSepReq, WebMenuShow, WebUrlPage, PWAMenuShow)
    SELECT (SELECT MAX(MenuItemID) + 1 FROM MstMenu), 'Ask the Data', 'SVTMNU',
           (SELECT MAX(Menuindex) + 1 FROM MstMenu WHERE MenuItemType = 4), 4, 0, 'N', 'Y', '', '', '', 'N', 'Y', 'AskData.aspx', 'N'
    WHERE NOT EXISTS (SELECT 1 FROM MstMenu WHERE MenuItemCaption = 'Ask the Data')"""


MANIFEST_PATH = Path(__file__).with_name("schema_manifest.json")
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TYPE = re.compile(r"^[a-z0-9]+(\((\d+|max)(,\d+)?\))?$")
_DEFAULT = re.compile(r"^\(*(N?'[^']*'|-?\d+(\.\d+)?|getdate\(\)|NULL)\)*$", re.I)

# what the last check did (shown by GET /meta/db-check for ADMIN)
last_report: dict = {"tables_created": [], "columns_added": [], "skipped": [], "checked_at": None}


def _manifest() -> dict[str, list[dict]]:
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        log.warning("db check: schema manifest unreadable (%s)", exc)
        return {}


def add_missing_columns(conn: Connection, manifest: dict[str, list[dict]] | None = None, own: bool = False) -> list[str]:
    """
    ADD (never change) the columns an older database lacks on tables it already has. Each is created NULL-able, with the
    reference default when that is a plain literal. Returns ["Table.Column", ...] for what was added; a column that cannot
    be added is recorded in last_report["skipped"] and the rest carry on.
    """
    manifest = _manifest() if manifest is None else manifest
    have: dict[str, set[str]] = {}
    real: dict[str, str] = {}
    for t, c in conn.execute(text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS")):
        have.setdefault(str(t).lower(), set()).add(str(c).lower())
        real[str(t).lower()] = str(t)
    added: list[str] = []
    for table, cols in manifest.items():
        key = table.lower()
        if key not in have:
            continue  # a table this database does not have is never created (the feature shows "not available here")
        for col in cols:
            name, typ, dflt = col["name"], col["type"], col.get("default")
            if name.lower() in have[key]:
                continue
            if not (_IDENT.match(table) and _IDENT.match(name) and _TYPE.match(typ)):
                last_report["skipped"].append(f"{table}.{name}: unsafe name or type")
                continue
            default = f" DEFAULT {dflt}" if dflt and _DEFAULT.match(dflt) else ""
            try:
                with _Step(conn, own):
                    conn.execute(text(f"ALTER TABLE dbo.[{real[key]}] ADD [{name}] {typ} NULL{default}"))
                added.append(f"{real[key]}.{name}")
                have[key].add(name.lower())
                log.warning("db check: added column %s.%s (%s)", real[key], name, typ)
            except Exception as exc:  # noqa: BLE001
                last_report["skipped"].append(f"{table}.{name}: {str(exc).splitlines()[0][:120]}")
                log.warning("db check: could not add %s.%s (%s)", table, name, str(exc).splitlines()[0][:160])
    return added


class _Step:
    """One change. `own` = this module's own connection: commit it at once (rollback on error). Otherwise (a caller's
    transaction, e.g. tests that roll everything back) use a savepoint and leave committing to the caller."""

    def __init__(self, conn: Connection, own: bool):
        self.conn, self.own = conn, own

    def __enter__(self):
        self.sp = None if self.own else self.conn.begin_nested()
        return self

    def __exit__(self, et, ev, tb):
        if self.own:
            if et is None:
                self.conn.commit()
            else:
                self.conn.rollback()
        elif et is None:
            self.sp.commit()
        else:
            self.sp.rollback()
        return False


def provision(conn: Connection | None = None, _own: bool = False) -> list[str]:
    """
    Create whatever web table / column is missing; returns what was done. Never raises: a failure only leaves that feature off.

    It runs on its OWN connection (the `conn` argument is only for tests that roll back) and commits after every single
    change. It must never sit inside the caller's open transaction: the metadata cache reads MstMenu on
    another pool connection, and an uncommitted menu row would make that read wait for a lock this code is still holding.
    """
    if conn is None:
        from app.core.db import get_engine

        try:
            with get_engine().connect() as own:
                done = provision(own, _own=True)
        except Exception as exc:  # noqa: BLE001
            log.warning("db check: could not run (%s)", str(exc).splitlines()[0][:160])
            return []
        if done:
            cache.clear()  # only now, after everything is committed: has_table etc. were read before the tables existed
            from app.meta import menu as meta_menu

            meta_menu.invalidate()
        return done

    done: list[str] = []
    last_report.update(tables_created=[], columns_added=[], skipped=[], checked_at=datetime.now().isoformat(timespec="seconds"))
    try:
        have = {str(r[0]).lower() for r in conn.execute(text("SELECT name FROM sys.tables"))}
    except Exception as exc:  # noqa: BLE001
        log.warning("web tables: could not read the table list (%s)", exc)
        return done
    for name, ddl in _TABLES.items():
        if name.lower() in have:
            continue
        try:
            with _Step(conn, _own):
                for stmt in ddl.split(";\n"):
                    conn.execute(text(stmt))
            done.append(name)
            log.warning("web tables: created %s in this database", name)
        except Exception as exc:  # noqa: BLE001
            log.warning("web tables: could not create %s (%s) - that feature stays off", name, str(exc).splitlines()[0][:160])
    if "WebAiQueryHistory" in have or "WebAiQueryHistory" in done:
        try:
            with _Step(conn, _own):
                if conn.execute(text(_ASK_MENU)).rowcount:
                    done.append("Ask the Data menu")
        except Exception as exc:  # noqa: BLE001
            log.warning("web tables: could not add the Ask the Data menu row (%s)", str(exc).splitlines()[0][:160])
    last_report["tables_created"] = list(done)
    try:
        cols = add_missing_columns(conn, own=_own)
        last_report["columns_added"] = cols
        done.extend(cols)
    except Exception as exc:  # noqa: BLE001
        log.warning("db check: column check failed (%s)", str(exc).splitlines()[0][:160])
    return done
