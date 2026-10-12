"""
Reflected SQLAlchemy Core Table objects for the legacy schema.

We reflect (introspect) tables from the live database rather than redeclaring
270 columns by hand — this guarantees we never drift from the real schema
(CLAUDE.md rule 1: never change it; rule 3: never write computed columns).

`insert_row` / `update_row` are the ONLY way services write to legacy tables:
they silently drop any key that is not a real column or that is a computed
column, so a typo or an accidental computed-column write becomes a no-op
instead of a runtime SQL error or (worse) a silent wrong value.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Mapping

from sqlalchemy import MetaData, Table, select, text
from sqlalchemy.engine import Connection

from app.core.config import get_settings
from app.core.db import get_engine
from app.legacy.computed_columns import computed_columns_for

_metadata = MetaData()


@lru_cache(maxsize=256)
def table(name: str) -> Table:
    """Reflect (once, cached) and return a legacy table by its real DB name."""
    return Table(name, _metadata, autoload_with=get_engine())


def writable_columns(t: Table) -> set[str]:
    computed = computed_columns_for(t.name)
    return {c.name for c in t.columns if c.name not in computed}


def _filter(t: Table, values: Mapping[str, Any]) -> dict[str, Any]:
    allowed = writable_columns(t)
    return {k: v for k, v in values.items() if k in allowed}


def insert_row(conn: Connection, table_name: str, values: Mapping[str, Any], returning: str | None = None):
    """
    INSERT one row. If `returning` names an (auto-increment / identity) column,
    returns its new value.

    IMPORTANT: this does NOT use SQLAlchemy's `inserted_primary_key` — in the
    real legacy schema several transaction headers (TrnHdrSEVA, TrnHdrHB,
    TrnHdrDONREC, TrnHdrRCPTVCH, TrnHdrPMTVCH, ...) have their PRIMARY KEY on
    the document-number column (e.g. SEVANO), not on the identity `ID` column
    services actually want back (e.g. SEVAID). `inserted_primary_key` returns
    whatever the table's real PK is, so it silently returned the doc-number
    STRING instead of the identity INT and broke every create() path against
    the real DB (caught 2026-09-26 on a real Seva Entry save).

    IMPORTANT #2: a separate follow-up `SELECT SCOPE_IDENTITY()` round-trip
    (the first fix attempt) returns NULL under pyodbc — pyodbc sends the
    parameterised INSERT via `sp_executesql`, which is its own scope, so a
    second statement issued straight after sees no identity in ITS scope
    (caught 2026-09-26 switching the dev DB engine from pymssql to pyodbc).
    `.returning()` compiles to `OUTPUT INSERTED.<col>` on SQL Server, fetching
    the value from the INSERT's own result set in one round trip — no scope
    issue, and CLAUDE.md §9 asks for exactly this. Safe here: none of the
    identity-returning transaction headers have enabled triggers (which would
    make a bare OUTPUT clause illegal).
    """
    t = table(table_name)
    clean = _filter(t, values)
    if returning:
        if get_settings().is_mysql:
            conn.execute(t.insert().values(**clean))
            return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar_one())
        result = conn.execute(t.insert().values(**clean).returning(t.c[returning]))
        return int(result.scalar_one())
    conn.execute(t.insert().values(**clean))
    return None


def update_row(conn: Connection, table_name: str, pk_column: str, pk_value: Any, values: Mapping[str, Any]) -> None:
    t = table(table_name)
    clean = _filter(t, values)
    if not clean:
        return
    conn.execute(t.update().where(t.c[pk_column] == pk_value).values(**clean))


def next_master_id(conn: Connection, table_name: str, id_column: str) -> int:
    """
    Legacy (SQL Server) masters are NOT identity columns — the app computes
    MAX(id)+1 (`svtLibrary.AutoIncrementedNum`). Call this inside
    `with_transaction()`; the locking read below stops two concurrent saves
    computing the same next id.

    On the fresh MySQL sample schema every master DOES have an AUTO_INCREMENT
    id — this function is only called for parity with the legacy write-set,
    and inserting an explicit value into a MySQL AUTO_INCREMENT column is
    perfectly valid (it just advances the internal counter), so no branch is
    needed there beyond the locking-read syntax itself.
    """
    from sqlalchemy import text as _text

    if get_settings().is_mysql:
        result = conn.execute(_text(f"SELECT IFNULL(MAX({id_column}), 0) + 1 FROM {table_name} FOR UPDATE"))
    else:
        result = conn.execute(_text(f"SELECT ISNULL(MAX({id_column}), 0) + 1 FROM {table_name} WITH (UPDLOCK, HOLDLOCK)"))
    return int(result.scalar_one())
