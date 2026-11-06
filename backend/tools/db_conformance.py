"""
Cross-temple schema conformance (read-only, SELECTs only).

For every temple database on the server (or the names given) report, per web feature, whether the tables / columns /
DocIDs the feature needs exist: OK, DEGRADED (some columns absent: the app hides or skips them) or UNAVAILABLE (a
required table or the DocID is absent: the screen shows "not available in this database").

    cd backend && .venv/Scripts/python.exe tools/db_conformance.py [DbName ...]

Server/credentials come from the normal settings (.env / runtime_db_settings.json); override with env DB_SERVER,
DB_USER, DB_PASSWORD. Reference columns are read from the first database named (default vTmplSLV).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402

REF_DB = "vTmplSLV"

# feature -> (DocID, required tables). Extra columns of these tables that the reference DB has but another lacks
# are reported as DEGRADED.
FEATURES: dict[str, tuple[int | None, tuple[str, ...]]] = {
    "Seva Entry": (1263, ("TrnHdrSEVA", "TrnDtlSevaDates")),
    "Donation Receipt": (1261, ("TrnHdrDONREC",)),
    "Hall Booking": (1281, ("TrnHdrHB", "TrnST", "MstHALL")),
    "Hall Booking Entry": (1280, ("TrnHdrHBE", "TrnDtlHBE")),
    "Payment Voucher": (1224, ("TrnHdrPMTVCH",)),
    "Receipt Voucher": (1248, ("TrnHdrRCPTVCH",)),
    "Expense Entry": (1260, ("TrnHdrEXP", "TrnDtlEXP")),
    "Journal Voucher": (1254, ("TrnHdrJNRVCH",)),
    "Accounts GL": (None, ("TrnHdrAcc", "TrnDtlAcc", "MstLED")),
    "Seva master": (1265, ("MstSVA",)),
    "Sannidhi master": (1255, ("MstSANNIDHI",)),
    "Gothra/Nakshatra/Rashi": (1257, ("MstGOTHRA", "MstNAKSHATRA", "MstRASHI")),
    "Stock docs": (1268, ("TrnHdrSA", "TrnHdrISS", "TrnHdrPB", "TrnHdrPURVCH")),
    "Web audit trail": (None, ("WebAuditLog",)),
    "Web print prefs": (None, ("WebPrintPref",)),
}
CORE = ("MstMenu", "UtlTransactions", "UtlDocDsgrFlds", "UtlOption", "MstCompFinYear", "MstUser", "UtlDocNoPrefix", "UtlDocNoFmt")


def _engine(db: str):
    from sqlalchemy import create_engine

    import os

    upd = {"db_name": db}
    # env wins over runtime_db_settings.json so this tool can target any server without touching the app's saved target
    for env, field in (("DB_SERVER", "db_server"), ("DB_USER", "db_user"), ("DB_PASSWORD", "db_password"), ("DB_DRIVER_ODBC", "db_driver_odbc")):
        if os.environ.get(env):
            upd[field] = os.environ[env]
    s = get_settings().model_copy(update=upd)
    return create_engine(s._pyodbc_url)


def _snapshot(db: str) -> dict:
    eng = _engine(db)
    with eng.connect() as c:
        cols: dict[str, set[str]] = {}
        for t, col in c.execute(text("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS")):
            cols.setdefault(t.lower(), set()).add(col.lower())
        docs = {int(r[0]) for r in c.execute(text("SELECT DocID FROM UtlTransactions"))} if "utltransactions" in cols else set()
    eng.dispose()
    return {"cols": cols, "docs": docs}


def main(argv: list[str]) -> int:
    master = _engine("master")
    with master.connect() as c:
        every = [r[0] for r in c.execute(text("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name"))]
    master.dispose()
    dbs = argv or [d for d in every if "tmpl" in d.lower() or "temple" in d.lower()]
    ref = _snapshot(REF_DB)
    bad = 0
    print(f"reference: {REF_DB}\n")
    for db in dbs:
        try:
            snap = _snapshot(db)
        except Exception as exc:  # noqa: BLE001
            print(f"== {db}: cannot read ({str(exc)[:80]})")
            bad += 1
            continue
        core_missing = [t for t in CORE if t.lower() not in snap["cols"]]
        print(f"== {db}  (core missing: {core_missing or 'none'})")
        for name, (doc, tabs) in FEATURES.items():
            miss_t = [t for t in tabs if t.lower() not in snap["cols"]]
            miss_doc = doc is not None and doc not in snap["docs"]
            miss_c = {
                t: sorted(ref["cols"].get(t.lower(), set()) - snap["cols"].get(t.lower(), set()))
                for t in tabs
                if t.lower() in snap["cols"] and ref["cols"].get(t.lower(), set()) - snap["cols"][t.lower()]
            }
            if miss_t or miss_doc:
                state = "UNAVAILABLE"
                why = f"tables {miss_t}" if miss_t else f"DocID {doc} not in UtlTransactions"
            elif miss_c:
                state = "DEGRADED"
                why = "; ".join(f"{t}: -{','.join(v[:6])}{'...' if len(v) > 6 else ''}" for t, v in miss_c.items())
            else:
                state, why = "OK", ""
            print(f"   {name:<24} {state:<12} {why}")
        print()
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
