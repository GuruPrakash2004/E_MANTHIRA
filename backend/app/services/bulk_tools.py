"""
Bulk Update (frmUtlBulkUpdate) and Bulk Update for item HSN (frmUtlBulkUpdateForHSN), ported from the decompiled EXE.

The EXE shows up to 1000 rows of any table, lets the user pick a field, and then
  * "Complete field updation": every shown row whose field equals the chosen current value gets the replacement value,
  * "Partial field updation": in every shown row the text `partial` inside the field is replaced by `replace`,
  * Delete: removes the shown rows after `UtlDeletion` says nothing still refers to them,
all in one transaction. This port keeps those three operations and adds protections the EXE lacked:
  * table and column names are validated against the database's own catalogue and used as identifiers only; every value is a
    bound parameter; the key list is bound too;
  * only WRITABLE columns can be changed: not the key, identity, computed (rule 3), timestamp / binary, or secret-looking columns;
  * the books (`TrnHdrAcc`, `TrnDtlAcc`, `TrnDtlAccAdj`) are never edited here, and documents (`Trn*` tables) are never deleted here:
    each document has its own screen that also reverses its ledger postings;
  * every run is one transaction and writes a `WebAuditLog` entry.
The HSN upload reads an .xlsx with ItemCode and HSNCode columns and sets `MstItem.HSNCode` for the codes it finds.
"""
from __future__ import annotations

import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.legacy.tables import computed_columns_for

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PROTECTED_EDIT = {"trnhdracc", "trndtlacc", "trndtlaccadj"}
SECRET = re.compile(r"(pwd|passw|secret|token)", re.I)
MAX_ROWS = 1000
CHUNK = 500
_TEXT = {"char", "varchar", "nchar", "nvarchar", "text", "ntext"}
_NUM = {"int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money", "smallmoney"}
_DATE = {"date", "datetime", "smalldatetime", "datetime2"}


def _422(msg: str):
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)


def _table(conn: Connection, name: str) -> str:
    """The table's real name, or a 404; only plain identifiers are ever used in SQL."""
    real = conn.execute(text("SELECT name FROM sys.tables WHERE name = :n"), {"n": name}).scalar()
    if real is None or not _IDENT.match(real):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Please select a table from the drop down!")
    return real


def tables(conn: Connection) -> list[dict]:
    return [
        {"name": r[0], "editable": r[0].lower() not in PROTECTED_EDIT, "deletable": r[0].lower() not in PROTECTED_EDIT and not r[0].lower().startswith("trn")}
        for r in conn.execute(text("SELECT name FROM sys.tables ORDER BY name"))
    ]


def describe(conn: Connection, table: str) -> dict:
    t = _table(conn, table)
    cols = conn.execute(
        text(
            "SELECT c.column_name, c.data_type, c.character_maximum_length, "
            "COLUMNPROPERTY(OBJECT_ID(:t), c.column_name, 'IsIdentity') AS Ident, COLUMNPROPERTY(OBJECT_ID(:t), c.column_name, 'IsComputed') AS Comp "
            "FROM information_schema.columns c WHERE c.table_name = :t ORDER BY c.ordinal_position"
        ),
        {"t": t},
    ).all()
    pk = [r[0] for r in conn.execute(text(
        "SELECT col.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id "
        "JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(:t)"), {"t": t})]
    key = pk[0] if len(pk) == 1 else cols[0][0]  # like the EXE: the first column identifies a row when there is no single-column key
    computed = {c.lower() for c in computed_columns_for(t)}
    out = []
    for name, typ, ln, ident, comp in cols:
        editable = (
            t.lower() not in PROTECTED_EDIT and name != key and not ident and not comp and name.lower() not in computed
            and typ.lower() not in ("timestamp", "binary", "varbinary", "image", "xml", "uniqueidentifier") and not SECRET.search(name)
        )
        out.append({"name": name, "type": typ.lower(), "length": ln if ln and ln > 0 else None, "editable": bool(editable)})
    return {"table": t, "key": key, "columns": out, "editable_table": t.lower() not in PROTECTED_EDIT, "deletable_table": t.lower() not in PROTECTED_EDIT and not t.lower().startswith("trn")}


