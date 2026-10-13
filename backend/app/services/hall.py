"""
Hall Booking service — port of `frmTrnHBE` (doc 07 §5.5 / §6.4).

DocID 1281. Header table TrnHdrHB, occupancy table TrnST (one row per booked
day). Fixes D-04: the legacy overlap check only catches a NEW booking whose
whole date range falls INSIDE an existing one:

    WHERE h.Cancelled='N' AND HallID=@hall AND HbID<>@self
      AND @newFrom >= HBSTARTDT AND @newTo <= HBENDDT

This misses a new booking that STARTS before / ENDS after / CONTAINS an
existing one, or partially overlaps either edge. The correct interval-
overlap test (used here) is the standard:

    @newFrom <= HBENDDT AND @newTo >= HBSTARTDT

which catches every overlap case. See doc 09 finding + CLAUDE.md rule 9.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, update_row
from app.meta import numbering
from app.services import receipt as receipt_service
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1281
DONATION_DOC_ID = 1261
TABLE = "TrnHdrHB"
NO_COLUMN = "HBNO"
HALL_RECEIPT_PREFIX = "ANP"  # legacy hard-codes this for hall receipts


@dataclass
class HallBookingInput:
    booking_type: str  # 'HALL BOOKING' | 'CARPUS FUND'
    hall_id: int | None
    function_name: str | None
    start_at: datetime | None
    end_at: datetime | None
    start_time_text: str | None
    end_time_text: str | None
    contact_person: str | None
    contact_no: str
    mobile: str | None
    address: str | None
    email: str | None
    pan: str | None
    remarks: str | None
    amount: float
    cgst_pct: float = 0.0
    sgst_pct: float = 0.0
    deposit: float = 0.0
    ledger_id: int = 0
    cash_bank_ledger_id: int = 0
    doc_date: date | None = None
    # Fields the Designer tool adds to UtlDocDsgrFlds later that this
    # dataclass doesn't know about yet — keyed by FldCode. insert_row()
    # silently drops anything that isn't a real TrnHdrHB column.
    extra_fields: dict = field(default_factory=dict)


def _prefix_for(conn: Connection, booking_type: str) -> str:
    prefixes = numbering.resolve_prefix(conn, doc_id=DOC_ID, field_values={"TYPE": booking_type})
    if not prefixes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No prefix configured for booking type '{booking_type}'")
    return prefixes[0]


def check_availability(conn: Connection, *, hall_id: int, start_date: date, end_date: date, exclude_booking_id: int | None = None) -> bool:
    """
    True if the hall is FREE for [start_date, end_date] (inclusive). Uses the
    corrected overlap test — see module docstring.
    """
    sql = """
        SELECT COUNT(*) FROM TrnHdrHB h
        WHERE h.Cancelled = 'N' AND h.HALLID = :hall
          AND (:exclude IS NULL OR h.HBID <> :exclude)
          AND :new_from <= h.HBENDDT AND :new_to >= h.HBSTARTDT
    """
    count = conn.execute(
        text(sql), {"hall": hall_id, "exclude": exclude_booking_id, "new_from": start_date, "new_to": end_date}
    ).scalar_one()
    return count == 0


def availability_calendar(conn: Connection, *, hall_id: int, from_date: date, months: int = 6, to_date: date | None = None) -> list[dict]:
    """Returns one row per booked (non-cancelled) day in the window, for the calendar UI."""
    to_date = to_date or (from_date + timedelta(days=months * 31))
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT t.STAYDATE, h.HBID, h.PrintHBNO, h.NMEOFFUNC
            FROM TrnST t
            JOIN TrnHdrHB h ON h.HBID = t.HBID
            WHERE t.HALLID = :hall AND h.Cancelled = 'N'
              AND t.STAYDATE BETWEEN :fs AND :fe
            ORDER BY t.STAYDATE
            """
        ),
        {"hall": hall_id, "fs": from_date, "fe": to_date},
    ).mappings().all()
    return [dict(r) for r in rows]


