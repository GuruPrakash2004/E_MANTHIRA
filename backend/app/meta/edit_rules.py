"""
Edit / authorisation rules a document carries in UtlTransactions (the legacy forms' ChkEditRights), read live so a
change made in the Designer applies to the web app without a code change:

  AuthReq                 'Y' = a saved document must be authorised (Utilities > Authorise Documents) before it counts;
                          new documents are saved unauthorised and an edit makes them unauthorised again.
  blnFreezeDoc            'Y' = saved documents cannot be edited.
  AllowEditDeleteForDays  > 0 = a document can be edited / deleted only until that many days after its date.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection


def _flags(conn: Connection, doc_id: int) -> dict:
    row = conn.execute(
        # SELECT *, not a column list: older temples lack the newer switches (they read as N / 0)
        text("SELECT * FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}
    ).mappings().first()
    row = row or {}
    return {
        "auth_req": str(row.get("AuthReq") or "N").strip().upper() == "Y",
        "freeze": str(row.get("blnFreezeDoc") or "N").strip().upper() == "Y",
        "days": int(row.get("AllowEditDeleteForDays") or 0),
        "print_cancelled": str(row.get("PrintCancelled") or "N").strip().upper() == "Y",
        "edit_date": str(row.get("AllowEditDocDate") or "N").strip().upper() == "Y",
    }


def doc_date_editable(conn: Connection, doc_id: int) -> bool:
    """UtlTransactions.AllowEditDocDate: when 'N' the legacy form locks the document date (it is the system date)."""
    return _flags(conn, doc_id)["edit_date"]


def auth_required(conn: Connection, doc_id: int) -> bool:
    return _flags(conn, doc_id)["auth_req"]


def authorised_on_save(conn: Connection, doc_id: int) -> str:
    """'Y' when the document needs no authorisation, otherwise 'N' (legacy: strAuthReq = 'N' -> 'Y')."""
    return "N" if auth_required(conn, doc_id) else "Y"


def assert_editable(conn: Connection, doc_id: int, *, doc_date: date | datetime | None, authorised: str | None, today: date | None = None) -> None:
    """Raise 409 with the legacy message when the document may no longer be edited or deleted."""
    f = _flags(conn, doc_id)
    if f["freeze"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Document Cannot edit Since it is freezed!")
    if f["auth_req"] and str(authorised or "N").strip().upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is Authorised. Cannot edit!")
    if f["days"] > 0 and doc_date is not None:
        d = doc_date.date() if isinstance(doc_date, datetime) else doc_date
        if (today or date.today()) > d + timedelta(days=f["days"]):
            raise HTTPException(status.HTTP_409_CONFLICT, "Edit limit days crossed... Cannot edit!")


def _header_info(conn: Connection, doc_id: int) -> tuple[str, str, set[str]] | None:
    """(header table, document short form, lower-cased column names) from UtlTransactions, or None when unusable."""
    import re

    meta = conn.execute(text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    tbl, sh = ((meta or {}).get("HdrTblName") or "").strip(), ((meta or {}).get("DocShForm") or "").strip()
    if not tbl or not sh or not re.fullmatch(r"\w+", tbl) or not re.fullmatch(r"\w+", sh):
        return None
    cols = {r[0].lower() for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": tbl})}
    return (tbl, sh, cols) if f"{sh}id".lower() in cols else None


def amendment_supported(conn: Connection, doc_id: int) -> bool:
    """Amendment needs the designer switch (AmmReq='Y') AND the three columns on the header table; without them there is
    nowhere to store it (the web app never changes the schema), so the feature stays dormant."""
    if not _flags_ext(conn, doc_id)["amendment_flag"]:
        return False
    info = _header_info(conn, doc_id)
    return bool(info) and {"ammendment", "ammno", "ammdate"} <= info[2]


def _flags_ext(conn: Connection, doc_id: int) -> dict:
    row = conn.execute(text("SELECT AmmReq, FileAttachReq FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first() or {}
    return {"amendment_flag": str(row.get("AmmReq") or "N").strip().upper() == "Y", "attach_flag": str(row.get("FileAttachReq") or "N").strip().upper() == "Y"}


def assert_record_editable(conn: Connection, doc_id: int, record_id: int) -> None:
    """assert_editable for a saved record found by id: cancelled, frozen, authorised, edit-limit days."""
    info = _header_info(conn, doc_id)
    if info is None:
        return
    tbl, sh, cols = info
    want = [c for c in ("Cancelled", "Authorised", f"{sh}Date") if c.lower() in cols]
    row = conn.execute(text(f"SELECT {', '.join(want) or '1 AS x'} FROM {tbl} WHERE {sh}ID = :i"), {"i": record_id}).mappings().first()  # names come from UtlTransactions, checked above
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found")
    if str(row.get("Cancelled") or "N").strip().upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    assert_editable(conn, doc_id, doc_date=row.get(f"{sh}Date"), authorised=row.get("Authorised"))


def assert_printable(conn: Connection, doc_id: int, record_id: int) -> None:
    """Legacy print guards: a cancelled document is not printed; with authorisation on, an unauthorised one is not either.
    Documents whose header table has no Cancelled / Authorised column (masters, vouchers staged elsewhere) are not checked."""
    import re

    meta = conn.execute(text("SELECT HdrTblName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    tbl, sh = ((meta or {}).get("HdrTblName") or "").strip(), ((meta or {}).get("DocShForm") or "").strip()
    if not tbl or not sh or not re.fullmatch(r"\w+", tbl) or not re.fullmatch(r"\w+", sh):
        return
    cols = {r[0].lower() for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t"), {"t": tbl})}
    if f"{sh}id".lower() not in cols or "cancelled" not in cols:
        return
    sel = "Cancelled" + (", Authorised" if "authorised" in cols else "")
    row = conn.execute(text(f"SELECT {sel} FROM {tbl} WHERE {sh}ID = :i"), {"i": record_id}).mappings().first()  # names come from UtlTransactions, checked above
    if row is None:
        return
    flags = _flags(conn, doc_id)
    if str(row.get("Cancelled") or "N").strip().upper() == "Y":
        if not flags["print_cancelled"]:  # UtlTransactions.PrintCancelled = 'Y' lets the document type print cancelled records
            raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Printing not possible!")
        return
    if "authorised" in cols and flags["auth_req"] and str(row.get("Authorised") or "N").strip().upper() != "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is not Authorised. Cannot Print!")


def rules(conn: Connection, doc_id: int) -> dict:
    """Every per-document switch the screens need, read live from UtlTransactions (served by /meta/docs/{id}/rules)."""
    row = conn.execute(
        text(
            "SELECT AuthReq, blnFreezeDoc, AllowEditDeleteForDays, PrintCancelled, AllowEditDocDate, AllowCopyFrom, AmmReq, "
            "FileAttachReq, PrintAfterSave, AllowImpExp FROM UtlTransactions WHERE DocID = :d"
        ),
        {"d": doc_id},
    ).mappings().first() or {}
    yes = lambda k: str(row.get(k) or "N").strip().upper() == "Y"  # noqa: E731
    extra: dict = {}
    from app.core import capabilities

    if capabilities.has_col("UtlTransactions", "BalanceColReq") and capabilities.has_col("UtlTransactions", "DefFirstRowAmtType"):
        e = conn.execute(text("SELECT BalanceColReq, DefFirstRowAmtType FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first() or {}
        extra = {
            "balance_col": str(e.get("BalanceColReq") or "N").strip().upper() == "Y",  # voucher grid shows each head's balance
            "first_row_type": (str(e.get("DefFirstRowAmtType") or "DR").strip().upper() or "DR")[:2],  # DR / CR for the first line
        }
    if capabilities.has_col("UtlTransactions", "BillWiseFeatureReq"):
        b = conn.execute(text("SELECT BillWiseFeatureReq FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first() or {}
        extra["bill_wise"] = str(b.get("BillWiseFeatureReq") or "N").strip().upper() == "Y"  # the Bill wise Adjustment window on party lines
    return {
        **extra,
        "auth_req": yes("AuthReq"),
        "freeze": yes("blnFreezeDoc"),
        "edit_days": int(row.get("AllowEditDeleteForDays") or 0),
        "print_cancelled": yes("PrintCancelled"),
        "edit_doc_date": yes("AllowEditDocDate"),
        "allow_copy_from": yes("AllowCopyFrom"),
        "amendment": amendment_supported(conn, doc_id),
        "file_attach": yes("FileAttachReq"),
        "print_after_save": yes("PrintAfterSave"),
        "allow_imp_exp": yes("AllowImpExp"),
    }
