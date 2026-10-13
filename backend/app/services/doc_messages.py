"""
Per-document "Options" that vary by client, ported from the legacy transaction forms (frmTrnSeva / frmTrnDONREC /
frmTrnHBE ... `svtBtnCtrl.addOption`). Which ones a document offers is data: flags on `UtlTransactions`
(FldEmail -> Send EMAIL, FldSMS -> Send SMS, blnEnvPrint -> Envelope Print, MultiDocGen -> Multi Doc Gen, AllowImpExp ->
Export / Import Data), so a different client's database yields a different menu with no code change.

Send EMAIL / Send SMS fill their templates (`UtlEmailTemplate`, `UtlSMSTemplate`) exactly like the legacy dialogs: every
`<<COLUMN>>` is replaced by that column of the document's header row (or of the template's own query, `<<DOCID>>` = the
record id). SMS goes through the provider URL in `UtlMsgSettings` (`<<MOBNO>>`, `<<MSG>>`), honours its daily limit and
is logged in `TrnSMS`; mail goes through the SMTP settings (app/services/mail.py).
"""
from __future__ import annotations

import re
import urllib.parse
import urllib.request
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.legacy.tables import insert_row
from app.services import mail

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# flag column -> (option name, label, supported by the web app)
_FLAG_OPTIONS = [
    ("FldEmail", "Send EMAIL", "Send EMAIL", True),
    ("FldSMS", "Send SMS", "Send SMS", True),
    ("blnEnvPrint", "Envelope Print", "Envelope Print", False),
    ("MultiDocGen", "Multi Doc Gen", "Multi Doc Gen", False),
    ("AllowImpExp", "EXPORT DATA", "Export Data", False),
    ("AllowImpExp", "IMPORT DATA", "Import Data", False),
]


