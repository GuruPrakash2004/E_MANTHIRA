"""
Write app/core/schema_manifest.json: every column of every Mst*/Trn*/Utl* table of the reference temple database (read-only).

The backend uses it at start-up (core/web_schema.py) to ADD columns an older client database lacks. Run it against the
reference DB (vTmplSLV) whenever the web app starts to use a new column:

    cd backend && .venv/Scripts/python.exe tools/make_schema_manifest.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.core.db import get_engine  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "app" / "core" / "schema_manifest.json"

SQL = """
SELECT t.name AS tbl, c.name AS col, ty.name AS typ, c.max_length, c.precision, c.scale, c.is_identity, c.is_computed,
       dc.definition AS dflt
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE (t.name LIKE 'Mst%' OR t.name LIKE 'Trn%' OR t.name LIKE 'Utl%')
ORDER BY t.name, c.column_id
"""


def sql_type(typ: str, ml: int, prec: int, scale: int) -> str | None:
    if typ in ("varchar", "char", "varbinary", "binary"):
        return f"{typ}({'max' if ml == -1 else ml})"
    if typ in ("nvarchar", "nchar"):
        return f"{typ}({'max' if ml == -1 else ml // 2})"
    if typ in ("decimal", "numeric"):
        return f"{typ}({prec},{scale})"
    if typ in ("datetime2", "time", "datetimeoffset"):
        return f"{typ}({scale})"
    if typ in ("timestamp", "rowversion", "sysname", "hierarchyid", "geography", "geometry", "xml", "sql_variant"):
        return None
    return typ


def main() -> None:
    manifest: dict[str, list[dict]] = {}
    with get_engine().connect() as c:
        for r in c.execute(text(SQL)).mappings():
            if r["is_identity"] or r["is_computed"]:
                continue  # never added automatically: it would change how rows are numbered / computed
            typ = sql_type(r["typ"], r["max_length"], r["precision"], r["scale"])
            if typ is None:
                continue
            manifest.setdefault(r["tbl"], []).append({"name": r["col"], "type": typ, "default": r["dflt"]})
    OUT.write_text(json.dumps(manifest, indent=0, separators=(",", ":")), encoding="utf-8")
    print(f"{len(manifest)} tables, {sum(len(v) for v in manifest.values())} columns -> {OUT}")


if __name__ == "__main__":
    main()
