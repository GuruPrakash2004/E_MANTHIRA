"""Every temple database on the server must be servable by this one web app (read-only checks, real databases, no mocks).

Targets: env VT_TEMPLE_DBS="vTmplSLV,vTmplNMM,..." or, when unset, every database on the configured server whose name
contains "tmpl" / "temple". Skipped when the server is unreachable.

For each database:
  * the metadata tables the whole app is built on exist;
  * a DocID the screens are wired to either is that document (same header table) or is reported unavailable - it is
    never silently another document (e.g. 1268 = "Seva Multiple Chit" in some editions);
  * every legacy-written password decrypts with the legacy 3DES key (old EXE and web app share the logins).
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from app.core import legacy_crypto
from app.core.capabilities import FIXED_DOC_TABLES, available_in
from app.core.config import get_settings

CORE = ("MstMenu", "UtlTransactions", "UtlDocDsgrFlds", "UtlOption", "MstCompFinYear", "MstUser", "UtlDocNoPrefix", "UtlDocNoFmt")


def _engine(db: str):
    upd = {"db_name": db}
    for env, field in (("DB_SERVER", "db_server"), ("DB_USER", "db_user"), ("DB_PASSWORD", "db_password"), ("DB_DRIVER_ODBC", "db_driver_odbc")):
        if os.environ.get(env):
            upd[field] = os.environ[env]
    return create_engine(get_settings().model_copy(update=upd)._pyodbc_url)


def _targets() -> list[str]:
    env = os.environ.get("VT_TEMPLE_DBS", "").strip()
    if env:
        return [d.strip() for d in env.split(",") if d.strip()]
    try:
        with _engine("master").connect() as c:
            names = [r[0] for r in c.execute(text("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name"))]
    except Exception:  # noqa: BLE001
        return []
    return [n for n in names if "tmpl" in n.lower() or "temple" in n.lower()]


DBS = _targets()


@pytest.fixture(scope="module", params=DBS or [pytest.param(None, marks=pytest.mark.skip(reason="server unreachable"))])
def db(request):
    eng = _engine(request.param)
    with eng.connect() as c:
        yield request.param, c
    eng.dispose()


def test_core_tables_exist(db):
    name, c = db
    have = {r[0].lower() for r in c.execute(text("SELECT name FROM sys.tables"))}
    missing = [t for t in CORE if t.lower() not in have]
    assert not missing, f"{name} lacks core metadata tables {missing}"


def test_fixed_docids_are_never_another_document(db):
    name, c = db
    owners = {int(r[0]): (r[1] or "").strip().lower() for r in c.execute(text("SELECT DocID, HdrTblName FROM UtlTransactions"))}
    have = {r[0].lower() for r in c.execute(text("SELECT name FROM sys.tables"))}
    for doc_id, table in FIXED_DOC_TABLES.items():
        ok = available_in(doc_id, owners, have)
        if owners.get(doc_id) == table.lower() and table.lower() in have:
            assert ok, f"{name}: {doc_id} is {table} and its table exists, so it must be available"
        else:
            # missing document, missing table, or the id belongs to another document: the screen must be "not available"
            assert not ok, f"{name}: {doc_id} ({owners.get(doc_id)!r}) must not be served as {table}"


def test_legacy_passwords_decrypt(db):
    name, c = db
    bad = []
    for code, pwd in c.execute(text("SELECT UserCode, LoginPwd FROM MstUser WHERE Inactive <> 'Y'")):
        try:
            plain = legacy_crypto.decrypt(pwd) if pwd else ""
            if not plain.isprintable():
                bad.append(code)
        except Exception:  # noqa: BLE001
            bad.append(code)
    assert not bad, f"{name}: passwords of {bad} do not decrypt with the legacy key"