def create(conn: Connection, *, data: HallBookingInput, fy: FinancialYear, user_code: str) -> dict:
    is_hall_booking = data.booking_type.upper() == "HALL BOOKING"

    # UtlDocDsgrFlds (DocID 1281, HALLID): FLdBlnHide='N', FldBlnMandatory='Y',
    # no compare value — unconditionally mandatory for BOTH booking types, not
    # just HALL BOOKING. (Verified against the 72 real HALL BOOKING rows: 0
    # blank HALLID. No real CARPUS FUND rows exist to cross-check, but the
    # metadata itself has no FldMndtryCompareVal, so there's no conditional to
    # honour.)
    if not data.hall_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name of the Hall / Room is mandatory")
    if is_hall_booking:
        if not data.start_at or not data.end_at:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Start Date and End Date are mandatory")
        if data.end_at.date() < data.start_at.date():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From Date Should be less than To Date...")
        if not check_availability(conn, hall_id=data.hall_id, start_date=data.start_at.date(), end_date=data.end_at.date()):
            raise HTTPException(status.HTTP_409_CONFLICT, "Booking Period Not Available.. Please check the List..")
    # UtlDocDsgrFlds (DocID 1281, CONTACTNO): FldBlnMandatory='Y',
    # FldMndtryCompareVal='#PAYMNETMODE#' <> 'CASH' — but '#PAYMNETMODE#' is a
    # typo in the metadata itself (the real FldCode/column is PAYMNTMODE, no
    # 'E'; confirmed via INFORMATION_SCHEMA — no PAYMNETMODE column exists on
    # TrnHdrHB). An unresolvable #FIELD# reference evaluates its value as
    # blank, so '' <> 'CASH' is always true — i.e. this rule is, in practice,
    # UNCONDITIONALLY mandatory. Confirmed against real data: 0 of 72 real
    # Hall Booking rows have a blank CONTACTNO, across every PAYMNTMODE
    # (Cash/Cheque/UPI) — including Cash, where a real conditional rule would
    # allow blanks. (Contrast with genuinely-optional fields on this same
    # table, e.g. EMAILID: 72/72 blank, PAN: 51/72 blank — so this isn't just
    # "staff fill in everything".) Do not make this conditional on payment
    # mode — that would NOT match live legacy behaviour.
    if not (data.contact_no or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Contact Number is mandatory")
    if data.amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    doc_date = data.doc_date or date.today()
    assert_date_in_fy(doc_date, fy)

    prefix = _prefix_for(conn, data.booking_type)
    doc_no = numbering.next_doc_no(
        conn, table_name=TABLE, no_column=NO_COLUMN, prefix=prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    print_no = numbering.print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)

    cgst_amt = round(data.amount * data.cgst_pct / 100, 2)
    sgst_amt = round(data.amount * data.sgst_pct / 100, 2)
    total_gst = round(cgst_amt + sgst_amt, 2)
    net_pay = round(data.amount + total_gst, 2)
    nod = (data.end_at.date() - data.start_at.date()).days + 1 if (is_hall_booking and data.start_at and data.end_at) else 0

    hb_id = insert_row(
        conn,
        TABLE,
        {
            NO_COLUMN: doc_no,
            "Prefix": prefix,
            "PrintHBNO": print_no,
            "HBDate": doc_date,
            "Authorised": "Y",
            "Cancelled": "N",
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "TYPE": data.booking_type,
            "HALLID": data.hall_id,
            "NMEOFFUNC": data.function_name,
            "HBSTARTDT": data.start_at.date() if data.start_at else None,
            "STTIME": data.start_time_text,
            "HBENDDT": data.end_at.date() if data.end_at else None,
            "ENDTIME": data.end_time_text,
            "CONPRS": data.contact_person,
            "CONTACTNO": data.contact_no,
            "MOBNO": data.mobile,
            "ADDRESS": data.address,
            "EMAILID": data.email,
            "PAN": data.pan,
            "RMKS": data.remarks,
            "AMOUNT": data.amount,
            "TOTAMT": data.amount,
            "CGSTPER": data.cgst_pct,
            "CGSTAMT": cgst_amt,
            "SGSTPER": data.sgst_pct,
            "SGSTAMT": sgst_amt,
            "TOTGSTAMT": total_gst,
            "AMTAFTTAX": net_pay,
            "NETPAY": net_pay,
            "SDEPAMT": data.deposit,
            "ADV": 0,
            "PMT2": 0,
            "FULLPAIDAMT": 0,
            "BALAMT": net_pay,
            "AMTINWORDS": amount_in_words(net_pay, "Rupees", "Paise"),
            "TOTAMTIWRDS": amount_in_words(data.amount, "Rupees", "Paise"),
            "ISSUEDBY": user_code,
            "NOD": nod,
            "LEDGER": data.ledger_id,
            "LEDID": data.cash_bank_ledger_id,
            **data.extra_fields,
        },
        returning="HBID",
    )

    if is_hall_booking:
        for i in range(nod):
            insert_row(conn, "TrnST", {"HALLID": data.hall_id, "HBID": hb_id, "STAYDATE": data.start_at.date() + timedelta(days=i)})

    audit.record(conn, entity="Hall Booking", entity_id=hb_id, action="A", user_code=user_code, details=doc_no)
    return {"hb_id": hb_id, "hb_no": doc_no, "print_no": print_no, "net_pay": net_pay, "balance": net_pay}


def get(conn: Connection, hb_id: int) -> dict:
    row = conn.execute(
        text(
            """
            SELECT h.*, ha.HALLNAME
            FROM TrnHdrHB h
            LEFT JOIN MstHALL ha ON ha.HALLID = h.HALLID
            WHERE h.HBID = :id
            """
        ),
        {"id": hb_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall booking not found")
    receipts = conn.execute(
        text("SELECT RCPTVCHID, RCPTVCHNO, PrintRCPTVCHNO, RCPTVCHDate, TOTCR, TOTDR, RCPTTYPE, VCHTYP, NARR, Cancelled FROM TrnHdrRCPTVCH WHERE HBID = :id ORDER BY RCPTVCHID"),
        {"id": hb_id},
    ).mappings().all()
    result = dict(row)
    result["receipts"] = [dict(r) for r in receipts]
    return result


@dataclass
class PaymentInput:
    amount: float
    mode: str  # Cash | UPI | Cheque | Card
    reference: str | None
    receipt_type: str  # ADV | Partial | Final
    ledger_id: int
    cash_bank_ledger_id: int
    receipt_date: date | None = None


def add_payment(conn: Connection, *, hb_id: int, data: PaymentInput, fy: FinancialYear, user_code: str) -> dict:
    booking = conn.execute(text("SELECT * FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id}).mappings().first()
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall booking not found")
    if (booking["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")

    balance = float(booking["BALAMT"] or 0)
    if data.amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Receipt Amt cannot be Zero!")
    if data.amount > balance + 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Receipt Amt cannot be greater than Pending Amt!")
    is_final_amount = abs(data.amount - balance) < 0.005
    if is_final_amount and data.receipt_type != "Final":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Receipt type should be Final if balance amt is completely selected!")
    if data.receipt_type == "Final" and not is_final_amount:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Receipt Amt should be equal to pending amt if receipt type is Final.")
    if not data.ledger_id or not data.cash_bank_ledger_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ledger name cannot be blank!")
    # UtlDocDsgrFlds (DocID 1281, REFNO — the ADV-stage reference number):
    # FldMndtryCompareVal='#PAYMNTMODE#' (this one's a real FldCode, no typo),
    # Operator='=', WithVal='UPI' — mandatory only for the advance (ADV)
    # payment when its mode is UPI. REFNO3 (Partial) and REF2 (Final) have no
    # such rule in the metadata (REFNO3's FldBlnMandatory='N'; REF2 has no
    # UtlDocDsgrFlds row at all), so this check is intentionally ADV-only.
    # Verified against real data: 13/13 real UPI advance payments on
    # TrnHdrHB have a non-blank REFNO; 0/57 Cash ones do (never required).
    if data.receipt_type == "ADV" and data.mode.upper() == "UPI" and not (data.reference or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Reference Number is mandatory for UPI payment")

    receipt_date = data.receipt_date or date.today()
    r = receipt_service.create_receipt(
        conn,
        fy=fy,
        prefix=HALL_RECEIPT_PREFIX,
        receipt_date=receipt_date,
        amount=data.amount,
        vch_type="Bank" if data.mode in ("Cheque", "UPI") else data.mode,
        narration=booking["HBNO"],
        cr_led_id=data.ledger_id,
        dr_led_id=data.cash_bank_ledger_id,
        hb_id=hb_id,
        rcpt_type=data.receipt_type,
        user_code=user_code,
    )

    updates: dict = {"BALAMT": round(balance - data.amount, 2)}
    if data.receipt_type == "ADV":
        updates["ADV"] = round(float(booking["ADV"] or 0) + data.amount, 2)
        updates["PAYMNTMODE"] = data.mode
        updates["REFNO"] = data.reference
    elif data.receipt_type == "Partial":
        updates["PMT2"] = round(float(booking["PMT2"] or 0) + data.amount, 2)
        updates["PAYMODE2"] = data.mode
        updates["REFNO3"] = data.reference
    else:  # Final
        updates["FULLPAIDAMT"] = round(float(booking["FULLPAIDAMT"] or 0) + data.amount, 2)
        updates["PAYMODE"] = data.mode
        updates["REF2"] = data.reference

    update_row(conn, "TrnHdrHB", "HBID", hb_id, updates)
    audit.record(conn, entity="Hall Booking Payment", entity_id=hb_id, action="A", user_code=user_code, details=f"{data.receipt_type} {data.amount}")
    return {"receipt_no": r.receipt_no, "balance": updates["BALAMT"]}


def cancel(conn: Connection, *, hb_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT HBNO, Cancelled FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall booking not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, "TrnHdrHB", "HBID", hb_id, {"Cancelled": "Y"})
    # Void every receipt linked to this booking (ADV/Partial/Final). All of them
    # share NARR = HBNO, so `void_receipt_by_narr` (which only touches rows still
    # Cancelled='N') is called once per open receipt — each call voids the next
    # remaining one, progressively covering all of them.
    open_count = conn.execute(
        text("SELECT COUNT(*) FROM TrnHdrRCPTVCH WHERE HBID = :id AND Cancelled = 'N'"), {"id": hb_id}
    ).scalar_one()
    for _ in range(open_count):
        receipt_service.void_receipt_by_narr(conn, row["HBNO"], reverse_ledger=True)
    audit.record(conn, entity="Hall Booking", entity_id=hb_id, action="C", user_code=user_code, details=reason)


def delete_receipt(conn: Connection, *, hb_id: int, receipt_id: int, user_code: str) -> dict:
    """
    Receipt Info > delete (frmTrnHBE.btnDelRec_Click): reverse what the receipt added to the booking, then remove the
    receipt voucher and its accounting rows. Same write-set as the legacy form, in one transaction.
    """
    rcpt = conn.execute(
        text("SELECT RCPTVCHID, RCPTVCHNO, TOTDR, RCPTTYPE FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :r AND HBID = :h"), {"r": receipt_id, "h": hb_id}
    ).mappings().first()
    if rcpt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt not found for this booking")
    booking = conn.execute(text("SELECT * FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id}).mappings().first()
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall booking not found")
    amt = float(rcpt["TOTDR"] or 0)
    kind = (rcpt["RCPTTYPE"] or "").strip().upper()
    updates: dict = {"BALAMT": round(float(booking["BALAMT"] or 0) + amt, 2)}
    if kind == "ADV":
        updates.update({"ADV": round(float(booking["ADV"] or 0) - amt, 2), "PAYMNTMODE": "", "REFNO": ""})
    elif kind == "PARTIAL":
        updates.update({"PMT2": round(float(booking["PMT2"] or 0) - amt, 2), "PAYMODE2": "", "REFNO3": ""})
    else:
        updates.update({"FULLPAIDAMT": round(float(booking["FULLPAIDAMT"] or 0) - amt, 2), "PAYMODE": "", "REF2": ""})
    update_row(conn, "TrnHdrHB", "HBID", hb_id, updates)
    conn.execute(text("DELETE FROM TrnHdrRCPTVCH WHERE RCPTVCHID = :r"), {"r": receipt_id})
    conn.execute(text("DELETE FROM TrnDtlRCPTVCH WHERE RCPTVCHID = :r"), {"r": receipt_id})
    acc = conn.execute(text("SELECT AccID FROM TrnHdrACC WHERE TrnID = :r AND DocType = 'RCPTVCH'"), {"r": receipt_id}).scalar()
    if acc:
        for tbl in ("TrnHdrACC", "TrnDtlACC", "TrnDtlACCAdj"):
            conn.execute(text(f"DELETE FROM {tbl} WHERE AccID = :a"), {"a": acc})
    audit.record(conn, entity="Hall Booking Receipt", entity_id=hb_id, action="D", user_code=user_code, details=f"{rcpt['RCPTVCHNO']} {amt}")
    return {"balance": updates["BALAMT"]}


def booking_options(conn: Connection) -> list[dict]:
    """
    Options menu entries of the Hall Booking screen besides its print formats (UtlOption): Receipt Info, and one
    "Donation for <prefix>" per document-number prefix of the Donation Receipt document (legacy: NMM / SLV).
    """
    from app.meta.numbering import resolve_prefix

    opts = [{"name": "Receipt Info", "label": "Receipt Info", "kind": "receipt-info"}]
    for prefix in resolve_prefix(conn, doc_id=DONATION_DOC_ID, field_values={}):
        opts.append({"name": f"Donation for {prefix}", "label": f"Donation for {prefix}", "kind": "donation", "prefix": prefix})
    return opts
