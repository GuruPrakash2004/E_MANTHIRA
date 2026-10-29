"""
Shared Documents — port of legacy frmUtlSharedDocuments: files shared with every user, grouped by a free-text group.

Rows live in UtlSharedDocs (DocID identity, GroupName, DocFileName, Remarks); the legacy app copied the file to
<report path>\\SharedDocs\\, the web app keeps them in backend/shared_docs/ (git-ignored) under the same file name.
Rules copied from the form: group and file are mandatory, a file name can be shared only once, edit changes the
group and remarks only, removing a row also deletes the file.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.services.screen_docs import MAX_BYTES, safe_name

DOCS_DIR = Path(__file__).resolve().parents[2] / "shared_docs"


def file_path(name: str) -> Path:
    return DOCS_DIR / safe_name(name)


def groups(conn: Connection) -> list[str]:
    rows = conn.execute(text("SELECT DISTINCT GroupName FROM UtlSharedDocs WHERE GroupName IS NOT NULL ORDER BY GroupName"))
    return [r[0].strip() for r in rows if r[0] and r[0].strip()]


def list_docs(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT DocID, GroupName, DocFileName, Remarks FROM UtlSharedDocs ORDER BY GroupName, DocID")).mappings().all()
    return [
        {
            "doc_id": r["DocID"],
            "group": (r["GroupName"] or "").strip(),
            "file": (r["DocFileName"] or "").strip(),
            "remarks": (r["Remarks"] or "").strip(),
            "sl_no": i + 1,
            "available": file_path(r["DocFileName"] or "x").is_file(),
        }
        for i, r in enumerate(rows)
    ]


def add_doc(conn: Connection, *, group: str, filename: str, remarks: str, data: bytes) -> int:
    name = safe_name(filename)
    if not group.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Group name cannot be empty!")
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The file is larger than 25 MB")
    if conn.execute(text("SELECT 1 FROM UtlSharedDocs WHERE DocFileName = :f"), {"f": name}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Document already exists!")
    from app.legacy.tables import insert_row

    new_id = insert_row(conn, "UtlSharedDocs", {"GroupName": group.strip(), "DocFileName": name, "Remarks": remarks.strip()}, returning="DocID")
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    file_path(name).write_bytes(data)
    return new_id


def update_doc(conn: Connection, *, doc_id: int, group: str, remarks: str) -> None:
    if not group.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Group name cannot be empty!")
    res = conn.execute(
        text("UPDATE UtlSharedDocs SET GroupName = :g, Remarks = :r WHERE DocID = :i"),
        {"g": group.strip(), "r": remarks.strip(), "i": doc_id},
    )
    if not res.rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")


def delete_doc(conn: Connection, doc_id: int) -> None:
    name = get_file_name(conn, doc_id)
    conn.execute(text("DELETE FROM UtlSharedDocs WHERE DocID = :i"), {"i": doc_id})
    try:
        file_path(name).unlink()
    except OSError:
        pass


def get_file_name(conn: Connection, doc_id: int) -> str:
    row = conn.execute(text("SELECT DocFileName FROM UtlSharedDocs WHERE DocID = :i"), {"i": doc_id}).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return (row[0] or "").strip()
