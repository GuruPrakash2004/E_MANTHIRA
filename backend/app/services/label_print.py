"""
Label Printing — port of frmRptLblPrint (+ the template side of frmUtlLabelDesign).

A template (`UtlLabelPrint`) belongs to one document and holds up to 20 lines of text with `{COLUMN}` placeholders that
name columns of the document's header table. Printing a template fills one label per record. Offered from a document's
Options menu when its `UtlOption` list has a "Label Print" entry (the same rule as the legacy form).
"""
from __future__ import annotations

import re

from fastapi import HTTPException, status
from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
MAX_LINES = 20


def _bad(msg: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(code, msg)


def _doc(conn: Connection, doc_id: int) -> dict:
    r = conn.execute(text("SELECT DocID, DocName, DocType, DocShForm, HdrTblName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if r is None or not (r["HdrTblName"] or "").strip() or not _IDENT.match(r["HdrTblName"].strip()):
        raise _bad("Document not found!", status.HTTP_404_NOT_FOUND)
    return {"id": int(r["DocID"]), "name": (r["DocName"] or "").strip(), "type": (r["DocType"] or "").strip(), "short": (r["DocShForm"] or "").strip(), "table": r["HdrTblName"].strip()}


def columns(conn: Connection, doc_id: int) -> list[str]:
    d = _doc(conn, doc_id)
    return [r[0] for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t ORDER BY ORDINAL_POSITION"), {"t": d["table"]})]


def templates(conn: Connection, doc_id: int) -> list[dict]:
    d = _doc(conn, doc_id)
    rows = conn.execute(text("SELECT * FROM UtlLabelPrint WHERE DocName = :n ORDER BY TemplateName"), {"n": d["name"]}).mappings().all()
    out = []
    for r in rows:
        lines = [(r.get(f"FLDContent{i}") or "").rstrip() for i in range(1, MAX_LINES + 1)]
        while lines and not lines[-1]:
            lines.pop()
        out.append({"id": int(r["LblID"]), "name": (r["TemplateName"] or "").strip(), "lines": lines})
    return out


def save_template(conn: Connection, doc_id: int, template_id: int | None, name: str, lines: list[str]) -> int:
    d = _doc(conn, doc_id)
    name = (name or "").strip()
    if not name:
        raise _bad("Template Name should not be blank!!")
    clean = [str(x or "").replace("'", "`")[:250] for x in lines][:MAX_LINES]
    if not any(c.strip() for c in clean):
        raise _bad("Please enter the label fields.")
    cols = {c.lower() for c in columns(conn, doc_id)}
    for c in clean:
        for ph in _PLACEHOLDER.findall(c):
            if ph.lower() not in cols:
                raise _bad(f"'{{{ph}}}' is not a column of {d['table']}")
    dup = conn.execute(
        text("SELECT LblID FROM UtlLabelPrint WHERE DocName = :n AND TemplateName = :t AND (:i IS NULL OR LblID <> :i)"), {"n": d["name"], "t": name, "i": template_id}
    ).first()
    if dup:
        raise _bad("Template Name already exists..", status.HTTP_409_CONFLICT)
    clean += [""] * (MAX_LINES - len(clean))
    vals = {f"FLDContent{i + 1}": clean[i] for i in range(MAX_LINES)}
    if template_id is None:
        template_id = int(conn.execute(text("SELECT ISNULL(MAX(LblID), 0) + 1 FROM UtlLabelPrint")).scalar())
        cols_sql = ", ".join(["LblID", "DocID", "DocName", "TemplateName", *vals])
        params_sql = ", ".join([":i", ":d", ":n", ":t", *[f":{k}" for k in vals]])
        conn.execute(text(f"INSERT INTO UtlLabelPrint ({cols_sql}) VALUES ({params_sql})"), {"i": template_id, "d": doc_id, "n": d["name"], "t": name, **vals})
    else:
        sets = ", ".join(["TemplateName = :t", *[f"{k} = :{k}" for k in vals]])
        n = conn.execute(text(f"UPDATE UtlLabelPrint SET {sets} WHERE LblID = :i AND DocName = :n"), {"i": template_id, "n": d["name"], "t": name, **vals}).rowcount
        if not n:
            raise _bad("Template Not found in the list!!", status.HTTP_404_NOT_FOUND)
    return template_id


def delete_template(conn: Connection, doc_id: int, template_id: int) -> None:
    d = _doc(conn, doc_id)
    conn.execute(text("DELETE FROM UtlLabelPrint WHERE LblID = :i AND DocName = :n"), {"i": template_id, "n": d["name"]})


def labels(conn: Connection, doc_id: int, template_id: int, record_ids: list[int] | None = None, top: int = 500) -> list[str]:
    """One filled label (text with line breaks) per record. Masters: only real, active records, as in the EXE; newest first."""
    d = _doc(conn, doc_id)
    tpl = next((t for t in templates(conn, doc_id) if t["id"] == template_id), None)
    if tpl is None:
        raise _bad("Template Not found in the list!!", status.HTTP_404_NOT_FOUND)
    cols = {c.lower(): c for c in columns(conn, doc_id)}
    id_col = f"{d['short']}ID"
    sql = f"SELECT TOP {max(1, min(int(top), 5000))} * FROM {d['table']} WHERE 1 = 1"
    params: dict = {}
    if d["type"].upper() == "MASTER":
        if id_col.lower() in cols:
            sql += f" AND {cols[id_col.lower()]} > 0"
        if "inactive" in cols:
            sql += " AND InActive = 'N'"
    stmt_ids = None
    if record_ids:
        if id_col.lower() not in cols:
            raise _bad("This document cannot be limited to chosen records")
        sql += f" AND {cols[id_col.lower()]} IN :ids"
        stmt_ids = [int(x) for x in record_ids]
    sql += " ORDER BY 1 DESC"
    stmt = text(sql)
    if stmt_ids is not None:
        stmt = stmt.bindparams(bindparam("ids", expanding=True))
        params["ids"] = stmt_ids
    template = "\n".join(l for l in tpl["lines"] if l.strip())
    out = []
    for row in conn.execute(stmt, params).mappings().all():
        lookup = {k.lower(): v for k, v in row.items()}

        def fill(m: re.Match) -> str:
            v = lookup.get(m.group(1).lower())
            return "" if v is None else (v.strftime("%d/%m/%Y") if hasattr(v, "strftime") else str(v).strip())

        out.append(_PLACEHOLDER.sub(fill, template))
    return out


def documents(conn: Connection) -> list[dict]:
    """The Document combo of the legacy form: every document that has a header table."""
    rows = conn.execute(text("SELECT DocID, DocName FROM UtlTransactions WHERE HdrTblName IS NOT NULL AND HdrTblName <> '' ORDER BY DocName")).mappings().all()
    return [{"doc_id": int(r["DocID"]), "name": (r["DocName"] or "").strip()} for r in rows]
