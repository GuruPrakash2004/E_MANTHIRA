"""
Seva Entry service — port of `frmTrnSeva` (doc 07 §5.3 / §6.1).

DocID 1263. Header table TrnHdrSEVA, detail table TrnDtlSevaDates.
Auto-creates a Receipt Voucher + GL posting when UtlGSettings
[COMPANY/AutoRcptFromSeva] = 'Y' (matches legacy `SaveRcptVch`).

Cancel behaviour (see CLAUDE.md §2 rule 9 / doc 09 addendum, and the fix
agreed for this build — D-06): the legacy app leaves the receipt & GL entry
untouched when a Seva is Cancelled (only Delete reverses them). We keep the
SAME `Cancelled` Y/N column and semantics, but ALSO void the linked receipt
and post a reversing GL entry on cancel, so the books stay correct. This is
an intentional, documented behaviour change — everything else is byte-for-
byte parity with the legacy write-set.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, table, update_row
from app.utils.text_norm import normalise_name
from app.meta import doc_rules, edit_rules, numbering
from app.services import receipt as receipt_service
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1263
TABLE = "TrnHdrSEVA"
NO_COLUMN = "SEVANO"


@dataclass
class SevaDate:
    perform_date: date
    remarks: str = ""


@dataclass
class SevaInput:
    """What the entry screen submits: the Designer fields keyed by FldCode (the screen is rendered from
    UtlDocDsgrFlds, so which fields exist is the temple's choice), the performance dates and the document date."""

    fields: dict
    dates: list[SevaDate]
    doc_date: date
    group_id: int = 0  # TrnHdrGRPSEVA id when this seva is generated from a Group Seva
    regular: bool = False  # "Regular Devotee" tick (TrnHdrSEVA.RegularD): the devotee shows up in Select Sevakartharu
    days_text: str = ""  # the Date Text of the Dates Selection dialog (printed on the receipt, TrnHdrSEVA.DaysPrintText)


# Codes this service owns: whatever the browser sends for them is ignored.
SYSTEM_CODES = ("ISSUEDBY", "GRPSEVAID")
BOOKS = ("Cash", "Bank", "Card")


def _auto_receipt_enabled(conn: Connection) -> bool:
    row = conn.execute(
        text("SELECT SetValue FROM UtlGSettings WHERE SetGroup = 'COMPANY' AND SetName = 'AutoRcptFromSeva'")
    ).scalar()
    return (row or "N").strip().upper() == "Y"


def _get_sannidhi_prefix(conn: Connection, sannidhi_id: int) -> str:
    code = conn.execute(text("SELECT SANNIDHICODE FROM MstSANNIDHI WHERE SANNIDHIID = :id"), {"id": sannidhi_id}).scalar()
    if not code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Sannidhi")
    prefixes = numbering.resolve_prefix(conn, doc_id=DOC_ID, field_values={"SANNIDHIID": code})
    if not prefixes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No document-number prefix configured for Sannidhi {code}")
    return prefixes[0]


def validate(data: SevaInput, fy: FinancialYear, rows: list[dict], values: dict) -> None:
    assert_date_in_fy(data.doc_date, fy)
    if not data.dates:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one date!!")
    seen = set()
    for d in data.dates:
        if d.perform_date in seen:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Duplicate date {d.perform_date:%d-%b-%Y}")
        seen.add(d.perform_date)
    # Mandatory / list / width rules are the temple's own, read from UtlDocDsgrFlds (e.g. REFNO mandatory for UPI,
    # MOBNUM mandatory for non-Cash payment) — nothing is hard-coded per field here.
    doc_rules.validate(rows, values, skip=SYSTEM_CODES, fy=fy)
    if not str(values.get("KNAME") or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name should not be blank!")


def lookup_devotee(conn: Connection, *, mobile: str, name: str | None = None) -> dict | None:
    """Port of `SevaDetails()`: last non-cancelled seva for this mobile (+name if given)."""
    from app.core.db import limit_clause

    sql = """
        SELECT h.KNAME, n1.NAKSHATRACODE AS Nak1, h.NAKSHATRAID,
               (SELECT GOTHRACODE FROM MstGOTHRA k WHERE k.GOTHRAID = h.GOTHRAID) AS Gothra, h.GOTHRAID,
               h.SECKNAME, n2.NAKSHATRACODE AS Nak2, h.SECNAKSHATRAID,
               COALESCE(h.NAMEINKAN, '') AS NAMEINKAN,
               (SELECT RASHICODE FROM MstRASHI k WHERE k.RASHIID = h.RASHIID) AS Rashi, h.RASHIID,
               h.SECRASHIID
        FROM TrnHdrSEVA h
        LEFT JOIN MstNAKSHATRA n1 ON n1.NAKSHATRAID = h.NAKSHATRAID
        LEFT JOIN MstNAKSHATRA n2 ON n2.NAKSHATRAID = h.SECNAKSHATRAID
        WHERE h.Cancelled = 'N' AND h.MOBNUM = :mobile
    """
    params: dict = {"mobile": mobile}
    if name:
        sql += " AND h.KNAME = :name"
        params["name"] = name
    sql += f" ORDER BY h.SEVAID DESC {limit_clause(1)}"
    row = conn.execute(text(sql), params).mappings().first()
    return dict(row) if row else None


@dataclass
class _Prepared:
    values: dict
    sannidhi_id: int
    prefix: str
    total_amt: float
    cols: dict


def _prepare(conn: Connection, data: SevaInput, fy: FinancialYear) -> _Prepared:
    """Everything a save needs that does not depend on the document number: Designer rules, rate, totals, header columns."""
    rows = doc_rules.load_fields(conn, DOC_ID)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Seva Entry has no fields configured in the Doc Designer")
    values = doc_rules.effective_values(rows, {k: v for k, v in data.fields.items() if k not in SYSTEM_CODES})
    validate(data, fy, rows, values)

    sannidhi_id = int(values.get("SANNIDHIID") or 0)
    seva_id_value = int(values.get("SVAID") or 0)
    prefix = _get_sannidhi_prefix(conn, sannidhi_id)
    # The rate is the Seva master's amount (the entry screen has no rate field).
    rate = float(conn.execute(text("SELECT AMT FROM MstSVA WHERE SVAID = :id"), {"id": seva_id_value}).scalar() or 0)
    if rate <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    total_amt = round(rate * len(data.dates), 2)
    # what the Dates Selection dialog left in Date Text; with a single date, or when it was not used, the legacy defaults
    days_print_text = (data.days_text or "").strip()[:250] or (data.dates[0].perform_date.strftime("%d/%m/%Y") if len(data.dates) == 1 else "Assorted Dates")

    cols = doc_rules.column_values(rows, values, table(TABLE))
    cols.update(
        {
            "SEVADate": data.doc_date,
            "SvaID": seva_id_value,  # ID 0 = "none" like the legacy app: the receipt .rpt joins these masters, and a NULL drops the whole row
            "SevaRate": rate,
            "NoOfdays": len(data.dates),
            "TotalAmt": total_amt,
            "AMTINWRDS": amount_in_words(total_amt, "Rupees", "Paise"),
            "DaysPrintText": days_print_text,
            "KNAME": normalise_name(str(values.get("KNAME") or "")),
            "SECKNAME": normalise_name(str(values.get("SECKNAME") or "")),
            "MOBNO": str(values.get("MOBNUM") or "").strip(),
            "RegularD": "Y" if data.regular else "N",
        }
    )
    if "PRASADA" not in cols or not cols["PRASADA"]:
        cols["PRASADA"] = "No"
    return _Prepared(values, sannidhi_id, prefix, total_amt, cols)


def _post_receipt(conn: Connection, *, p: _Prepared, data: SevaInput, fy: FinancialYear, doc_no: str, user_code: str) -> str | None:
    """Auto receipt + GL (legacy SaveRcptVch) when the temple has AutoRcptFromSeva on; returns the receipt number."""
    if not _auto_receipt_enabled(conn):
        return None
    vch_type = str(p.values.get("VCHTYP") or "").strip().title()
    income, cash_bank = int(p.values.get("LEDGER") or 0), int(p.values.get("LEDID") or 0)
    if not (income and cash_bank and vch_type in BOOKS):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Auto-receipt is on, so the Ledger, Cash/Bank account and Voucher Type are needed — add them to the Seva form in the Doc Designer",
        )
    r = receipt_service.create_receipt(
        conn,
        fy=fy,
        prefix=p.prefix,
        receipt_date=data.doc_date,
        amount=p.total_amt,
        vch_type=vch_type,
        narration=doc_no,
        cr_led_id=income,
        dr_led_id=cash_bank,
        user_code=user_code,
    )
    return r.receipt_no


def preview_no(conn: Connection, *, sannidhi_id: int, fy: FinancialYear) -> dict:
    """The bill no the next save for this Sannidhi would get (nothing is reserved; see numbering.peek_doc_no)."""
    prefix = _get_sannidhi_prefix(conn, sannidhi_id)
    doc_no = numbering.peek_doc_no(conn, table_name=TABLE, no_column=NO_COLUMN, prefix=prefix, fy_start_year=fy.start_year)
    print_no = numbering.print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)
    return {"seva_no": doc_no, "print_no": print_no}


