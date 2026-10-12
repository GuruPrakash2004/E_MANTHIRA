"""
Payment Voucher service — port of `frmTrnVch` (Payment variant, DocID 1224).

Legacy screen (doc 07 §5.6) is a full Dr/Cr GRID — any number of account-head
lines, each independently Dr or Cr, not a fixed "one ledger paid, one cash/
bank ledger" pair. Previously hardcoded to exactly 2 lines (caught 2026-09-29
against a client complaint that the web app doesn't match the Windows app);
`lines` now accepts any number, same "Debit and Credit totals are NOT
matching!" balance rule the legacy form enforces.
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
from app.meta.numbering import next_doc_no
from app.services import ledger
from app.utils.amount_in_words import amount_in_words

DOC_ID = 1224
TABLE = "TrnHdrPMTVCH"
NO_COLUMN = "PMTVCHNO"


@dataclass
class VoucherLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


@dataclass
class PaymentVoucherInput:
    prefix: str
    voucher_date: date
    vch_type: str  # Cash|Bank|Card
    narration: str
    lines: list[VoucherLine]
    # UtlDocDsgrFlds (DocID 1224): all hidden unless VCHTYP=Bank (cheque_dd_no,
    # cheque_date, cheque_dd_amt [CHQAMT is varchar in the real schema, not
    # numeric — kept as str], cheque_no, bank_id [BANK is an int FK to
    # MstBANK, confirmed via INFORMATION_SCHEMA/FldCmbTblName]) or VCHTYP=Card
    # (card_no, card_amt) — the legacy frmTrnVch's bank/card detail fields,
    # previously never collected (hardcoded to blank/zero placeholders).
    cheque_dd_no: str | None = None
    cheque_date: date | None = None
    cheque_dd_amt: str | None = None
    cheque_no: str | None = None
    bank_id: int | None = None
    card_no: str | None = None
    card_amt: float | None = None
    extra_fields: dict = field(default_factory=dict)


def validate(data: PaymentVoucherInput, fy: FinancialYear) -> None:
    assert_date_in_fy(data.voucher_date, fy)
    if len(data.lines) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least two account-head lines are required")
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)
    if total_dr <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter Amount Greater than 0")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Debit and Credit totals are NOT matching!")
    if not (data.narration or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Narration should not be blank!")


def create(conn: Connection, *, data: PaymentVoucherInput, fy: FinancialYear, user_code: str) -> dict:
    validate(data, fy)

    doc_no = next_doc_no(
        conn,
        table_name=TABLE,
        no_column=NO_COLUMN,
        prefix=data.prefix,
        fy_start_year=fy.start_year,
        fy_start_date=fy.start_date.isoformat(),
        fy_end_date=fy.end_date.isoformat(),
    )
    total_dr = round(sum(l.dr_amt for l in data.lines), 2)
    total_cr = round(sum(l.cr_amt for l in data.lines), 2)

    pmt_id = insert_row(
        conn,
        TABLE,
        {
            NO_COLUMN: doc_no,
            "Prefix": data.prefix,
            "PrintPMTVCHNO": doc_no,
            "PMTVCHDate": data.voucher_date,
            "AddedBy": user_code,
            "AddedOn": datetime.now(),
            "Authorised": "Y",
            "Cancelled": "N",
            "CHQDDNO": data.cheque_dd_no or " ",
            "CHQDT": data.cheque_date,
            "CHQAMT": data.cheque_dd_amt or " ",
            "CARDNO": data.card_no or "0",
            "CRDAMT": data.card_amt or 0,
            "CHQNO": data.cheque_no or " ",
            "BANK": data.bank_id or 0,
            "AMTINWORDS": amount_in_words(total_dr, "Rupees", "Paise"),
            "NARR": data.narration,
            "VCHTYP": data.vch_type,
            "TOTDR": total_dr,
            "TOTCR": total_cr,
            **data.extra_fields,
        },
        returning="PMTVCHID",
    )

    for i, line in enumerate(data.lines, start=1):
        insert_row(
            conn,
            "TrnDtlPMTVCH",
            {
                "PMTVCHID": pmt_id,
                "SlNo": i,
                "AcLedID": line.ac_led_id,
                "PMTVCHAmt": line.dr_amt or line.cr_amt,
                "CrAmt": line.cr_amt,
                "DrAmt": line.dr_amt,
                "AmtType": "DR" if line.dr_amt else "CR",
                "AgRefAmt": 0,
                "NewRefAmt": 0,
            },
        )

    ledger.post(
        conn,
        doc_type="PMTVCH",
        trn_id=pmt_id,
        trn_no=doc_no,
        trn_date=data.voucher_date,
        due_date=data.voucher_date,
        narration=data.narration,
        lines=[
            ledger.JournalLine(ac_led_id=ledger.acled_id_for_ledger(conn, l.ac_led_id), dr_amt=l.dr_amt, cr_amt=l.cr_amt)
            for l in data.lines
        ],
    )

    audit.record(conn, entity="Payment Voucher", entity_id=pmt_id, action="A", user_code=user_code, details=doc_no)
    return {"pmtvch_id": pmt_id, "pmtvch_no": doc_no, "amount": total_dr}


def list_recent(conn: Connection, *, fy: FinancialYear, search: str = "", top: int = 50) -> list[dict]:
    from app.core.db import limit_clause

    sql = "SELECT PMTVCHID, PMTVCHNO, PrintPMTVCHNO, PMTVCHDate, NARR, TOTDR, Cancelled FROM TrnHdrPMTVCH WHERE PMTVCHDate BETWEEN :fs AND :fe"
    params: dict = {"fs": fy.start_date, "fe": fy.end_date}
    if search:
        sql += " AND (PMTVCHNO LIKE :q OR NARR LIKE :q)"
        params["q"] = f"%{search}%"
    sql += f" ORDER BY PMTVCHID DESC {limit_clause(top)}"
    rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def cancel(conn: Connection, *, pmtvch_id: int, reason: str, user_code: str) -> None:
    row = conn.execute(text("SELECT PMTVCHNO, PMTVCHDate, Cancelled FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment Voucher not found")
    if (row["Cancelled"] or "N").upper() == "Y":
        raise HTTPException(status.HTTP_409_CONFLICT, "Document is already cancelled")
    update_row(conn, "TrnHdrPMTVCH", "PMTVCHID", pmtvch_id, {"Cancelled": "Y"})
    ledger.reverse(conn, doc_type="PMTVCH", trn_no=row["PMTVCHNO"], trn_id=pmtvch_id, trn_date=row["PMTVCHDate"], narration=f"Cancelled: {row['PMTVCHNO']}")
    audit.record(conn, entity="Payment Voucher", entity_id=pmtvch_id, action="C", user_code=user_code, details=reason)


def delete(conn: Connection, *, pmtvch_id: int, user_code: str) -> None:
    row = conn.execute(text("SELECT PMTVCHNO FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment Voucher not found")
    ledger.delete_posting(conn, doc_type="PMTVCH", trn_no=row["PMTVCHNO"], trn_id=pmtvch_id)
    conn.execute(text("DELETE FROM TrnDtlPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id})
    conn.execute(text("DELETE FROM TrnHdrPMTVCH WHERE PMTVCHID = :id"), {"id": pmtvch_id})
    audit.record(conn, entity="Payment Voucher", entity_id=pmtvch_id, action="D", user_code=user_code)
