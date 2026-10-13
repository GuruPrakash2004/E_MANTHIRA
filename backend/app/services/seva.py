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

from dataclasses import dataclass, field
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, update_row
from app.utils.text_norm import normalise_name
from app.meta import numbering
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
    sannidhi_id: int
    seva_id: int
    mobile: str
    name: str
    name_kn: str | None
    gothra_id: int | None
    nakshatra_id: int | None
    rashi_id: int | None
    name2: str | None
    nakshatra2_id: int | None
    rashi2_id: int | None
    timing_text: str | None
    payment_mode: str  # Cash|Card|Cheque|UPI
    bank_name: str | None
    cheque_no: str | None
    cheque_date: date | None
    reference_no: str | None
    address: str | None
    ledger_id: int  # income ledger (LEDGER column)
    cash_bank_ledger_id: int  # LEDID column
    voucher_type: str  # Cash|Bank|Card
    rate: float
    dates: list[SevaDate]
    doc_date: date
    is_regular: bool = False
    add1: str | None = None  # the four address lines of the legacy form (TrnHdrSEVA.Add1..Add4)
    add2: str | None = None
    add3: str | None = None
    add4: str | None = None
    mobile_no: str | None = None  # separate 'Mobile No' under the address (TrnHdrSEVA.MOBNO)
    prasada: bool = False
    issued_by: str = ""
    # Fields the Designer tool adds to UtlDocDsgrFlds later that this
    # dataclass doesn't know about yet — keyed by FldCode. insert_row()
    # silently drops anything that isn't a real TrnHdrSEVA column, so this
    # is safe even if a designer field name doesn't match exactly.
    extra_fields: dict = field(default_factory=dict)


# Voucher type (book) each payment mode may post to — mirrors the web form; Payment and Voucher Type used to be independent.
VOUCHER_FOR_PAYMENT = {"CASH": ("Cash",), "CARD": ("Card", "Bank"), "CHEQUE": ("Bank",), "UPI": ("Bank",)}


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


