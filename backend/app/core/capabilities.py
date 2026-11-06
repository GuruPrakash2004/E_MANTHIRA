"""
Per-database schema capabilities.

The temple databases on a server are different versions of the same product
(some lack the Hall tables, WebAuditLog, newer columns...). This reads
INFORMATION_SCHEMA once per connection target, caches it (cache.clear() on
`reset_engine()` drops it with the rest of the metadata), and lets code ask
"is this available here?" instead of failing with an SQL error.

Read-only: never creates or alters anything (golden rule 1).
"""
from __future__ import annotations

from sqlalchemy import text

from app.core import cache

_TTL = 600.0


def _load() -> dict:
    from app.core.db import get_engine

    tables: set[str] = set()
    columns: dict[str, set[str]] = {}
    with get_engine().connect() as c:
        for t, col in c.execute(
            text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS")
        ):
            tl = str(t).lower()
            tables.add(tl)
            columns.setdefault(tl, set()).add(str(col).lower())
    computed: dict[str, set[str]] = {}
    try:  # SQL Server only; MySQL generated columns are not used by the legacy schema
        with get_engine().connect() as c:
            for t, col in c.execute(
                text("SELECT OBJECT_NAME(object_id), name FROM sys.computed_columns")
            ):
                computed.setdefault(str(t).lower(), set()).add(str(col).lower())
    except Exception:
        pass
    return {"tables": tables, "columns": columns, "computed": computed}


def snapshot() -> dict:
    return cache.get_or_set(("caps",), _TTL, _load)


def has_table(name: str) -> bool:
    return name.lower() in snapshot()["tables"]


def has_col(table: str, column: str) -> bool:
    return column.lower() in snapshot()["columns"].get(table.lower(), ())


def computed(table: str) -> set[str]:
    """Columns this database computes itself (lower-case) - read live, never assumed from another temple's DB."""
    return set(snapshot().get("computed", {}).get(table.lower(), ()))


def cols(table: str) -> set[str]:
    return set(snapshot()["columns"].get(table.lower(), ()))


def missing_tables(*names: str) -> list[str]:
    return [n for n in names if not has_table(n)]


def report(tables: dict[str, list[str]]) -> dict:
    """{table: [needed columns]} -> what is absent here, for the UI/tools."""
    out: dict[str, object] = {}
    for t, needed in tables.items():
        if not has_table(t):
            out[t] = "table missing"
        else:
            miss = [c for c in needed if not has_col(t, c)]
            if miss:
                out[t] = miss
    return out


def sel(table: str, alias: str, column: str, default: str = "NULL") -> str:
    """SQL fragment for `alias.column`, or `default` (a SQL literal) when this temple's table has no such column.
    Lets one query serve every schema version: SELECT {sel('TrnHdrSEVA','h','NAMEINKAN',"''")} AS NAMEINKAN."""
    return f"{alias}.{column}" if has_col(table, column) else default


# DocIDs the web screens are wired to, with the header table each one must own. Temples number their documents the same
# way, but an older/different edition can reuse a DocID for another document (e.g. 1268 is "Seva Multiple Chit" in
# vTMPLJNANAGNAPA): running a Stock Adjustment screen on that definition would be wrong, so such a screen is "not available".
FIXED_DOC_TABLES = {
    1263: "TrnHdrSEVA", 1261: "TrnHdrDONREC", 1281: "TrnHdrHB", 1280: "TrnHdrHBE", 1224: "TrnHdrPMTVCH",
    1248: "TrnHdrRCPTVCH", 1254: "TrnHdrJNRVCH", 1260: "TrnHdrEXP", 1268: "TrnHdrSA", 1270: "TrnHdrISS",
    1271: "TrnHdrPB", 1272: "TrnHdrPURVCH", 1149: "MstHdrBOM",
}


def _doc_tables() -> dict[int, str]:
    def load() -> dict[int, str]:
        from app.core.db import get_engine

        with get_engine().connect() as c:
            return {int(r[0]): str(r[1] or "").strip().lower() for r in c.execute(text("SELECT DocID, HdrTblName FROM UtlTransactions"))}

    return cache.get_or_set(("caps_docs",), _TTL, load)


def available_in(doc_id: int, owners: dict[int, str], tables: set[str]) -> bool:
    """Pure form of `doc_available`: `owners` = {DocID: lower-case HdrTblName} from UtlTransactions, `tables` = lower-case table names."""
    want = FIXED_DOC_TABLES.get(doc_id)
    if want is None:
        return True
    return owners.get(doc_id) == want.lower() and want.lower() in tables


def doc_available(doc_id: int) -> bool:
    """False when this database's UtlTransactions has no such document, or the DocID belongs to a different document."""
    if doc_id not in FIXED_DOC_TABLES:
        return True
    return available_in(doc_id, _doc_tables(), snapshot()["tables"])
