"""
Outgoing mail for the web app, configured from the same `UtlGSettings` rows the legacy EXE reads, so both apps use one
set of SMTP details:

    SMTP     / SMTPHostName, SMTPMailID, SMTPMailPWD, SMTPServerPort
    COMPANY  / EnableSSL, EnableTLS                       (Y / N)
    Company  / EmailAuthorised (Y = approval mails on), EmailAuthorisedUrl (link target of the approval mail)

The credentials are shown and edited only through the ADMIN-only endpoints in app/api/v1/mail_settings.py.
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import legacy_crypto

# field -> (SetGroup, SetName, caption used when the row has to be created)
FIELDS: dict[str, tuple[str, str, str]] = {
    "host": ("SMTP", "SMTPHostName", "SMTP Host Name"),
    "port": ("SMTP", "SMTPServerPort", "SMTP Server Port"),
    "mail_id": ("SMTP", "SMTPMailID", "SMTP Mail ID"),
    "password": ("SMTP", "SMTPMailPWD", "SMTP Mail Password"),
    "enable_ssl": ("COMPANY", "EnableSSL", "Enable SSL"),
    "enable_tls": ("COMPANY", "EnableTLS", "Enable TLS"),
    "approval_mail": ("Company", "EmailAuthorised", "Send e-Mail for approval"),
    "approval_url": ("Company", "EmailAuthorisedUrl", "Approval link URL"),
}
APPROVAL_TOKEN_KEY = "SvtEMail123"  # the passkey the legacy approval link is encrypted with


def _get(conn: Connection, group: str, name: str) -> str:
    v = conn.execute(
        text("SELECT TOP 1 SetValue FROM UtlGSettings WHERE UPPER(SetGroup) = UPPER(:g) AND UPPER(SetName) = UPPER(:n)"), {"g": group, "n": name}
    ).scalar()
    return (v or "").strip()


def _put(conn: Connection, group: str, name: str, caption: str, value: str) -> None:
    updated = conn.execute(
        text("UPDATE UtlGSettings SET SetValue = :v WHERE UPPER(SetGroup) = UPPER(:g) AND UPPER(SetName) = UPPER(:n)"), {"v": value, "g": group, "n": name}
    ).rowcount
    if not updated:
        conn.execute(
            text("INSERT INTO UtlGSettings (SetGroup, SetName, SetValue, SetCaption) VALUES (:g, :n, :v, :c)"),
            {"g": group, "n": name, "v": value, "c": caption},
        )


def get_settings(conn: Connection) -> dict:
    """Every field, password included — callers must be ADMIN-only."""
    return {k: _get(conn, g, n) for k, (g, n, _c) in FIELDS.items()}


def save_settings(conn: Connection, values: dict) -> None:
    for key, (g, n, caption) in FIELDS.items():
        if key in values and values[key] is not None:
            v = str(values[key]).strip()
            if key in ("enable_ssl", "enable_tls", "approval_mail"):
                v = "Y" if v.upper() in ("Y", "TRUE", "1") else "N"
            _put(conn, g, n, caption, v)


def approval_mail_enabled(conn: Connection) -> bool:
    return _get(conn, *FIELDS["approval_mail"][:2]).upper() == "Y"


def send_mail(conn: Connection, to: list[str], subject: str, body: str, attachment: tuple[str, bytes] | None = None, cc: list[str] | None = None) -> None:
    cfg = get_settings(conn)
    if not (cfg["host"] and cfg["mail_id"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email (SMTP) is not configured. Ask the administrator to fill in the SMTP details.")
    msg = EmailMessage()
    msg["From"] = cfg["mail_id"]
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg.set_content(body)
    if attachment:
        ext = attachment[0].rsplit(".", 1)[-1].lower()
        subtype = {"xlsx": "vnd.openxmlformats-officedocument.spreadsheetml.sheet", "csv": "csv"}.get(ext, "pdf")
        msg.add_attachment(attachment[1], maintype="text" if ext == "csv" else "application", subtype=subtype, filename=attachment[0])
    port = int(cfg["port"] or 587)
    try:
        if cfg["enable_ssl"].upper() == "Y" and port == 465:
            server = smtplib.SMTP_SSL(cfg["host"], port, timeout=20, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(cfg["host"], port, timeout=20)
            server.ehlo()
            if cfg["enable_tls"].upper() == "Y" or cfg["enable_ssl"].upper() == "Y" or port == 587:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
        with server:
            if cfg["password"]:
                server.login(cfg["mail_id"], cfg["password"])
            server.send_message(msg, to_addrs=list(to) + list(cc or []))
    except (smtplib.SMTPException, OSError) as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Error in Sending Mail! {exc}") from exc


def approval_link(conn: Connection, doc_id: int, row_id: int, approver_id: int, sender_id: int) -> str:
    """Same token the legacy form builds (docId|id|approver|sender, 3DES, URL-encoded) appended to EmailAuthorisedUrl."""
    base = _get(conn, *FIELDS["approval_url"][:2])
    if not base:
        return ""
    token = legacy_crypto.encrypt(f"{doc_id}|{row_id}|{approver_id}|{sender_id}", APPROVAL_TOKEN_KEY)
    return base + quote(token, safe="")
