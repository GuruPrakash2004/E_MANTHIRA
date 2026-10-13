"""
Donation Receipt Entry service — port of `frmTrnDONREC` (doc 07 §5.4 / §6.2).

DocID 1261. Header table TrnHdrDONREC + detail table TrnDtlDONREC — every
real donation in the DB has at least one TrnDtlDONREC row (verified live:
SlNo/ItemSlNO=1, SEVAID=0, SEVANME='DONATION' for a plain donation not
tagged to any seva), so a donor CAN split one receipt across several sevas
(e.g. "₹5000 for Annadana, ₹5000 general"), each its own line with its own
SEVAID/amount — this was previously missing entirely (caught 2026-09-29
against a client complaint that the web app doesn't match the Windows app).
Always creates a Receipt Voucher + GL posting on save (SaveRcptVch is called
unconditionally in the legacy form — a donation entry IS a receipt of
money), same write-set pattern as Seva/Hall (see app/services/receipt.py
docstring).

Cancel behaviour matches the same D-06 fix as Seva: voids the linked receipt
and posts a reversing GL entry instead of leaving the books overstated.
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
from app.meta import numbering
from app.services import receipt as receipt_service
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1261
TABLE = "TrnHdrDONREC"
NO_COLUMN = "DONRECNO"


@dataclass
class DonationLine:
    amount: float
    seva_id: int | None = None  # None/0 -> plain "DONATION" line, matches legacy default
    seva_name: str | None = None  # display text when seva_id is 0 (legacy stores 'DONATION')


@dataclass
class DonationInput:
    prefix: str
    donor: str
    contact_no: str | None
    address: str | None
    pan_no: str | None
    payment_mode: str  # Cash|Card|Cheque|UPI
    bank_name: str | None
    cheque_no: str | None
    cheque_date: date | None
    reference_no: str | None
    remarks: str | None
    ledger_id: int  # income ledger (LEDGER column)
    cash_bank_ledger_id: int  # LEDID column
    amount: float
    doc_date: date
    lines: list[DonationLine] | None = None  # optional Seva-tagged split; defaults to one plain line
    hb_id: int | None = None  # optional link to a Hall Booking (TrnHdrHB.HBID) this donation relates to
    # Fields the Designer tool adds to UtlDocDsgrFlds later that this
    # dataclass doesn't know about yet — keyed by FldCode. insert_row()
    # silently drops anything that isn't a real TrnHdrDONREC column.
    extra_fields: dict = field(default_factory=dict)


def validate(data: DonationInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.doc_date, fy)
    if not data.donor.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Donor Name should not be blank!")
    if data.lines:
        lines_total = round(sum(l.amount for l in data.lines), 2)
        if lines_total != round(data.amount, 2):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Line amounts (₹{lines_total}) do not add up to the total amount (₹{round(data.amount, 2)})"
            )
    if data.amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    # UtlDocDsgrFlds (DocID 1261, REFNO): FldMndtryCompareVal='#PAYMNTMODE#'
    # (real FldCode, no typo), Operator='=', WithVal='UPI' — verified correct
    # as implemented below (no change needed).
    if data.payment_mode.upper() == "UPI" and not (data.reference_no or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Reference Number is mandatory for UPI payment")
    # UtlDocDsgrFlds (DocID 1261, CONTACTNO): FldMndtryCompareVal references
    # '#PAYMNETMODE#' — a TYPO in the metadata itself (the real FldCode/
    # column is PAYMNTMODE, no 'E'; confirmed via INFORMATION_SCHEMA — no
    # PAYMNETMODE column exists on TrnHdrDONREC). An unresolvable #FIELD#
    # reference evaluates as blank, so '' <> 'CASH' is always true — this
    # rule is, in practice, UNCONDITIONALLY mandatory, not "mandatory for
    # non-Cash" as a previous pass here assumed. Re-verified against real
    # data: 0 of 22 real donation receipts have a blank CONTACTNO, including
    # the 8 Cash-mode ones (where a real conditional rule would allow blanks)
    # — contrast with genuinely-optional fields on this same table, e.g.
    # ADDRESS: 20/22 blank, PANNO: 14/22 blank, so this isn't just "staff
    # fill in everything". Do not make this conditional on payment mode.
    if not (data.contact_no or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Contact Number is mandatory")


def create(conn: Connection, *, data: DonationInput, fy: FinancialYear, user_code: str) -> dict:
    validate(data, fy)

    doc_no = numbering.next_doc_no(
        conn,
        table_name=TABLE,
        no_column=NO_COLUMN,
        prefix=data.prefix,
        fy_start_year=fy.start_year,
        fy_start_date=fy.start_date.isoformat(),
        fy_end_date=fy.end_date.isoformat(),
    )
    print_no = numbering.print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=data.prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)

    amount = round(data.amount, 2)
    donrec_id = insert_row(
        conn,
        TABLE,
        {
            NO_COLUMN: doc_no,
            "Prefix": data.prefix,
            "PrintDONRECNO": print_no,
            "DONRECDate": data.doc_date,
            "Authorised": "Y",
            "Cancelled": "N",
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "TOTAMT": amount,
            "PAYMNTMODE": data.payment_mode,
            "ADDRESS": data.address,
            "CHEQUENO": data.cheque_no,
            "CHEQUEDATE": data.cheque_date,
            "BANKNAME": data.bank_name,
            "RMKS": data.remarks,
            "AMTINWORDS": amount_in_words(amount, "Rupees", "Paise"),
            "ISSUEDBY": user_code,
            "DONOR": data.donor,
            "REFNO": data.reference_no,
            "CONTACTNO": data.contact_no,
            "ShowRec": "Y",
            "PANNO": data.pan_no,
            "LEDGER": data.ledger_id,
            "LEDID": data.cash_bank_ledger_id,
            "HBID": data.hb_id,
            **data.extra_fields,
        },
        returning="DONRECID",
    )

    lines = data.lines or [DonationLine(amount=amount, seva_id=0, seva_name="DONATION")]
    for i, line in enumerate(lines, start=1):
        seva_name = line.seva_name
        if not seva_name:
            seva_name = (
                conn.execute(text("SELECT SVACODE FROM MstSVA WHERE SVAID = :id"), {"id": line.seva_id}).scalar()
                if line.seva_id
                else None
            ) or "DONATION"
        insert_row(
            conn,
            "TrnDtlDONREC",
            {
                "DONRECID": donrec_id,
                "SlNo": i,
                "ItemSlNO": i,
                "ShortClosed": "N",
                "ShortClosedBy": 0,
                "AMOUNT": round(line.amount, 2),
                "SEVAID": line.seva_id or 0,
                "SEVANME": seva_name,
            },
        )

    r = receipt_service.create_receipt(
        conn,
        fy=fy,
        prefix=data.prefix,
        receipt_date=data.doc_date,
        amount=amount,
        vch_type="Cash" if data.payment_mode.upper() == "CASH" else "Bank",
        narration=doc_no,
        cr_led_id=data.ledger_id,
        dr_led_id=data.cash_bank_ledger_id,
        user_code=user_code,
    )

    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="A", user_code=user_code, details=doc_no)
    return {"donrec_id": donrec_id, "donrec_no": doc_no, "print_no": print_no, "total_amt": amount, "receipt_no": r.receipt_no}


def lookup_donor(conn: Connection, *, contact_no: str) -> dict | None:
    """Port of the legacy 'Show Donor' recurring-donor auto-fill — last non-cancelled donation for this contact number."""
    from app.core.db import limit_clause

    row = conn.execute(
        text(
            f"""
            SELECT DONOR, ADDRESS, PANNO
            FROM TrnHdrDONREC
            WHERE Cancelled = 'N' AND CONTACTNO = :contact_no
            ORDER BY DONRECID DESC {limit_clause(1)}
            """
        ),
        {"contact_no": contact_no},
    ).mappings().first()
    return dict(row) if row else None


def get(conn: Connection, donrec_id: int) -> dict:
    row = conn.execute(text("SELECT * FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation Receipt not found")
    out = dict(row)
    out["lines"] = [dict(r) for r in conn.execute(text("SELECT SEVAID, SEVANME, AMOUNT FROM TrnDtlDONREC WHERE DONRECID = :i ORDER BY SlNo"), {"i": donrec_id}).mappings().all()]
    return out


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = """
        SELECT h.DONRECID, h.DONRECNO, h.PrintDONRECNO, h.DONRECDate, h.DONOR, h.CONTACTNO, h.TOTAMT, h.Cancelled
        FROM TrnHdrDONREC h
        WHERE h.DONRECDate BETWEEN :fs AND :fe
    """
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (h.DONRECNO LIKE :q OR h.DONOR LIKE :q OR h.CONTACTNO LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY h.DONRECID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def cancel(conn: Connection, *, donrec_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT DONRECNO, Cancelled FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation Receipt not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")

    update_row(conn, "TrnHdrDONREC", "DONRECID", donrec_id, {"Cancelled": "Y"})
    receipt_service.void_receipt_by_narr(conn, row["DONRECNO"], reverse_ledger=True)
    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, donrec_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT DONRECNO FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation Receipt not found")
    receipt_service.delete_receipt_by_narr(conn, row["DONRECNO"])
    conn.execute(text("DELETE FROM TrnDtlDONREC WHERE DONRECID = :id"), {"id": donrec_id})
    conn.execute(text("DELETE FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id})
    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="D", user_code=user_code)


def donor_history(conn: Connection, *, name: str = "", top: int = 0) -> list[dict]:
    """
    Show Donor (frmTrnDONREC.btnShowDonars_Click): earlier donation receipts (ShowRec='Y'), newest first, one row per
    detail line, optionally narrowed to donors starting with `name` and limited to the newest `top` rows.
    """
    from app.core.db import limit_clause

    sql = """
        SELECT h.DONRECID, h.DONRECNO, h.PrintDONRECNO, h.DONRECDate, h.DONOR, h.CONTACTNO, h.ADDRESS, h.REFNO, h.PANNO, d.SEVANME, d.SEVAID
        FROM TrnHdrDONREC h JOIN TrnDtlDONREC d ON h.DONRECID = d.DONRECID
        WHERE h.ShowRec = 'Y'
    """
    params: dict = {}
    if name.strip():
        sql += " AND h.DONOR LIKE :q"
        params["q"] = f"{name.strip()}%"
    sql += f" ORDER BY h.DONRECID DESC, h.DONOR {limit_clause(top if top > 0 else 500)}"
    return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def last_entry(conn: Connection) -> dict | None:
    """F6 in Add mode: the most recent receipt (max DONRECID) with its detail lines, to be re-entered."""
    last = conn.execute(text("SELECT MAX(DONRECID) FROM TrnHdrDONREC")).scalar()
    if not last:
        return None
    out = get(conn, int(last))
    out["lines"] = [dict(r) for r in conn.execute(text("SELECT SEVAID, SEVANME, AMOUNT FROM TrnDtlDONREC WHERE DONRECID = :i ORDER BY SlNo"), {"i": int(last)}).mappings().all()]
    return out
