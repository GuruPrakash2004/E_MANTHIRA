"""
Doc Designer audit: for every SQL Server database whose name starts with `vTemple` (or the names given on the command
line) list the `UtlDocDsgrFlds` rules that are ACTIVE (non-default) but that this app does not follow yet, Designer
fields that do not match a column of their document's table, and Designer documents that have no screen.

    cd backend && .venv/Scripts/python.exe tools/designer_audit.py [DbName ...]

Exit code 1 when anything unsupported is active, so it can gate a release. Read-only (SELECTs only).
When a column becomes supported, move it from UNSUPPORTED to SUPPORTED below.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.core.config import get_settings  # noqa: E402

# Columns the app reads (see frontend DocFieldsForm / DocDetailGrid / DynamicField / docFieldConditions / docCompute and
# backend app/meta/doc_rules.py, lookups.py). Listed for documentation; only UNSUPPORTED is checked.
SUPPORTED = """DocID FldID FldSection FldCode FldCaption FldDataType FldDataWidth FldBlnReadOnly FLdBlnHide FldBlnMandatory
FldUseDefault FldDefStdDefault FldBlnComboData FldCmbTblName FldCmbStorageFldName FldCmbDisplayCols FldCmbAddnlCond
FldNumStringListContent FldBlnNumOrStringList FldHideCompareVal FldHideOperator FldHideWithVal FldMndtryCompareVal
FldMndtryOperator FldMndtryWithVal FldPickUP FldPickUPAfterFld FldFormula FldBlnRefill FldOrderBy FldNumDecimals
FldTxtBlnMultiLine FldTxtStringType FldTxtCase FldTxtBlnDoNotAllowChk FldTxtDoNotAllowChars FldTxtAlignment FldToolTip
FldNumBlnAllowNegative FldNumBlnRange FldNumBlnRangeFromChk FldNumRangeFromOperator FldNumRangeFromValue
FldNumBlnRangeToChk FldNumRangeToOperator FldNumRangeToValue FldDtBlnRange FldDtBlnRangeFrom FldDtRangeFromValue
FldDtBlnRangeTo FldDtRangeToValue FldBlnFontBold FldRowClrFontBold FldBlnRowClr FldRowClrForeColour FldDtBlnWithinFinYear FldDtBlnFirstDOM FldDtBlnLastDOM FldBlnChkDuplicate""".split()

# column -> description. A row is "active" when the column holds anything other than '', 'N', NULL or 0.
UNSUPPORTED = {
    "FldUnique": "unique value check",
    "FldTxtBlnMask": "input mask",
    "BlnTogHide": "toggle-hide",
    "FldCmbBlnCellBtn": "cell button on a lookup",
    "FldBlnBlockEdit": "block edit",
    "FldDefBlnAgnstCond": "conditional default",
    "FldROCompareVal": "conditional read-only",
    "FldBlnNewTrnCalc": "recalculate on new transaction",
    "FldBlnLoadFrom": "load from another document",
    "BlnLoadColFrom": "load column from",
    "LoadPrevTrnData": "load previous transaction data",
    "BlnCopyPreviousRowData": "copy previous row",
    "FldChkDocDate": "check against document date",
    "MultiAmtFld": "multi amount field",
    "BlnTotalReq": "column total",
    "BlnApportinate": "apportion",
}

# DocIDs that have a dedicated screen in the app (frontend/src/App.jsx) — everything with a short form in
# UtlTransactions (DocShForm) is served by the generic Master screen.
SCREENS = {1224, 1248, 1250, 1252, 1253, 1254, 1260, 1261, 1262, 1263, 1264, 1268, 1270, 1271, 1272, 1280, 1281, 17, 18}


def active(v) -> bool:
    return v is not None and str(v).strip() not in ("", "N", "0", "0.00")


def audit(db: str) -> int:
    s = get_settings().model_copy(update={"db_name": db})
    e = create_engine(s._pyodbc_url)
    problems = 0
    with e.connect() as c:
        print(f"===== {db}")
        have = {r[0] for r in c.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'UtlDocDsgrFlds'"))}
        extra = sorted(have - set(SUPPORTED) - set(UNSUPPORTED))
        for col, why in UNSUPPORTED.items():
            if col not in have:
                continue
            rows = c.execute(
                text(f"SELECT DocID, FldCode FROM UtlDocDsgrFlds WHERE {col} IS NOT NULL AND LTRIM(RTRIM(CAST({col} AS NVARCHAR(MAX)))) NOT IN ('', 'N', '0', '0.00')")
            ).fetchall()
            if rows:
                problems += 1
                print(f"  UNSUPPORTED {col} ({why}): {len(rows)} rows, e.g. " + ", ".join(f"{r[0]}/{str(r[1]).strip()}" for r in rows[:6]))
        # Designer fields without a matching column
        for r in c.execute(text("""
            SELECT f.DocID, f.FldSection, f.FldCode FROM UtlDocDsgrFlds f JOIN UtlTransactions t ON t.DocID = f.DocID
            WHERE f.FldCode <> '' AND ((f.FldSection IN ('Header','Footer','Total') AND t.HdrTblName <> '' AND NOT EXISTS
                  (SELECT 1 FROM information_schema.columns k WHERE k.table_name = t.HdrTblName AND k.column_name = f.FldCode))
               OR (f.FldSection = 'Detail' AND t.DtlTblName <> '' AND NOT EXISTS
                  (SELECT 1 FROM information_schema.columns k WHERE k.table_name = t.DtlTblName AND k.column_name = f.FldCode)))
            ORDER BY f.DocID, f.FldCode""")):
            print(f"  note: Designer field {r[0]}/{r[1]}/{str(r[2]).strip()} is not a column of its table (written only through an alias, or computed)")
        # Designer documents with no screen
        for r in c.execute(text("""
            SELECT DISTINCT f.DocID, t.DocName, t.DocShForm FROM UtlDocDsgrFlds f LEFT JOIN UtlTransactions t ON t.DocID = f.DocID
            ORDER BY f.DocID""")):
            doc, name, short = r[0], (r[1] or "").strip(), (r[2] or "").strip()
            if doc in SCREENS or short:
                continue
            print(f"  note: DocID {doc} {name or '(no UtlTransactions row)'} has Designer rows but no screen")
        if extra:
            print("  note: columns not classified in this tool: " + ", ".join(extra))
    return problems


def main() -> int:
    base = get_settings().model_copy(update={"db_name": "master"})
    names = sys.argv[1:]
    if not names:
        with create_engine(base._pyodbc_url).connect() as c:
            names = [r[0] for r in c.execute(text("SELECT name FROM sys.databases WHERE name LIKE 'vTemple%' ORDER BY name"))]
    total = sum(audit(n) for n in names)
    print(f"\n{'OK: every active Designer rule is supported' if not total else f'{total} unsupported rule type(s) active'}")
    return 1 if total else 0


if __name__ == "__main__":
    raise SystemExit(main())