def get_options(conn: Connection, doc_id: int) -> list[dict]:
    row = conn.execute(text("SELECT * FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if row is None:
        return []
    return [
        {"name": name, "label": label, "supported": supported}
        for flag, name, label, supported in _FLAG_OPTIONS
        if (row.get(flag) or "N").strip().upper() == "Y"
    ]


# ---------------------------------------------------------------- placeholders


def _hdr(conn: Connection, doc_id: int) -> tuple[str, str]:
    row = conn.execute(text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if row is None or not (row["HdrTblName"] or "").strip():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown document")
    table, sf = row["HdrTblName"].strip(), (row["DocShForm"] or "").strip()
    if not (_IDENT.match(table) and _IDENT.match(sf)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid document definition")
    return table, f"{sf}ID"


def _values(conn: Connection, doc_id: int, record_id: int, query_text: str | None = None) -> dict[str, str]:
    """Column -> value for the record: its header row, or the template's own SELECT with <<DOCID>> replaced."""
    if query_text:
        sql = re.sub(r"<<DOCID>>", str(int(record_id)), query_text, flags=re.I).strip()
        if not sql.lower().startswith("select") or ";" in sql.rstrip(";"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The template query must be a single SELECT")
        row = conn.execute(text(sql)).mappings().first()
    else:
        table, id_col = _hdr(conn, doc_id)
        row = conn.execute(text(f"SELECT * FROM {table} WHERE {id_col} = :i"), {"i": record_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found")
    return {str(k).upper(): ("" if v is None else str(v).strip()) for k, v in row.items()}


def _fill(template: str | None, values: dict[str, str]) -> str:
    out = template or ""
    for col, val in values.items():
        out = re.sub(re.escape(f"<<{col}>>"), lambda _m, v=val: v, out, flags=re.I)
    return out


# ---------------------------------------------------------------- Send EMAIL


def email_templates(conn: Connection, doc_id: int) -> list[str]:
    return [r[0] for r in conn.execute(text("SELECT DISTINCT Template FROM UtlEmailTemplate WHERE DocID = :d ORDER BY 1"), {"d": doc_id}).all()]


def email_prepare(conn: Connection, doc_id: int, record_id: int, template: str) -> dict:
    t = conn.execute(text("SELECT * FROM UtlEmailTemplate WHERE DocID = :d AND Template = :t"), {"d": doc_id, "t": template}).mappings().first()
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    vals = _values(conn, doc_id, record_id, t["QueryText"] if (t["FldQuery"] or "N").upper() == "Y" else None)
    return {
        "to": _fill(t["EmailTo"], vals),
        "cc": _fill(t["EmailCC"], vals),
        "subject": _fill(t["EmailSub"], vals),
        "body": _fill(t["EmailBody"], vals),
        "attach_print": (t["AttachPrintOut"] or "N").upper() == "Y",
        "print_name": t["PrintName"] or "",
    }


_EMAIL = re.compile(r"^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$")


def _addresses(raw: str) -> list[str]:
    return [a.strip() for a in re.split(r"[;,]", raw or "") if a.strip()]


def email_send(conn: Connection, *, to: str, cc: str, subject: str, body: str) -> int:
    recipients = _addresses(to)
    if not recipients:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "To is Empty....")
    if not body.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Body is Empty....")
    for a in recipients + _addresses(cc):
        if not _EMAIL.match(a):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The below email address is not valid...\n{a}")
    mail.send_mail(conn, recipients, subject, body, cc=_addresses(cc))
    return len(recipients)


# ---------------------------------------------------------------- Send SMS


def sms_templates(conn: Connection, doc_id: int) -> list[str]:
    return [r[0] for r in conn.execute(text("SELECT DISTINCT Template FROM UtlSMSTemplate WHERE DocID = :d ORDER BY 1"), {"d": doc_id}).all()]


def sms_providers(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT RowID, Provider, DailyLimit, Def FROM UtlMsgSettings ORDER BY RowID")).mappings().all()
    return [dict(r) for r in rows]


def sms_prepare(conn: Connection, doc_id: int, record_id: int, template: str) -> dict:
    t = conn.execute(text("SELECT * FROM UtlSMSTemplate WHERE DocID = :d AND Template = :t"), {"d": doc_id, "t": template}).mappings().first()
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    vals = _values(conn, doc_id, record_id, t["QueryText"] if (t["FromQuery"] or "N").upper() == "Y" else None)
    return {"text": _fill(t["TemplateText"], vals), "mobile": _fill(t["FixedMobNo"], vals)}


def sms_send(conn: Connection, *, mobile: str, message: str, provider: str = "") -> int:
    """svtModule.SendSMS: provider URL with <<MOBNO>> / <<MSG>>, daily limit per provider, every send logged in TrnSMS."""
    mobiles = [m.strip() for m in re.split(r"[;,]", mobile or "") if m.strip()]
    if not mobiles:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter mobile number....")
    if not message.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message is Empty....")
    if provider:
        p = conn.execute(text("SELECT * FROM UtlMsgSettings WHERE Provider = :p"), {"p": provider}).mappings().first()
    else:
        p = conn.execute(text("SELECT TOP 1 * FROM UtlMsgSettings ORDER BY CASE WHEN Def = 'Y' THEN 0 ELSE 1 END, RowID")).mappings().first()
    if p is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No SMS provider is configured. Ask the administrator to add one.")
    sent = 0
    for m in mobiles:
        today = conn.execute(text("SELECT COUNT(RowID) FROM TrnSMS WHERE ProviderID = :p AND TrnDate = CONVERT(date, GETDATE())"), {"p": p["RowID"]}).scalar() or 0
        if today >= int(p["DailyLimit"] or 0) > 0:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Daily SMS limit ({p['DailyLimit']}) has exceeded for Provider {p['Provider']}. Cannot Send SMS.")
        msg = message.replace("&", "%26").replace("#", "%23")
        url = (p["SMSURL"] or "").replace("<<MOBNO>>", urllib.parse.quote(m)).replace("<<MSG>>", urllib.parse.quote(msg, safe="%"))
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:  # nosec B310 - URL is the admin-configured provider
                resp.read()
        except OSError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"SMS could not be sent: {exc}") from exc
        insert_row(conn, "TrnSMS", {"TrnDate": datetime.now().date(), "ProviderID": p["RowID"], "MobNo": m, "MsgText": message, "TrnDateTime": datetime.now()})
        sent += 1
    return sent


# ---------------------------------------------------------------- SMS providers (admin: URL contains the gateway credentials)


def provider_rows(conn: Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(text("SELECT RowID, Provider, DailyLimit, SMSURL, Def FROM UtlMsgSettings ORDER BY RowID")).mappings().all()]


def save_providers(conn: Connection, rows: list[dict]) -> list[dict]:
    """Replace the provider list: update rows that have a RowID, insert the new ones, delete the ones left out."""
    keep = [int(r["RowID"]) for r in rows if r.get("RowID")]
    existing = {r[0] for r in conn.execute(text("SELECT RowID FROM UtlMsgSettings")).all()}
    for rid in existing - set(keep):
        conn.execute(text("DELETE FROM UtlMsgSettings WHERE RowID = :r"), {"r": rid})
    default_seen = False
    for r in rows:
        name = (r.get("Provider") or "").strip()
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Provider name should not be blank")
        is_def = "Y" if (r.get("Def") in ("Y", True)) and not default_seen else "N"
        default_seen = default_seen or is_def == "Y"
        vals = {"Provider": name, "DailyLimit": int(r.get("DailyLimit") or 0), "SMSURL": (r.get("SMSURL") or "").strip(), "Def": is_def}
        if r.get("RowID"):
            conn.execute(text("UPDATE UtlMsgSettings SET Provider=:Provider, DailyLimit=:DailyLimit, SMSURL=:SMSURL, Def=:Def WHERE RowID=:r"), {**vals, "r": int(r["RowID"])})
        else:
            new_id = (conn.execute(text("SELECT ISNULL(MAX(RowID), 0) + 1 FROM UtlMsgSettings")).scalar()) or 1
            insert_row(conn, "UtlMsgSettings", {**vals, "RowID": new_id})
    return provider_rows(conn)
