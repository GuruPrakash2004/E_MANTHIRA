"""
Reminder Alert / Notifications — port of legacy frmUtlNotification: short messages between users.

Rows live in UtlNotify (ID identity, FromUserCode, Title, NotifText, status, ToUserCode); one row per recipient,
status 'N' on send (the form never changes it, the main window counts status='N' rows as unread).
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.security import CurrentUser


def list_notes(conn: Connection, user: CurrentUser, *, sent: bool) -> list[dict]:
    col = "FromUserCode" if sent else "ToUserCode"
    rows = conn.execute(
        text(f"SELECT ID, FromUserCode, Title, NotifText, status, ToUserCode FROM UtlNotify WHERE {col} = :u ORDER BY Title, ID DESC"),
        {"u": user.user_code},
    ).mappings().all()
    return [
        {
            "id": r["ID"],
            "from": (r["FromUserCode"] or "").strip(),
            "to": (r["ToUserCode"] or "").strip(),
            "title": (r["Title"] or "").strip(),
            "notification": (r["NotifText"] or "").strip(),
            "status": (r["status"] or "").strip(),
        }
        for r in rows
    ]


def unread_count(conn: Connection, user: CurrentUser) -> int:
    return int(conn.execute(text("SELECT COUNT(*) FROM UtlNotify WHERE status = 'N' AND ToUserCode = :u"), {"u": user.user_code}).scalar() or 0)


def search_users(conn: Connection, user: CurrentUser, q: str) -> list[dict]:
    rows = conn.execute(
        text("SELECT TOP 30 UserCode, UserName FROM MstUser WHERE UserCode LIKE :q AND UserID <> :me ORDER BY 1"),
        {"q": f"%{q.strip()}%", "me": user.user_id},
    ).all()
    return [{"code": (r[0] or "").strip(), "name": (r[1] or "").strip()} for r in rows]


def send(conn: Connection, user: CurrentUser, *, title: str, note: str, to: list[str]) -> int:
    title, note = title.strip(), " ".join(note.replace("\r\n", "\n").split("\n")).strip()
    if not title:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter title.")
    if not note:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter Note.")
    recipients = list(dict.fromkeys(c.strip() for c in to if c and c.strip()))
    if not recipients:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Atleast one user has to be selected.")
    known = {r[0].strip() for r in conn.execute(text("SELECT UserCode FROM MstUser WHERE UserID <> :me"), {"me": user.user_id}) if r[0]}
    bad = [c for c in recipients if c not in known]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown user: {', '.join(bad)}")
    for code in recipients:
        conn.execute(
            text("INSERT INTO UtlNotify (ToUserCode, Title, NotifText, status, FromUserCode) VALUES (:t, :ti, :n, 'N', :f)"),
            {"t": code, "ti": title[:50], "n": note[:250], "f": user.user_code},
        )
    return len(recipients)


def delete_one(conn: Connection, user: CurrentUser, note_id: int) -> None:
    res = conn.execute(
        text("DELETE FROM UtlNotify WHERE ID = :i AND (FromUserCode = :u OR ToUserCode = :u)"),
        {"i": note_id, "u": user.user_code},
    )
    if not res.rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")


def delete_all_sent(conn: Connection, user: CurrentUser) -> int:
    return conn.execute(text("DELETE FROM UtlNotify WHERE FromUserCode = :u"), {"u": user.user_code}).rowcount
