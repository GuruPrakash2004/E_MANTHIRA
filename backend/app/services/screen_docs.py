"""
Screen Documents — port of legacy frmUtlScreenDocs: reference files (manuals, forms, images) attached to a screen.

Rows live in UtlScreenDocs (FrmCaption, GrpName, FileName, Remarks, SlNo, AddedBy/On, ChangedBy/On). The legacy app
copied the file to <report path>\\ScreenDocs\\; the web app keeps them in backend/screen_docs/ (git-ignored), same
file name, so nothing in the schema changes.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

DOCS_DIR = Path(__file__).resolve().parents[2] / "screen_docs"
MAX_BYTES = 25 * 1024 * 1024


def safe_name(name: str) -> str:
    n = Path((name or "").replace("\\", "/")).name.strip()
    if not n or n in (".", ".."):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a file")
    return n


def file_path(name: str) -> Path:
    return DOCS_DIR / safe_name(name)


def screens(conn: Connection) -> list[dict]:
    """Every screen that can hold documents: the menu captions plus any caption already used in UtlScreenDocs."""
    counts = {r[0]: r[1] for r in conn.execute(text("SELECT FrmCaption, COUNT(*) FROM UtlScreenDocs GROUP BY FrmCaption"))}
    menu = [r[0] for r in conn.execute(text("SELECT DISTINCT MenuItemCaption FROM MstMenu WHERE MenuShow = 'Y' AND MenuItemCaption IS NOT NULL"))]
    names = sorted({*(c.strip() for c in menu if c and c.strip()), *counts.keys()}, key=str.lower)
    return [{"caption": n, "count": int(counts.get(n, 0))} for n in names]


def list_docs(conn: Connection, screen: str) -> list[dict]:
    rows = conn.execute(
        text("SELECT DocID, FrmCaption, GrpName, FileName, Remarks, SlNo FROM UtlScreenDocs WHERE FrmCaption = :c ORDER BY GrpName"),
        {"c": screen},
    ).mappings().all()
    return [
        {
            "doc_id": r["DocID"],
            "group": (r["GrpName"] or "").strip(),
            "file": (r["FileName"] or "").strip(),
            "remarks": (r["Remarks"] or "").strip(),
            "sl_no": i + 1,
            "available": file_path(r["FileName"] or "x").is_file(),
        }
        for i, r in enumerate(rows)
    ]


def add_doc(conn: Connection, *, screen: str, group: str, filename: str, remarks: str, data: bytes, user_code: str) -> int:
    name = safe_name(filename)
    if not screen.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose the screen first")
    if not group.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Group Name should not be blank")
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 25 MB")
    mx = conn.execute(text("SELECT MAX(SlNo) FROM UtlScreenDocs WHERE FrmCaption = :c"), {"c": screen}).scalar()
    from app.legacy.tables import insert_row

    new_id = insert_row(
        conn,
        "UtlScreenDocs",
        {"FrmCaption": screen.strip(), "GrpName": group.strip(), "FileName": name, "Remarks": remarks.strip(), "SlNo": int(mx or 0) + 1, "AddedBy": user_code, "AddedOn": datetime.now().replace(second=0, microsecond=0)},
        returning="DocID",
    )
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    file_path(name).write_bytes(data)
    return new_id


def update_remarks(conn: Connection, *, doc_id: int, remarks: str, user_code: str) -> None:
    res = conn.execute(
        text("UPDATE UtlScreenDocs SET Remarks = :r, ChangedBy = :u, ChangedOn = :t WHERE DocID = :i"),
        {"r": remarks.strip(), "u": user_code, "t": datetime.now().replace(second=0, microsecond=0), "i": doc_id},
    )
    if not res.rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")


def delete_doc(conn: Connection, doc_id: int) -> None:
    row = conn.execute(text("SELECT FileName FROM UtlScreenDocs WHERE DocID = :i"), {"i": doc_id}).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    conn.execute(text("DELETE FROM UtlScreenDocs WHERE DocID = :i"), {"i": doc_id})
    # the file goes only if no other row still points at it
    if not conn.execute(text("SELECT 1 FROM UtlScreenDocs WHERE FileName = :f"), {"f": row[0]}).first():
        try:
            file_path(row[0]).unlink()
        except OSError:
            pass


def get_file_name(conn: Connection, doc_id: int) -> str:
    row = conn.execute(text("SELECT FileName FROM UtlScreenDocs WHERE DocID = :i"), {"i": doc_id}).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return (row[0] or "").strip()