def create(conn: Connection, *, data: SevaInput, fy: FinancialYear, user_code: str) -> dict:
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.doc_date = date.today()  # AllowEditDocDate = 'N': the legacy form locks the date to the system date
    p = _prepare(conn, data, fy)

    doc_no = numbering.next_doc_no(
        conn,
        table_name=TABLE,
        no_column=NO_COLUMN,
        prefix=p.prefix,
        fy_start_year=fy.start_year,
        fy_start_date=fy.start_date.isoformat(),
        fy_end_date=fy.end_date.isoformat(),
    )
    print_no = numbering.print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=p.prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)

    cols = dict(p.cols)
    cols.update(
        {
            NO_COLUMN: doc_no,
            "Prefix": p.prefix,
            "PrintSEVANO": print_no,
            "Authorised": edit_rules.authorised_on_save(conn, DOC_ID),
            "Cancelled": "N",
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "Add1": "",
            "Add2": "",
            "Add3": "",
            "Add4": "",
            "ISSUEDBY": user_code,
            "GRPSEVAID": data.group_id or 0,
        }
    )
    seva_id = insert_row(conn, TABLE, cols, returning="SEVAID")

    for d in data.dates:
        insert_row(conn, "TrnDtlSevaDates", {"SevaID": seva_id, "PDate": d.perform_date, "PRemarks": d.remarks})

    receipt_no = _post_receipt(conn, p=p, data=data, fy=fy, doc_no=doc_no, user_code=user_code)

    audit.record(conn, entity="Seva Entry", entity_id=seva_id, action="A", user_code=user_code, details=doc_no)

    return {"seva_id": seva_id, "seva_no": doc_no, "print_no": print_no, "total_amt": p.total_amt, "receipt_no": receipt_no}


