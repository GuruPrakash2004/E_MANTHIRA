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

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, table, update_row, pad_blanks
from app.meta import doc_rules, edit_rules, numbering
from app.services import ledger, receipt as receipt_service
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1281
DONATION_DOC_ID = 1261
TABLE = "TrnHdrHB"
NO_COLUMN = "HBNO"
HALL_RECEIPT_PREFIX = "ANP"  # legacy hard-codes this for hall receipts


@dataclass
class HallBookingInput:
    """The Designer fields of the Hall Booking document keyed by FldCode (TYPE, HALLID, HBSTARTDT, HBENDDT, AMOUNT,
    CGSTPER ... — whichever this temple's UtlDocDsgrFlds defines) plus the document date."""

    fields: dict
    doc_date: date | None = None


# Calculated here (or owned by the payment flow): whatever the browser sends for them is ignored.
COMPUTED = (
    "TOTAMT", "CGSTAMT", "SGSTAMT", "TOTGSTAMT", "AMTAFTTAX", "NETPAY", "BALAMT", "NOD",
    "ADV", "PMT2", "FULLPAIDAMT", "AMTINWORDS", "TOTAMTIWRDS", "ISSUEDBY",
)


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Amounts and percentages must be numbers")


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


# Set by the payment flow (Receipt Info), never by the booking form: an edit leaves them as they are.
PAYMENT_OWNED = ("PAYMNTMODE", "REFNO", "PAYMODE2", "REFNO3", "PAYMODE", "REF2", "PAYMODFH", "CASHCHEQ", "RCPDT", "BANK")


@dataclass
class _Prepared:
    rows: list
    values: dict
    booking_type: str
    hall_id: int
    start: date | None
    end: date | None
    amount: float
    cgst_amt: float
    sgst_amt: float
    total_gst: float
    net_pay: float
    nod: int