def _json(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"<{len(bytes(v))} bytes>"
    return v


def rows(conn: Connection, table: str, filters: dict[str, str], top: int = MAX_ROWS) -> dict:
    d = describe(conn, table)
    real = {c["name"].lower(): c for c in d["columns"]}
    where, params = [], {}
    for i, (col, val) in enumerate((filters or {}).items()):
        c = real.get(col.lower())
        if c is None or not (val or "").strip():
            continue
        params[f"f{i}"] = f"%{val.strip()}%"
        where.append(f"CAST([{c['name']}] AS nvarchar(4000)) LIKE :f{i}")
    sql_where = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(text(f"SELECT COUNT(*) FROM [{d['table']}]{sql_where}"), params).scalar()
    cols = [c["name"] for c in d["columns"]]
    shown = conn.execute(text(f"SELECT TOP {int(min(top, MAX_ROWS))} * FROM [{d['table']}]{sql_where} ORDER BY [{d['key']}]"), params).mappings().all()
    secret = {c["name"] for c in d["columns"] if SECRET.search(c["name"])}
    data = [{k: ("********" if k in secret and r[k] not in (None, "") else _json(r[k])) for k in cols} for r in shown]
    return {**d, "total": int(total), "shown": len(data), "rows": data}


def _typed(value, column: dict, what: str):
    """A value for the column's type (the EXE converted numbers with Val and dates through the date picker)."""
    t = column["type"]
    if t in _NUM:
        try:
            return Decimal(str(value).strip().replace(",", "") or "0")
        except InvalidOperation:
            raise _422(f"{what} must be a number")
    if t in _DATE:
        s = str(value).strip()
        if not s:
            return None
        try:
            return datetime.fromisoformat(s[:19].replace("/", "-")).date() if len(s) <= 10 else datetime.fromisoformat(s[:19])
        except ValueError:
            raise _422(f"{what} must be a date (YYYY-MM-DD)")
    if t == "bit":
        return 1 if str(value).strip().lower() in ("1", "y", "yes", "true") else 0
    s = str(value)
    if column["length"] and len(s) > column["length"]:
        raise _422(f"Lenght Of replace value should Not be more than {column['length']}")
    return s


def _like(s: str) -> str:
    return "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace("[", "\\[") + "%"


def update(conn: Connection, *, table: str, keys: list, field: str, mode: str, current: str | None, partial: str, replace: str, user_code: str) -> dict:
    d = describe(conn, table)
    if not d["editable_table"]:
        raise _422(f"{d['table']} is part of the books and is changed only through the documents that post to it")
    col = next((c for c in d["columns"] if c["name"].lower() == (field or "").strip().lower()), None)
    if col is None or not col["editable"]:
        raise _422("That field cannot be updated here")
    if not keys:
        raise _422("There are no rows to update")
    if len(keys) > MAX_ROWS:
        raise _422(f"Update at most {MAX_ROWS} rows at a time")
    if mode not in ("complete", "partial"):
        raise _422("Choose Complete or Partial field updation")
    key = f"[{d['key']}]"
    f = f"[{col['name']}]"
    updated = 0
    if mode == "partial":
        if col["type"] not in _TEXT:
            raise _422("Partial updation is for text fields")
        if not (partial or ""):
            raise _422("Enter the text to replace")
        if col["length"] and len(replace or "") > col["length"]:
            raise _422(f"Lenght Of replace value should Not be more than {col['length']}")
        for i in range(0, len(keys), CHUNK):
            part = keys[i : i + CHUNK]
            params = {f"k{j}": v for j, v in enumerate(part)}
            params.update({"p": partial, "r": replace or "", "like": _like(partial)})
            names = ", ".join(f":k{j}" for j in range(len(part)))
            updated += conn.execute(text(f"UPDATE [{d['table']}] SET {f} = REPLACE({f}, :p, :r) WHERE {key} IN ({names}) AND {f} LIKE :like ESCAPE '\\'"), params).rowcount
    else:
        new = _typed(replace if replace is not None else "", col, "The replace value")
        for i in range(0, len(keys), CHUNK):
            part = keys[i : i + CHUNK]
            params = {f"k{j}": v for j, v in enumerate(part)}
            params["new"] = new
            names = ", ".join(f":k{j}" for j in range(len(part)))
            cond = ""
            if current is not None:
                if col["type"] in _DATE and not str(current).strip():
                    cond = f" AND {f} IS NULL"
                elif col["type"] in _TEXT and not str(current):
                    cond = f" AND ({f} IS NULL OR {f} = '')"
                else:
                    params["cur"] = _typed(current, col, "The current value")
                    cond = f" AND {f} = :cur"
            updated += conn.execute(text(f"UPDATE [{d['table']}] SET {f} = :new WHERE {key} IN ({names}){cond}"), params).rowcount
    audit.record(conn, entity="Bulk Update", entity_id=d["table"], action="E", user_code=user_code, details=f"{col['name']} {mode}: {updated} of {len(keys)} rows")
    return {"updated": int(updated)}


def delete(conn: Connection, *, table: str, keys: list, user_code: str) -> dict:
    d = describe(conn, table)
    if not d["deletable_table"]:
        raise _422(f"Rows of {d['table']} are not deleted here: documents and the books are deleted on their own screens, which also reverse their ledger postings")
    if not keys:
        raise _422("There are no rows to delete")
    if len(keys) > MAX_ROWS:
        raise _422(f"Delete at most {MAX_ROWS} rows at a time")
    # UtlDeletion lists the tables / fields that may still refer to a row of this table (svtModule.blnDeleteOK)
    refs = conn.execute(text("SELECT TblName, FldName, DispFldName, TblCaption FROM UtlDeletion WHERE UPPER(DelTblName) = UPPER(:t)"), {"t": d["table"]}).mappings().all()
    for r in refs:
        tbl, fld = (r["TblName"] or "").strip(), (r["FldName"] or "").strip()
        if not (_IDENT.match(tbl) and _IDENT.match(fld)) or tbl.upper() == d["table"].upper():
            continue
        for k in keys:
            if conn.execute(text(f"SELECT TOP 1 1 FROM [{tbl}] WHERE [{fld}] = :v"), {"v": k}).first():
                raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot Delete!!! Data : {(r['DispFldName'] or fld).strip()} of {d['table']} exists in {(r['TblCaption'] or tbl).strip()}")
    deleted = 0
    for i in range(0, len(keys), CHUNK):
        part = keys[i : i + CHUNK]
        names = ", ".join(f":k{j}" for j in range(len(part)))
        deleted += conn.execute(text(f"DELETE FROM [{d['table']}] WHERE [{d['key']}] IN ({names})"), {f"k{j}": v for j, v in enumerate(part)}).rowcount
    audit.record(conn, entity="Bulk Update", entity_id=d["table"], action="D", user_code=user_code, details=f"{deleted} rows deleted")
    return {"deleted": int(deleted)}


# ---------------------------------------------------------------- item HSN upload (frmUtlBulkUpdateForHSN)

HSN_NEEDS = ("itemcode", "hsncode")


def hsn_missing(conn: Connection) -> list[str]:
    cols = {r[0].lower() for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'MstItem'"))}
    return [] if set(HSN_NEEDS) <= cols else ["MstItem (ItemCode, HSNCode)"]


def hsn_template() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["ItemCode", "HSNCode"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _read_hsn(file_bytes: bytes) -> list[tuple[int, str, str]]:
    from openpyxl import load_workbook

    try:
        ws = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True).active
    except Exception:  # noqa: BLE001
        raise _422("Please select a valid file for importing")
    it = ws.iter_rows(values_only=True)
    head = [str(c or "").strip().upper() for c in next(it, [])]
    if head[:2] != ["ITEMCODE", "HSNCODE"]:
        raise _422("Please select the valid template")
    out = []
    for n, r in enumerate(it, start=2):
        code, hsn = (str(r[0]).strip() if r and r[0] is not None else ""), (str(r[1]).strip() if r and len(r) > 1 and r[1] is not None else "")
        if code or hsn:
            out.append((n, code, hsn))
    if len(out) > 5000:
        raise _422("Upload at most 5000 rows at a time")
    return out


def hsn_preview(conn: Connection, file_bytes: bytes) -> dict:
    miss = hsn_missing(conn)
    if miss:
        return {"available": False, "missing": miss}
    parsed = _read_hsn(file_bytes)
    ln = conn.execute(text("SELECT character_maximum_length FROM information_schema.columns WHERE table_name = 'MstItem' AND column_name = 'HSNCode'")).scalar()
    have = {(r[0] or "").strip().upper(): (r[1] or "").strip() for r in conn.execute(text("SELECT ItemCode, HSNCode FROM MstItem WHERE ItemID > 0"))}
    rows = []
    for n, code, hsn in parsed:
        cur = have.get(code.upper())
        problem = "Item code not found" if cur is None and code else "HSN code is empty" if not hsn else f"HSN code is longer than {ln}" if ln and ln > 0 and len(hsn) > ln else "Item code is empty" if not code else ""
        rows.append({"row": n, "item_code": code, "hsn": hsn, "current_hsn": cur or "", "ok": not problem, "problem": problem})
    return {"available": True, "rows": rows, "ok": sum(1 for r in rows if r["ok"]), "skipped": sum(1 for r in rows if not r["ok"])}


def hsn_apply(conn: Connection, file_bytes: bytes, user_code: str) -> dict:
    prev = hsn_preview(conn, file_bytes)
    if not prev["available"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This database has no {', '.join(prev['missing'])}")
    updated = 0
    for r in prev["rows"]:
        if r["ok"]:
            updated += conn.execute(text("UPDATE MstItem SET HSNCode = :h WHERE ItemCode = :c"), {"h": r["hsn"], "c": r["item_code"]}).rowcount
    audit.record(conn, entity="Bulk Update", entity_id="MstItem.HSNCode", action="E", user_code=user_code, details=f"{updated} items, {prev['skipped']} skipped")
    return {"updated": int(updated), "skipped": prev["skipped"]}