def update(conn: Connection, *, seva_id: int, data: SevaInput, fy: FinancialYear, user_code: str) -> dict:
    """
    Edit a saved seva. The bill number (SEVANO / Prefix / PrintSEVANO) and who/when it was added stay as they are; the
    header, the performance dates and - when auto-receipt is on - the receipt + GL are rewritten for the new values.
    """
    old = conn.execute(
        text("SELECT SEVANO, PrintSEVANO, Cancelled, SANNIDHIID, SEVADate, Authorised FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id}
    ).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seva not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=old["SEVADate"], authorised=old["Authorised"])
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.doc_date = old["SEVADate"].date() if isinstance(old["SEVADate"], datetime) else old["SEVADate"]  # date stays as saved

    p = _prepare(conn, data, fy)
    if p.sannidhi_id != int(old["SANNIDHIID"] or 0):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The Sannidhi cannot be changed after the bill number is issued")
    doc_no = old["SEVANO"]

    cols = dict(p.cols)
    cols.update({"ChangedBy": user_code, "ChangedOn": datetime.now()})
    if edit_rules.auth_required(conn, DOC_ID):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation (legacy: Authorised = 'N' on edit)
    update_row(conn, TABLE, "SEVAID", seva_id, cols)  # columns this database does not have are skipped by update_row

    conn.execute(text("DELETE FROM TrnDtlSevaDates WHERE SevaID = :id"), {"id": seva_id})
    for d in data.dates:
        insert_row(conn, "TrnDtlSevaDates", {"SevaID": seva_id, "PDate": d.perform_date, "PRemarks": d.remarks})

    receipt_no = None
    if _auto_receipt_enabled(conn):
        receipt_service.delete_receipt_by_narr(conn, doc_no)  # reverses the old GL posting; the new one is posted below
        receipt_no = _post_receipt(conn, p=p, data=data, fy=fy, doc_no=doc_no, user_code=user_code)

    audit.record(conn, entity="Seva Entry", entity_id=seva_id, action="E", user_code=user_code, details=doc_no)
    return {"seva_id": seva_id, "seva_no": doc_no, "print_no": old["PrintSEVANO"] or doc_no, "total_amt": p.total_amt, "receipt_no": receipt_no}


