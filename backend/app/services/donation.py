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

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit, capabilities
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row, table, update_row
from app.meta import doc_rules, edit_rules, numbering
from app.services import receipt as receipt_service
from app.services import split_payment
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1261
TABLE = "TrnHdrDONREC"
NO_COLUMN = "DONRECNO"


@dataclass
class DonationInput:
    """What the entry screen submits: the document prefix and date, the Header/Footer Designer fields keyed by
    FldCode, and the detail lines (each keyed by the Detail-section FldCodes: SEVANME, SEVAID, AMOUNT ...)."""

    prefix: str
    doc_date: date
    fields: dict
    lines: list[dict]
    split: list | None = None  # split payment: [split_payment.SplitPart, ...]


SYSTEM_CODES = ("ISSUEDBY", "AMTINWORDS", "TOTAMT")  # computed here, never taken from the browser
HEADER_SECTIONS = ("Header", "Footer")


def _line_amount(line: dict) -> float:
    try:
        return round(float(line.get("AMOUNT") or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Line amount must be a number")


def validate(data: DonationInput, fy: FinancialYear, rows: list[dict], values: dict) -> float:
    """Checks the Designer's own rules; returns the total (sum of the line amounts)."""
    assert_date_in_fy(data.doc_date, fy)
    if not data.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add at least one line")
    head = [r for r in rows if (r.get("FldSection") or "Header") in HEADER_SECTIONS]
    doc_rules.validate(head, values, skip=SYSTEM_CODES, fy=fy)
    detail = [r for r in rows if r.get("FldSection") == "Detail"]
    doc_rules.check_duplicate_lines(detail, data.lines)
    for i, line in enumerate(data.lines, start=1):
        line_values = {**values, **line}
        try:
            doc_rules.validate(detail, line_values)
        except HTTPException as exc:
            raise HTTPException(exc.status_code, f"Line {i}: {exc.detail}")
    total = round(sum(_line_amount(l) for l in data.lines), 2)
    if total <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if "DONOR" in {r["FldCode"] for r in head} and not str(values.get("DONOR") or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Donor Name should not be blank!")
    return total


def _legacy_blanks(cols: dict) -> None:
    """The EXE stores a single space for a blank text column (DATALENGTH 1 on every legacy row) and NULL for "no cheque date"."""
    for k, v in list(cols.items()):
        if isinstance(v, str) and v == "" and k.upper() != "CHEQUEDATE":
            cols[k] = " "
    if not str(cols.get("CHEQUEDATE") or "").strip() or str(cols["CHEQUEDATE"]).startswith("1900-01-01"):
        cols["CHEQUEDATE"] = None


def _write_lines(conn: Connection, donrec_id: int, rows: list[dict], lines: list[dict]) -> None:
    detail = [r for r in rows if r.get("FldSection") == "Detail"]
    for i, line in enumerate(lines, start=1):
        lv = doc_rules.effective_values(detail, line)
        dcols = doc_rules.column_values(detail, lv, table("TrnDtlDONREC"))
        seva_id = int(line.get("SEVAID") or 0)  # may be a hidden column filled by "Show Donor"
        seva_name = str(lv.get("SEVANME") or "").strip()
        if not seva_name:
            seva_name = (conn.execute(text("SELECT SVACODE FROM MstSVA WHERE SVAID = :id"), {"id": seva_id}).scalar() if seva_id else None) or "DONATION"
        dcols.update(
            {"DONRECID": donrec_id, "SlNo": i, "ItemSlNO": i, "ShortClosed": "N", "ShortClosedBy": 0, "AMOUNT": _line_amount(line), "SEVAID": seva_id, "SEVANME": seva_name}
        )
        insert_row(conn, "TrnDtlDONREC", dcols)


def _post_receipt(conn: Connection, *, values: dict, data: DonationInput, fy: FinancialYear, amount: float, print_no: str, user_code: str) -> str | None:
    """The receipt voucher + GL posting needs the income ledger and the cash/bank account: they exist only when this
    temple's Designer defines the LEDGER / LEDID fields (some temples keep their accounts elsewhere)."""
    income, cash_bank = int(values.get("LEDGER") or 0), int(values.get("LEDID") or 0)
    if not (income and cash_bank):
        return None
    r = receipt_service.create_receipt(
        conn,
        fy=fy,
        prefix=data.prefix,
        receipt_date=data.doc_date,
        amount=amount,
        vch_type=str(values.get("PAYMNTMODE") or "").strip() or "Cash",  # the EXE copies the payment mode verbatim (CASH / UPI / CARD / CHEQUE), 22/22 legacy rows
        narration=print_no,  # the EXE puts the PRINT number (26/NMM/DR/00010) in the receipt's NARR, not DONRECNO
        cr_led_id=income,
        dr_led_id=cash_bank,
        user_code=user_code,
        dr_parts=split_payment.dr_parts(data.split),  # one debit line per payment part (None = the usual single cash / bank line)
    )
    return r.receipt_no


def create(conn: Connection, *, data: DonationInput, fy: FinancialYear, user_code: str) -> dict:
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.doc_date = date.today()  # AllowEditDocDate = 'N': the legacy form locks the date to the system date
    rows = doc_rules.load_fields(conn, DOC_ID)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Donation Receipt has no fields configured in the Doc Designer")
    if data.split:  # the header carries the main part (largest amount) so the legacy EXE sees one ordinary payment
        split_payment.apply_main(conn, "DONREC", data.split, data.fields)
    values = doc_rules.effective_values(rows, {k: v for k, v in data.fields.items() if k not in SYSTEM_CODES})
    amount = validate(data, fy, rows, values)
    if data.split:
        data.split = split_payment.validate(conn, "DONREC", data.split, amount, int(values.get("LEDGER") or 0))

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

    head = [r for r in rows if (r.get("FldSection") or "Header") in HEADER_SECTIONS]
    cols = doc_rules.column_values(head, values, table(TABLE))
    cols.update(
        {
            NO_COLUMN: doc_no,
            "Prefix": data.prefix,
            "PrintDONRECNO": print_no,
            "DONRECDate": data.doc_date,
            "Authorised": edit_rules.authorised_on_save(conn, DOC_ID),
            "Cancelled": "N",
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "TOTAMT": amount,
            "AMTINWORDS": amount_in_words(amount, "Rupees", "Paise"),
            "ISSUEDBY": user_code,
            "ShowRec": "Y",
        }
    )
    _legacy_blanks(cols)
    donrec_id = insert_row(conn, TABLE, cols, returning="DONRECID")
    if data.split:
        split_payment.save(conn, "DONREC", donrec_id, data.split, user_code)

    _write_lines(conn, donrec_id, rows, data.lines)
    receipt_no = _post_receipt(conn, values=values, data=data, fy=fy, amount=amount, print_no=print_no, user_code=user_code)

    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="A", user_code=user_code, details=doc_no)
    return {"donrec_id": donrec_id, "donrec_no": doc_no, "print_no": print_no, "total_amt": amount, "receipt_no": receipt_no}


def update(conn: Connection, *, donrec_id: int, data: DonationInput, fy: FinancialYear, user_code: str) -> dict:
    """
    Edit a saved donation receipt, the same way Seva's edit works: the document number (DONRECNO / Prefix / PrintDONRECNO) and who/when
    it was added stay as they are; the header, the lines, the split payment and the receipt voucher + GL are rewritten for the new
    values, all in the caller's one transaction.
    """
    old = conn.execute(
        text("SELECT DONRECNO, PrintDONRECNO, Prefix, Cancelled, DONRECDate, Authorised FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id}
    ).mappings().first()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation Receipt not found")
    if (old["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Current record is cancelled. Cannot edit!")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=old["DONRECDate"], authorised=old["Authorised"])
    if not edit_rules.doc_date_editable(conn, DOC_ID):
        data.doc_date = old["DONRECDate"].date() if isinstance(old["DONRECDate"], datetime) else old["DONRECDate"]  # date stays as saved
    data.prefix = old["Prefix"] if old["Prefix"] is not None else data.prefix  # the number was issued under this prefix

    rows = doc_rules.load_fields(conn, DOC_ID)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "Donation Receipt has no fields configured in the Doc Designer")
    if data.split:
        split_payment.apply_main(conn, "DONREC", data.split, data.fields)
    values = doc_rules.effective_values(rows, {k: v for k, v in data.fields.items() if k not in SYSTEM_CODES})
    amount = validate(data, fy, rows, values)
    if data.split:
        data.split = split_payment.validate(conn, "DONREC", data.split, amount, int(values.get("LEDGER") or 0))

    doc_no = old["DONRECNO"]
    print_no = old["PrintDONRECNO"] or doc_no
    head = [r for r in rows if (r.get("FldSection") or "Header") in HEADER_SECTIONS]
    cols = doc_rules.column_values(head, values, table(TABLE))
    # not touched on edit: the number, who added it and when, who issued it, and whether it shows in Show Donor
    for keep in (NO_COLUMN, "Prefix", "PrintDONRECNO", "AddedBy", "AddedOn", "ISSUEDBY", "ShowRec", "Cancelled"):
        cols.pop(keep, None)
    cols.update(
        {
            "DONRECDate": data.doc_date,
            "ChangedBy": user_code,
            "ChangedOn": datetime.now(),
            "TOTAMT": amount,
            "AMTINWORDS": amount_in_words(amount, "Rupees", "Paise"),
        }
    )
    if edit_rules.auth_required(conn, DOC_ID):
        cols["Authorised"] = "N"  # an edited document goes back for authorisation (legacy: Authorised = 'N' on edit)
    _legacy_blanks(cols)
    update_row(conn, TABLE, "DONRECID", donrec_id, cols)  # columns this database does not have are skipped by update_row

    conn.execute(text("DELETE FROM TrnDtlDONREC WHERE DONRECID = :id"), {"id": donrec_id})
    _write_lines(conn, donrec_id, rows, data.lines)

    if data.split:
        split_payment.save(conn, "DONREC", donrec_id, data.split, user_code)
    else:
        split_payment.delete(conn, "DONREC", donrec_id)  # the clerk turned the split off
    receipt_service.delete_receipt_by_narr(conn, _receipt_narr(conn, old))  # reverses the old GL posting; the new one is posted below
    receipt_no = _post_receipt(conn, values=values, data=data, fy=fy, amount=amount, print_no=print_no, user_code=user_code)

    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="E", user_code=user_code, details=doc_no)
    return {"donrec_id": donrec_id, "donrec_no": doc_no, "print_no": print_no, "total_amt": amount, "receipt_no": receipt_no}


def lookup_donor(conn: Connection, *, contact_no: str) -> dict | None:
    """Port of the legacy 'Show Donor' recurring-donor auto-fill — last non-cancelled donation for this contact number."""
    from app.core.db import limit_clause

    pan = capabilities.sel("TrnHdrDONREC", "TrnHdrDONREC", "PANNO")
    row = conn.execute(
        text(
            f"""
            SELECT DONOR, ADDRESS, {pan} AS PANNO
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
    out["split_payments"] = split_payment.load(conn, "DONREC", donrec_id)
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


def _receipt_narr(conn: Connection, row) -> str:
    """The NARR of this donation's receipt: the print number (legacy and current writes). Receipts written by earlier
    web builds used DONRECNO, which can equal a Seva number, so that form is only used when it is not a Seva's."""
    pn = row.get("PrintDONRECNO")
    if pn and conn.execute(text("SELECT TOP 1 1 FROM TrnHdrRCPTVCH WHERE NARR = :n"), {"n": pn}).first():
        return pn
    if conn.execute(text("SELECT TOP 1 1 FROM TrnHdrSEVA WHERE SEVANO = :n"), {"n": row["DONRECNO"]}).first():
        return pn or row["DONRECNO"]
    return row["DONRECNO"]


def cancel(conn: Connection, *, donrec_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT DONRECNO, PrintDONRECNO, Cancelled FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation Receipt not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")

    update_row(conn, "TrnHdrDONREC", "DONRECID", donrec_id, {"Cancelled": "Y"})
    receipt_service.void_receipt_by_narr(conn, _receipt_narr(conn, row), reverse_ledger=True)
    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, donrec_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT DONRECNO, PrintDONRECNO, DONRECDate, Authorised FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Donation Receipt not found")
    edit_rules.assert_editable(conn, DOC_ID, doc_date=row["DONRECDate"], authorised=row["Authorised"])
    receipt_service.delete_receipt_by_narr(conn, _receipt_narr(conn, row))
    split_payment.delete(conn, "DONREC", donrec_id)
    conn.execute(text("DELETE FROM TrnDtlDONREC WHERE DONRECID = :id"), {"id": donrec_id})
    conn.execute(text("DELETE FROM TrnHdrDONREC WHERE DONRECID = :id"), {"id": donrec_id})
    audit.record(conn, entity="Donation Receipt Entry", entity_id=donrec_id, action="D", user_code=user_code)


def donor_history(conn: Connection, *, name: str = "", top: int = 0) -> list[dict]:
    """
    Show Donor (frmTrnDONREC.btnShowDonars_Click): earlier donation receipts (ShowRec='Y'), newest first, one row per
    detail line, optionally narrowed to donors starting with `name` and limited to the newest `top` rows.
    """
    from app.core.db import limit_clause

    show = "AND h.ShowRec = 'Y'" if capabilities.has_col("TrnHdrDONREC", "ShowRec") else ""
    pan = capabilities.sel("TrnHdrDONREC", "h", "PANNO")
    sql = f"""
        SELECT h.DONRECID, h.DONRECNO, h.PrintDONRECNO, h.DONRECDate, h.DONOR, h.CONTACTNO, h.ADDRESS, h.REFNO, {pan} AS PANNO, d.SEVANME, d.SEVAID
        FROM TrnHdrDONREC h JOIN TrnDtlDONREC d ON h.DONRECID = d.DONRECID
        WHERE 1 = 1 {show}
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