def _prepare(conn: Connection, data: HallBookingInput, fy: FinancialYear, *, exclude_id: int | None = None) -> _Prepared:
    """Everything a save needs that does not depend on the document number: Designer rules, the legacy date / overlap
    checks and the amounts. `exclude_id` is the booking being edited (it must not clash with itself)."""
    rows = doc_rules.load_fields(conn, DOC_ID)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Hall Booking has no fields configured in the Doc Designer")
    values = doc_rules.effective_values(rows, {k: v for k, v in data.fields.items() if k not in COMPUTED})
    doc_rules.validate(rows, values, skip=COMPUTED, fy=fy)

    booking_type = str(values.get("TYPE") or "HALL BOOKING")
    is_hall_booking = booking_type.upper() == "HALL BOOKING"
    hall_id = int(values.get("HALLID") or 0)
    start = doc_rules._to_date(values["HBSTARTDT"]) if values.get("HBSTARTDT") else None
    end = doc_rules._to_date(values["HBENDDT"]) if values.get("HBENDDT") else None
    amount = _num(values.get("AMOUNT"))

    if is_hall_booking:
        if not hall_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name of the Hall / Room is mandatory")
        if not start or not end:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Start Date and End Date are mandatory")
    if start and end and end < start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From Date Should be less than To Date...")
    # legacy: every type except CARPUS FUND is checked against the hall's other bookings (self excluded when editing)
    if booking_type.upper() != "CARPUS FUND" and hall_id and start and end:
        if not check_availability(conn, hall_id=hall_id, start_date=start, end_date=end, exclude_booking_id=exclude_id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Booking Period Not Available.. Please check the List..")
    if amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")

    cgst_amt = round(amount * _num(values.get("CGSTPER")) / 100, 2)
    sgst_amt = round(amount * _num(values.get("SGSTPER")) / 100, 2)
    total_gst = round(cgst_amt + sgst_amt, 2)
    net_pay = round(amount + total_gst, 2)
    nod = (end - start).days + 1 if (hall_id and start and end) else 0
    return _Prepared(rows, values, booking_type, hall_id, start, end, amount, cgst_amt, sgst_amt, total_gst, net_pay, nod)


def _stay_rows(conn: Connection, hb_id: int, p: _Prepared) -> None:
    """TrnST: one row per booked day (legacy SaveDoc deletes and re-inserts them on every save)."""
    conn.execute(text("DELETE FROM TrnST WHERE HBID = :id"), {"id": hb_id})
    for i in range(p.nod):
        insert_row(conn, "TrnST", {"HALLID": p.hall_id, "HBID": hb_id, "STAYDATE": p.start + timedelta(days=i)})


def _amount_cols(p: _Prepared) -> dict:
    return {
        "AMOUNT": p.amount, "TOTAMT": p.amount, "CGSTAMT": p.cgst_amt, "SGSTAMT": p.sgst_amt, "TOTGSTAMT": p.total_gst,
        "AMTAFTTAX": p.net_pay, "NETPAY": p.net_pay,
        "AMTINWORDS": amount_in_words(p.net_pay, "Rupees", "Paise"),
        "TOTAMTIWRDS": amount_in_words(p.amount, "Rupees", "Paise"),
        "NOD": p.nod,
    }


def create(conn: Connection, *, data: HallBookingInput, fy: FinancialYear, user_code: str) -> dict:
    p = _prepare(conn, data, fy)
    doc_date = data.doc_date or date.today()
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        doc_date = date.today()  # AllowEditDocDate = 'N': the legacy form locks the date to the system date
    assert_date_in_fy(doc_date, fy)

    prefix = _prefix_for(conn, p.booking_type)
    doc_no = numbering.next_doc_no(
        conn, table_name=TABLE, no_column=NO_COLUMN, prefix=prefix,
        fy_start_year=fy.start_year, fy_start_date=fy.start_date.isoformat(), fy_end_date=fy.end_date.isoformat(),
    )
    print_no = numbering.print_doc_no(conn, doc_id=DOC_ID, doc_no=doc_no, prefix=prefix, fy_start_year=fy.start_year, fy_end_year=fy.end_year)

    cols = doc_rules.column_values(p.rows, p.values, table(TABLE))
    cols.update(
        {
            NO_COLUMN: doc_no, "Prefix": prefix, "PrintHBNO": print_no, "HBDate": doc_date,
            "Authorised": edit_rules.authorised_on_save(conn, DOC_ID), "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
            "ADV": 0, "PMT2": 0, "FULLPAIDAMT": 0, "BALAMT": p.net_pay, "ISSUEDBY": user_code,
            **_amount_cols(p),
        }
    )
    pad_blanks(cols)
    hb_id = insert_row(conn, TABLE, cols, returning="HBID")
    _stay_rows(conn, hb_id, p)

    audit.record(conn, entity="Hall Booking", entity_id=hb_id, action="A", user_code=user_code, details=doc_no)
    return {"hb_id": hb_id, "hb_no": doc_no, "print_no": print_no, "net_pay": p.net_pay, "balance": p.net_pay}


def update(conn: Connection, *, hb_id: int, data: HallBookingInput, fy: FinancialYear, user_code: str) -> dict:
    """
    Edit a saved booking (legacy Mode "M"). The bill number, prefix and who/when it was added stay as they are; the header,
    the amounts and the booked days are rewritten. Payments already received (ADV / PMT2 / FULLPAIDAMT and their modes /
    references) are the payment flow's and are kept; the balance is the new net less what has been received.
    """
    old = conn.execute(text("SELECT * FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id}).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall booking not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=old["HBDate"], authorised=old["Authorised"])

    p = _prepare(conn, data, fy, exclude_id=hb_id)
    received = round(float(old["ADV"] or 0) + float(old["PMT2"] or 0) + float(old["FULLPAIDAMT"] or 0), 2)
    if p.net_pay + 0.005 < received:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The net amount cannot be less than the amount already received (Rs. {received:.2f}). Delete a receipt first")

    cols = doc_rules.column_values(p.rows, p.values, table(TABLE))
    # computed here (set again below) or owned by the payment flow: the generic column writer would blank them
    for k in [c for c in cols if c.upper() in PAYMENT_OWNED or c.upper() in COMPUTED or c.upper() == "BALAMT"]:
        cols.pop(k)
    cols.update({**_amount_cols(p), "BALAMT": round(p.net_pay - received, 2), "ChangedBy": user_code, "ChangedOn": datetime.now()})
    if edit_rules.doc_date_editable(conn, DOC_ID) and data.doc_date:
        assert_date_in_fy(data.doc_date, fy)
        cols["HBDate"] = data.doc_date
    if edit_rules.auth_required(conn, DOC_ID):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation (legacy: Authorised = 'N' on edit)
    pad_blanks(cols)
    update_row(conn, TABLE, "HBID", hb_id, cols)
    _stay_rows(conn, hb_id, p)

    audit.record(conn, entity="Hall Booking", entity_id=hb_id, action="E", user_code=user_code, details=old["HBNO"])
    return {"hb_id": hb_id, "hb_no": old["HBNO"], "print_no": old["PrintHBNO"] or old["HBNO"], "net_pay": p.net_pay, "balance": round(p.net_pay - received, 2)}


def delete(conn: Connection, *, hb_id: int, user_code: str) -> None:
    """Legacy delete: not for a cancelled booking, and not while receipts are linked to it."""
    row = conn.execute(text("SELECT HBNO, HBDate, Cancelled, Authorised FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hall booking not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Deletion not possible!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=row["HBDate"], authorised=row["Authorised"])
    if conn.execute(text("SELECT TOP 1 1 FROM TrnHdrRCPTVCH WHERE HBID = :id"), {"id": hb_id}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Already exist in Linked document. Deletion not possible.")
    conn.execute(text("DELETE FROM TrnST WHERE HBID = :id"), {"id": hb_id})
    conn.execute(text("DELETE FROM TrnHdrHB WHERE HBID = :id"), {"id": hb_id})
    audit.record(conn, entity="Hall Booking", entity_id=hb_id, action="D", user_code=user_code, details=row["HBNO"])


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
        raise HTTPException(status.HTTP_409_CONFLICT, "Document Is already cancelled")

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
    ledger.delete_posting(conn, doc_type="RCPTVCH", trn_no=rcpt["RCPTVCHNO"], trn_id=receipt_id)  # every posting of the receipt, reversals included
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