def validate(data: SevaInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.doc_date, fy)
    if not data.dates:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one date!!")
    seen = set()
    for d in data.dates:
        if d.perform_date in seen:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Duplicate date {d.perform_date:%d/%m/%Y}")
        seen.add(d.perform_date)
    # UtlDocDsgrFlds (DocID 1263, REFNO): FldMndtryCompareVal='#PAYMENT#' (real
    # FldCode, no typo), Operator='=', WithVal='UPI' — verified correct as
    # implemented below (no change needed).
    if data.payment_mode.upper() == "UPI" and not (data.reference_no or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Reference Number is mandatory for UPI payment")
    # UtlDocDsgrFlds (DocID 1263, FldCode MOBNUM): FldMndtryCompareVal=#PAYMENT#,
    # Operator=<>, WithVal=CASH — mandatory for non-Cash payment. (Verified
    # against real data over the narrative BR-06 doc, which had this backwards:
    # UPI mobile-number fill rate is 85% vs Cash's 63% in the 551 real
    # records — the opposite of what "mandatory for Cash" would produce.)
    if data.payment_mode.upper() != "CASH" and not (data.mobile or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mobile Number is mandatory for non-Cash payment")
    if (data.mobile or "").strip() and not (data.mobile.isdigit() and len(data.mobile) == 10):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mobile Number must be 10 digits")
    # Payment Mode decides which book the receipt posts to: a UPI/Cheque receipt must not land in the cash book.
    allowed = VOUCHER_FOR_PAYMENT.get(data.payment_mode.upper())
    if allowed is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payment Mode is required")
    if data.voucher_type.title() not in allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{'UPI' if data.payment_mode.upper() == 'UPI' else data.payment_mode.title()} payments post to {' / '.join(allowed)}, not {data.voucher_type}",
        )
    if not data.name.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name should not be blank!")
    if data.rate <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")


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


def create(conn: Connection, *, data: SevaInput, fy: FinancialYear, user_code: str) -> dict:
    validate(data, fy)

    prefix = _get_sannidhi_prefix(conn, data.sannidhi_id)
    doc_no = numbering.next_doc_no(
        conn,
        table_name=TABLE,
        no_column=NO_COLUMN,
        prefix=prefix,
        fy_start_year=fy.start_year,
        fy_start_date=fy.start_date.isoformat(),
        fy_end_date=fy.end_date.isoformat(),
    )
    print_no = numbering.print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)

    total_amt = round(data.rate * len(data.dates), 2)
    days_print_text = data.dates[0].perform_date.strftime("%d/%m/%Y") if len(data.dates) == 1 else "Assorted Dates"

    seva_id = insert_row(
        conn,
        TABLE,
        {
            NO_COLUMN: doc_no,
            "Prefix": prefix,
            "PrintSEVANO": print_no,
            "SEVADate": data.doc_date,
            "Authorised": "Y",
            "Cancelled": "N",
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "SANNIDHIID": data.sannidhi_id,
            "SvaID": data.seva_id or 0,  # ID 0 = "none" like the legacy app: the receipt .rpt joins these masters, and a NULL drops the whole row
            "SevaRate": data.rate,
            "NoOfdays": len(data.dates),
            "TotalAmt": total_amt,
            "AMTINWRDS": amount_in_words(total_amt, "Rupees", "Paise"),
            "RegularD": "Y" if data.is_regular else "N",
            "DaysPrintText": days_print_text,
            "KNAME": normalise_name(data.name),
            "NAMEINKAN": data.name_kn or "",
            "SECKNAME": normalise_name(data.name2),
            "GOTHRAID": data.gothra_id or 0,
            "NAKSHATRAID": data.nakshatra_id or 0,
            "RASHIID": data.rashi_id or 0,
            "SECNAKSHATRAID": data.nakshatra2_id or 0,
            "SECRASHIID": data.rashi2_id or 0,
            "GRPSEVAID": 0,  # overwritten by extra_fields for a group-seva document
            "RMKS": data.timing_text or "",
            "MOBNUM": data.mobile,
            "MOBNO": (data.mobile_no or "").strip() or data.mobile,
            "Add1": data.add1 or "",
            "Add2": data.add2 or "",
            "Add3": data.add3 or "",
            "Add4": data.add4 or "",
            "PAYMENT": data.payment_mode,
            "BANKNAME": data.bank_name,
            "CHQNO": data.cheque_no,
            "CHQDATE": data.cheque_date,
            "REFNO": data.reference_no,
            "ADDRES": data.address,
            "ISSUEDBY": user_code,
            "PRASADA": "Yes" if data.prasada else "No",
            "LEDGER": data.ledger_id,
            "LEDID": data.cash_bank_ledger_id,
            "VCHTYP": data.voucher_type,
            **data.extra_fields,
        },
        returning="SEVAID",
    )

    for d in data.dates:
        insert_row(conn, "TrnDtlSevaDates", {"SevaID": seva_id, "PDate": d.perform_date, "PRemarks": d.remarks})

    receipt_no = None
    if _auto_receipt_enabled(conn):
        r = receipt_service.create_receipt(
            conn,
            fy=fy,
            prefix=prefix,
            receipt_date=data.doc_date,
            amount=total_amt,
            vch_type=data.voucher_type,
            narration=doc_no,
            cr_led_id=data.ledger_id,
            dr_led_id=data.cash_bank_ledger_id,
            user_code=user_code,
        )
        receipt_no = r.receipt_no

    audit.record(conn, entity="Seva Entry", entity_id=seva_id, action="A", user_code=user_code, details=doc_no)

    return {"seva_id": seva_id, "seva_no": doc_no, "print_no": print_no, "total_amt": total_amt, "receipt_no": receipt_no}


def get(conn: Connection, seva_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seva not found")
    dates = conn.execute(
        text("SELECT PDate, PRemarks FROM TrnDtlSevaDates WHERE SevaID = :id ORDER BY PDate"), {"id": seva_id}
    ).mappings().all()
    result = dict(row)
    result["dates"] = [dict(d) for d in dates]
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
    row = conn.execute(text("SELECT SEVANO FROM TrnHdrSEVA WHERE SEVAID = :id"), {"id": seva_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seva not found")
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
        data = replace(
            template,
            sannidhi_id=m["SANNIDHIID"],
            seva_id=m["SVAID"],
            mobile=(grp["MOBNO"] or "").strip(),
            mobile_no=(grp["MOBNO"] or "").strip(),
            name=m["name"] or "",
            name2=m["name2"] or "",
            gothra_id=m["GOTRAID"],
            nakshatra_id=m["NAKSHATRAID"],
            nakshatra2_id=m["NAKSH2ID"],
            rashi_id=m["rashi_id"],
            rate=float(m["rate"] or 0),
            extra_fields={**(template.extra_fields or {}), "GRPSEVAID": grp_id},
        )
        created.append(create(conn, data=data, fy=fy, user_code=user_code))
    return created
