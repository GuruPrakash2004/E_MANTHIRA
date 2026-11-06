"""Start-up database check: additive only, idempotent. DDL runs inside a transaction that is always rolled back."""
from sqlalchemy import text

from app.core import web_schema
from app.core.db import get_engine


def _cols(conn, t):
    return {r[0].lower() for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": t})}


def test_missing_columns_are_added_once_nullable_and_nothing_else_changes():
    manifest = {
        "ZZTmpMig": [
            {"name": "A", "type": "int", "default": None},
            {"name": "Flag", "type": "char(1)", "default": "('N')"},
            {"name": "Amt", "type": "numeric(18,2)", "default": "((0))"},
            {"name": "Note", "type": "nvarchar(50)", "default": "(user_name())"},  # not a plain literal: no default
            {"name": "Bad; DROP TABLE x", "type": "int", "default": None},          # unsafe name: skipped
        ],
        "ZZNoSuchTable": [{"name": "X", "type": "int", "default": None}],            # table absent: never created
    }
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(text("CREATE TABLE dbo.ZZTmpMig (A int NOT NULL)"))
            conn.execute(text("INSERT INTO dbo.ZZTmpMig (A) VALUES (1)"))
            web_schema.last_report.update(skipped=[])
            added = web_schema.add_missing_columns(conn, manifest)
            assert sorted(added) == ["ZZTmpMig.Amt", "ZZTmpMig.Flag", "ZZTmpMig.Note"]
            assert _cols(conn, "ZZTmpMig") == {"a", "flag", "amt", "note"}
            assert not _cols(conn, "ZZNoSuchTable")
            assert any("unsafe" in s for s in web_schema.last_report["skipped"])
            null_ok = {r[0]: r[1] for r in conn.execute(text("SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ZZTmpMig'"))}
            assert null_ok["A"] == "NO" and null_ok["Flag"] == "YES"  # the existing column is untouched, the new one is NULL-able
            assert conn.execute(text("SELECT A FROM dbo.ZZTmpMig")).scalar() == 1
            assert web_schema.add_missing_columns(conn, manifest) == []  # second run changes nothing
        finally:
            tx.rollback()


def test_real_database_matches_the_manifest_so_a_run_changes_nothing():
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            assert web_schema.add_missing_columns(conn) == []
        finally:
            tx.rollback()


def test_provision_never_waits_on_a_lock_the_caller_holds():
    """The start-up bug: an uncommitted MstMenu write in the caller's transaction deadlocked with the cache's own MstMenu read."""
    with get_engine().connect() as holder:
        tx = holder.begin()
        try:
            holder.execute(text("UPDATE MstMenu SET MenuItemCaption = MenuItemCaption WHERE MenuItemID = (SELECT MIN(MenuItemID) FROM MstMenu)"))
            # an exclusive lock on a MstMenu row is now held by `holder`; provisioning on a database that already has
            # everything must neither wait for it nor change anything
            assert web_schema.provision() == []
        finally:
            tx.rollback()


def test_provision_inside_a_caller_transaction_still_rolls_back_cleanly():
    with get_engine().connect() as conn:
        tx = conn.begin()
        try:
            assert web_schema.provision(conn) == []
        finally:
            tx.rollback()


def test_cache_fingerprint_does_not_wait_for_an_uncommitted_write_to_a_watched_table():
    """Saving a menu switch hung: UPDATE MstMenu (uncommitted) then the audit row -> cache fingerprint read MstMenu on another connection."""
    import time

    from app.core import cache

    with get_engine().connect() as writer:
        tx = writer.begin()
        try:
            writer.execute(text("UPDATE MstMenu SET MenuItemCaption = MenuItemCaption WHERE MenuItemID = (SELECT MIN(MenuItemID) FROM MstMenu)"))
            t0 = time.monotonic()
            value = cache._fingerprint()
            assert value and "MstMenu:" in value
            assert time.monotonic() - t0 < 5
        finally:
            tx.rollback()
