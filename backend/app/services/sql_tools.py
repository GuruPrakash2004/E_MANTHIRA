"""
SQL Query Execution (frmUtlSQLQueryExec) and SQL Saved Query (frmRptQuery), ported READ-ONLY.

The EXE's window runs any statement. The web version runs exactly one SELECT (or WITH ... SELECT) per call:
  * `validate_select` blanks out string literals and bracketed / quoted names, then rejects comments, a second statement,
    variables, and every keyword that can write, change structure, call a procedure or reach outside the database;
  * the statement runs on its own connection under READ UNCOMMITTED with a lock timeout, the result is capped, and the
    transaction is ALWAYS rolled back, so even a statement that slipped past the validator could not commit anything;
  * columns that look like secrets (pwd / password / secret / token) come back masked;
  * every run is written to WebAuditLog (who, what).
Saved queries live in the EXE's own table `RptQuery` (QID, Query, QName, QGroup); a database without it reports so. A saved
query is validated on save with the same rule, so a stored query can never be anything but a SELECT.

The table browser (left panel of the EXE) reads `sys.tables` / `information_schema`. The EXE's "Edit Top 200 Rows" and
"Script Table As Create / Drop" are not ported (they write or script DDL).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.db import get_engine

MAX_ROWS = 5000
MAX_SQL = 20000
SECRET_COL = re.compile(r"(pwd|passw|secret|token)", re.I)
_FORBIDDEN = {
    "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "CREATE", "ALTER", "TRUNCATE", "EXEC", "EXECUTE", "GRANT", "REVOKE", "DENY", "INTO",
    "OPENROWSET", "OPENQUERY", "OPENDATASOURCE", "BULK", "DBCC", "BACKUP", "RESTORE", "KILL", "SHUTDOWN", "WAITFOR", "USE", "SET", "DECLARE",
    "GO", "RECONFIGURE", "SQL_LOGINS", "SYSLOGINS", "SYSXLOGINS", "SERVER_PRINCIPALS", "SYSTEM_USER",
}
_WORD = re.compile(r"[A-Za-z_@#][A-Za-z0-9_@#$]*")


def _mask_literals(sql: str) -> str:
    """The statement with every '...' literal and [...] / "..." name reduced to a placeholder; raises on comments."""
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    break
                i += 1
            else:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A text value is not closed (missing ')")
            out.append("''")
            i += 1
        elif ch in "[\"":
            close = "]" if ch == "[" else '"'
            j = sql.find(close, i + 1)
            if j < 0:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A quoted name is not closed")
            out.append("x")
            i = j + 1
        elif sql.startswith("--", i) or sql.startswith("/*", i):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Comments are not allowed in a query")
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def validate_select(sql: str) -> str:
    """The statement to run (one trailing ; removed), or a 422 saying why it is refused."""
    sql = (sql or "").strip()
    if not sql:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a query")
    if len(sql) > MAX_SQL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The query is too long")
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    masked = _mask_literals(sql)
    if ";" in masked:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only one statement can be run at a time")
    words = [w.upper() for w in _WORD.findall(masked)]
    if not words or words[0] not in ("SELECT", "WITH"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only a SELECT query can be run here")
    for w in words:
        if w in _FORBIDDEN or w.startswith(("XP_", "SP_")) or (w.startswith("@") and not w.startswith("@@")):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"'{w}' is not allowed - this window only reads data")
    return sql


def _jsonable(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"<{len(bytes(v))} bytes>"
    return v


def run_select(sql: str, *, user_code: str) -> dict:
    """Validate, run read-only on a separate connection, always roll back."""
    sql = validate_select(sql)
    started = datetime.now()
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(text("SET LOCK_TIMEOUT 10000"))
            conn.execute(text("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"))
            try:
                raw = conn.connection.driver_connection
                raw.timeout = 30  # seconds, pyodbc
            except Exception:  # noqa: BLE001 - another driver: the lock timeout still applies
                pass
            try:
                result = conn.execute(text(sql))
                if not result.returns_rows:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That statement returned no rows")
                columns = list(result.keys())
                fetched = result.fetchmany(MAX_ROWS + 1)
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001 - the database's own message is what the user needs
                msg = str(getattr(exc, "orig", exc)).split("] ")[-1][:400]
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Error on Executing query: {msg}")
            masked = [bool(SECRET_COL.search(str(c))) for c in columns]
            rows = [[("********" if m and v not in (None, "") else _jsonable(v)) for v, m in zip(r, masked)] for r in fetched[:MAX_ROWS]]
        finally:
            tx.rollback()
    with get_engine().begin() as a:
        audit.record(a, entity="SQL Query", entity_id=started.strftime("%Y%m%d%H%M%S"), action="A", user_code=user_code, details=sql[:480])
    return {"columns": [str(c) for c in columns], "rows": rows, "row_count": len(rows), "truncated": len(fetched) > MAX_ROWS, "ms": int((datetime.now() - started).total_seconds() * 1000)}


# ---------------------------------------------------------------- table browser

def server_info(conn: Connection) -> dict:
    r = conn.execute(text("SELECT @@SERVERNAME, DB_NAME()")).first()
    return {"server": (r[0] or "").strip(), "database": (r[1] or "").strip()}


def tables(conn: Connection, search: str = "") -> list[dict]:
    sql = "SELECT name FROM sys.tables"
    params: dict = {}
    if search.strip():
        sql += " WHERE name LIKE :q"
        params["q"] = f"%{search.strip()}%"
    return [{"name": r[0]} for r in conn.execute(text(sql + " ORDER BY name"), params)]


def columns(conn: Connection, table: str) -> list[dict]:
    rows = conn.execute(
        text("SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name = :t ORDER BY ordinal_position"), {"t": table}
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Table not found")
    return [{"name": r[0], "type": r[1], "length": r[2], "nullable": r[3] == "YES"} for r in rows]


# ---------------------------------------------------------------- saved queries (RptQuery)

SAVED_COLS = {"qid", "query", "qname", "qgroup"}


def saved_available(conn: Connection) -> list[str]:
    have = {r[0].lower() for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'RptQuery'"))}
    return [] if {"query", "qname", "qgroup"} <= have else ["RptQuery"]


def saved_list(conn: Connection, group: str = "") -> dict:
    miss = saved_available(conn)
    if miss:
        return {"available": False, "missing": miss}
    groups = [(r[0] or "").strip() for r in conn.execute(text("SELECT DISTINCT QGroup FROM RptQuery ORDER BY QGroup"))]
    sql = "SELECT QName, QGroup FROM RptQuery" + (" WHERE QGroup = :g" if group else "") + " ORDER BY QName"
    rows = [{"name": (r[0] or "").strip(), "group": (r[1] or "").strip()} for r in conn.execute(text(sql), {"g": group} if group else {})]
    return {"available": True, "groups": [g for g in groups if g], "queries": rows}


def saved_get(conn: Connection, name: str) -> dict:
    if saved_available(conn):
        raise HTTPException(status.HTTP_409_CONFLICT, "This database has no RptQuery table")
    r = conn.execute(text("SELECT QName, QGroup, Query FROM RptQuery WHERE QName = :n"), {"n": name}).first()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Query not found")
    return {"name": (r[0] or "").strip(), "group": (r[1] or "").strip(), "query": r[2] or ""}


def saved_save(conn: Connection, *, name: str, group: str, query: str, user_code: str) -> None:
    if saved_available(conn):
        raise HTTPException(status.HTTP_409_CONFLICT, "This database has no RptQuery table")
    name, group = (name or "").strip(), (group or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Query Name should not be blank")
    if not group:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Select Group Name from the list")
    query = validate_select(query)  # a stored query can only ever be a SELECT
    if conn.execute(text("SELECT 1 FROM RptQuery WHERE QName = :n"), {"n": name}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Table name already Exist!")
    cols = {r[0].lower() for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'RptQuery'"))}
    ident = conn.execute(text("SELECT COLUMNPROPERTY(OBJECT_ID('RptQuery'), 'QID', 'IsIdentity')")).scalar() if "qid" in cols else None
    if "qid" in cols and not ident:
        conn.execute(text("INSERT INTO RptQuery (QID, Query, QName, QGroup) SELECT ISNULL(MAX(QID), 0) + 1, :q, :n, :g FROM RptQuery"), {"q": query, "n": name, "g": group})
    else:
        conn.execute(text("INSERT INTO RptQuery (Query, QName, QGroup) VALUES (:q, :n, :g)"), {"q": query, "n": name, "g": group})
    audit.record(conn, entity="Saved Query", entity_id=name, action="A", user_code=user_code, details=group)


def saved_delete(conn: Connection, *, name: str, user_code: str) -> None:
    if saved_available(conn):
        raise HTTPException(status.HTTP_409_CONFLICT, "This database has no RptQuery table")
    n = conn.execute(text("DELETE FROM RptQuery WHERE QName = :n"), {"n": name}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Query not found")
    audit.record(conn, entity="Saved Query", entity_id=name, action="D", user_code=user_code)