def get(conn: Connection, seva_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seva not found")
    dates = conn.execute(
        text("SELECT PDate, PRemarks FROM TrnDtlSevaDates WHERE SevaID = :id ORDER BY PDate"), {"id": seva_id}
    ).mappings().all()
    result = dict(row)
    result["dates"] = [dict(d) for d in dates]
    result["auth_req"] = edit_rules.auth_required(conn, DOC_ID)  # the screen shows AUTHORISED / NOT AUTHORISED only when the document needs it
    return result


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = """
        SELECT h.SEVAID, h.SEVANO, h.PrintSEVANO, h.SEVADate, h.KNAME, h.MOBNUM, h.TotalAmt, h.Cancelled
        FROM TrnHdrSEVA h
        WHERE h.SEVADate BETWEEN :fs AND :fe
    """
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (h.SEVANO LIKE :q OR h.KNAME LIKE :q OR h.MOBNUM LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY h.SEVAID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def cancel(conn: Connection, *, seva_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT SEVANO, Cancelled FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seva not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")

    update_row(conn, "TrnHdrSEVA", "SEVAID", seva_id, {"Cancelled": "Y"})
    # Fixed behaviour (D-06): void the linked receipt and reverse its GL entry
    # instead of leaving income overstated — see module docstring.
    receipt_service.void_receipt_by_narr(conn, row["SEVANO"], reverse_ledger=True)
    audit.record(conn, entity="Seva Entry", entity_id=seva_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, seva_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT SEVANO, SEVADate, Authorised FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seva not found")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=row["SEVADate"], authorised=row["Authorised"])
    receipt_service.delete_receipt_by_narr(conn, row["SEVANO"])
    conn.execute(text("DELETE FROM TrnDtlSevaDates WHERE SevaID = :id"), {"id": seva_id})
    conn.execute(text("DELETE FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id})
    audit.record(conn, entity="Seva Entry", entity_id=seva_id, action="D", user_code=user_code)


def regular_devotees(conn: Connection, *, name: str = "", top: int = 0) -> list[dict]:
    """
    Select Sevakartharu (frmTrnSeva.btnLoadSevaDtls_Click): earlier sevas of regular devotees (RegularD='Y', not
    cancelled), newest first, optionally narrowed to names containing `name` and limited to the newest `top`.
    """
    from app.core.db import limit_clause

    sql = """
        SELECT h.SEVAID, h.SEVANO, h.PrintSEVANO, h.SVAID, h.KNAME, h.MOBNO, h.NAMEINKAN,
               g.GOTHRACODE AS GothraName, h.GOTHRAID, n1.NAKSHATRACODE AS NakshatraName, h.NAKSHATRAID,
               h.SECKNAME, n2.NAKSHATRACODE AS NakshatraName2, h.SECNAKSHATRAID,
               r1.RASHICODE AS Rashi1, h.RASHIID, r2.RASHICODE AS Rashi2, h.SECRASHIID,
               h.Add1, h.Add2, h.Add3, h.Add4
        FROM TrnHdrSEVA h
        JOIN MstSVA e ON h.SVAID = e.SVAID
        LEFT JOIN MstNAKSHATRA n1 ON h.NAKSHATRAID = n1.NAKSHATRAID
        LEFT JOIN MstNAKSHATRA n2 ON h.SECNAKSHATRAID = n2.NAKSHATRAID
        LEFT JOIN MstGOTHRA g ON h.GOTHRAID = g.GOTHRAID
        LEFT JOIN MstRASHI r1 ON h.RASHIID = r1.RASHIID
        LEFT JOIN MstRASHI r2 ON h.SECRASHIID = r2.RASHIID
        WHERE h.Cancelled = 'N' AND h.RegularD = 'Y'
    """
    params: dict = {}
    if name.strip():
        sql += " AND h.KNAME LIKE :q"
        params["q"] = f"%{name.strip()}%"
    sql += f" ORDER BY h.SEVAID DESC {limit_clause(top if top > 0 else 500)}"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def last_entry(conn: Connection) -> dict | None:
    """F6 in Add mode (frmTrnSeva): load the most recent seva (max SEVAID) so it can be re-entered."""
    last = conn.execute(text("SELECT MAX(SEVAID) FROM TrnHdrSEVA")).scalar()
    return get(conn, int(last)) if last else None


# ---------------------------------------------------------------- Group Seva (frmTrnSeva: Group Seva button)


def group_sevas(conn: Connection) -> list[dict]:
    """The saved groups (TrnHdrGRPSEVA) with the Sevas their members are booked for - what the legacy 'Load' dialog lists."""
    rows = conn.execute(
        text(
            """
            SELECT h.GRPSEVAID, h.NAME, h.GRPSEVADISPNAME, h.MOBNO, d.SVAID, i.SVANAME,
                   COUNT(*) AS members
            FROM TrnHdrGRPSEVA h
            JOIN TrnDtlGrpSeva d ON h.GRPSEVAID = d.GRPSEVAID
            JOIN MstSVA i ON d.SVAID = i.SVAID
            WHERE h.Cancelled = 'N'
            GROUP BY h.GRPSEVAID, h.NAME, h.GRPSEVADISPNAME, h.MOBNO, d.SVAID, i.SVANAME
            ORDER BY h.NAME, i.SVANAME
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


def group_members(conn: Connection, *, grp_id: int, seva_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT d.GRPSEVADtlID, s.SANNIDHICODE AS sannidhi, d.SANNIDHIID, i.SVANAME AS seva, d.SVAID, i.AMT AS rate,
                   d.SEVAKARTHRU AS name, n1.NAKSHATRACODE AS nakshatra, d.NAKSHATRAID,
                   g.GOTHRACODE AS gothra, d.GOTRAID, d.SEVAKARTHRU2 AS name2, n2.NAKSHATRACODE AS nakshatra2, d.NAKSH2ID,
                   r.RASHICODE AS rashi, d.RASHI AS rashi_id
            FROM TrnDtlGrpSeva d
            JOIN MstSVA i ON d.SVAID = i.SVAID
            JOIN MstSANNIDHI s ON d.SANNIDHIID = s.SANNIDHIID
            LEFT JOIN MstGOTHRA g ON d.GOTRAID = g.GOTHRAID
            LEFT JOIN MstNAKSHATRA n1 ON d.NAKSHATRAID = n1.NAKSHATRAID
            LEFT JOIN MstNAKSHATRA n2 ON d.NAKSH2ID = n2.NAKSHATRAID
            LEFT JOIN MstRASHI r ON d.RASHI = r.RASHIID
            WHERE d.GRPSEVAID = :g AND d.SVAID = :v
            ORDER BY d.GRPSEVADtlID
            """
        ),
        {"g": grp_id, "v": seva_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def generate_group(
    conn: Connection, *, grp_id: int, seva_id: int, member_ids: list[int], template: SevaInput, fy: FinancialYear, user_code: str
) -> list[dict]:
    """
    btnGenInv_Click: one Seva Entry per ticked member, each with that member's own details and the Seva's rate, and the
    payment, days, dates and ledgers entered on the form. All entries (and their receipts) save together or not at all.
    """
    from dataclasses import replace

    grp = conn.execute(text("SELECT NAME, MOBNO FROM TrnHdrGRPSEVA WHERE GRPSEVAID = :g"), {"g": grp_id}).mappings().first()
    if grp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group Seva not found")
    members = {m["GRPSEVADtlID"]: m for m in group_members(conn, grp_id=grp_id, seva_id=seva_id)}
    picked = [members[i] for i in dict.fromkeys(member_ids) if i in members]
    if not picked:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tick at least one member")
    created = []
    for m in picked:
        member_values = {
            "SANNIDHIID": m["SANNIDHIID"],
            "SVAID": m["SVAID"],
            "MOBNUM": (grp["MOBNO"] or "").strip(),
            "KNAME": m["name"] or "",
            "SECKNAME": m["name2"] or "",
            "GOTHRAID": m["GOTRAID"],
            "NAKSHATRAID": m["NAKSHATRAID"],
            "SECNAKSHATRAID": m["NAKSH2ID"],
            "RASHIID": m["rashi_id"],
        }
        data = replace(template, fields={**template.fields, **member_values}, group_id=grp_id)
        created.append(create(conn, data=data, fy=fy, user_code=user_code))
    return created
