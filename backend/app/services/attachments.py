"""
File attachments on masters — port of the legacy `UtlAttachFiles` panel
(present on any master where `UtlTransactions.FileAttachReq='Y'`: Ledger,
Ledger Group, Bank, Sannidhi, Gothra, Nakshatra, Rashi — 440 real rows in
this client's data, confirmed live). Files live on disk at `ATTACHMENTS_PATH`
(same folder the legacy EXE reads/writes — CLAUDE.md's `ATTACHMENTS_PATH`
setting); this table just tracks which file belongs to which master row
(`DocID`, `DocValueID` = the row's ID as text).

Filenames are stored with the same `<ticks>_<original name>` prefix the
legacy app uses (visible in the real data), so two different rows attaching
a same-named file never collide on disk.
"""
from __future__ import annotations

import re
import time
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings

_UNSAFE = re.compile(r"[^A-Za-z0-9_.\- ]")


def _attachments_dir() -> Path:
    d = Path(get_settings().attachments_path).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_attachments(conn: Connection, *, doc_id: int, doc_value_id: str) -> list[dict]:
    rows = conn.execute(
        text("SELECT AFileName, FileDesc, DocSlNo, AddedBy, AddedOn FROM UtlAttachFiles WHERE DocID = :d AND DocValueID = :v ORDER BY DocSlNo"),
        {"d": doc_id, "v": str(doc_value_id)},
    ).mappings().all()
    return [dict(r) for r in rows]


def save_attachment(
    conn: Connection, *, doc_id: int, doc_value_id: str, original_name: str, content: bytes, description: str, user_code: str
) -> str:
    safe_name = _UNSAFE.sub("_", original_name)
    stored_name = f"{int(time.time() * 1000)}_{safe_name}"
    (_attachments_dir() / stored_name).write_bytes(content)

    next_slno = conn.execute(
        text("SELECT COALESCE(MAX(DocSlNo), 0) + 1 FROM UtlAttachFiles WHERE DocID = :d AND DocValueID = :v"),
        {"d": doc_id, "v": str(doc_value_id)},
    ).scalar()
    conn.execute(
        text(
            "INSERT INTO UtlAttachFiles (DocID, DocValueID, AFileName, FileDesc, DocSlNo, AddedBy, AddedOn) "
            "VALUES (:d, :v, :f, :desc, :slno, :u, GETDATE())"
        ),
        {"d": doc_id, "v": str(doc_value_id), "f": stored_name, "desc": description, "slno": next_slno, "u": user_code},
    )
    return stored_name


def get_attachment_path(conn: Connection, *, doc_id: int, doc_value_id: str, file_name: str) -> Path:
    exists = conn.execute(
        text("SELECT 1 FROM UtlAttachFiles WHERE DocID = :d AND DocValueID = :v AND AFileName = :f"),
        {"d": doc_id, "v": str(doc_value_id), "f": file_name},
    ).first()
    if not exists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    path = _attachments_dir() / file_name
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing from attachments folder")
    return path


def delete_attachment(conn: Connection, *, doc_id: int, doc_value_id: str, file_name: str) -> None:
    result = conn.execute(
        text("DELETE FROM UtlAttachFiles WHERE DocID = :d AND DocValueID = :v AND AFileName = :f"),
        {"d": doc_id, "v": str(doc_value_id), "f": file_name},
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")
    path = _attachments_dir() / file_name
    if path.exists():
        path.unlink()
