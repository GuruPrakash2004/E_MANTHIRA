"""
Split payment for Seva Entry and Donation Receipt: one bill paid in parts by different modes (2000 = 1200 CASH + 800 UPI).

* The parts live in the NEW table `WebSplitPayment` (tools/create_split_payment.sql); no existing table or column changes.
* The bill header keeps one real mode so the legacy EXE and the original .rpt receipts keep working: the main part (the
  largest amount; the first on a tie) supplies Payment / Cash-or-Bank account / Voucher type / Reference no (and the cheque
  fields for a cheque).
* The auto receipt voucher gets one debit line per part (each part's cash / bank ledger) and one credit line for the income
  ledger, so the books are exact per mode (`receipt.create_receipt(dr_parts=...)`).
* Where the table does not exist, the feature is simply unavailable (`available()`), nothing is created by the app.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import capabilities

TABLE = "WebSplitPayment"
MIN_PARTS = 2

# document type -> where its payment lives
DOCS = {
    "SEVA": {"doc_id": 1263, "hdr": "TrnHdrSEVA", "mode": "PAYMENT", "cheque": ("CHQNO", "CHQDATE", "BANKNAME"), "vch": "VCHTYP"},
    "DONREC": {"doc_id": 1261, "hdr": "TrnHdrDONREC", "mode": "PAYMNTMODE", "cheque": ("CHEQUENO", "CHEQUEDATE", "BANKNAME"), "vch": None},
}
_VCH_FALLBACK = {"CASH": "Cash", "UPI": "Bank", "CARD": "Card", "CHEQUE": "Bank"}


@dataclass
class SplitPart:
    mode: str
    amount: float
    led_id: int  # MstLed.LEDID of the cash / bank account debited for this part
    ref_no: str = ""
    chq_date: date | None = None
    bank_name: str = ""


def available() -> bool:
    return capabilities.has_table(TABLE)


def _cfg(doc_type: str) -> dict:
    if doc_type not in DOCS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown document type for split payment")
    return DOCS[doc_type]


def designer_modes(conn: Connection, doc_type: str) -> list[str]:
    """The payment modes the document's Designer offers (`CASH|CARD|CHEQUE|UPI`), exactly as the temple wrote them."""
    cfg = _cfg(doc_type)
    raw = conn.execute(
        text("SELECT FldNumStringListContent FROM UtlDocDsgrFlds WHERE DocID = :d AND FldCode = :c"), {"d": cfg["doc_id"], "c": cfg["mode"]}
    ).scalar()
    return [m.strip() for m in str(raw or "").split("|") if m.strip()]


def _canonical_mode(conn: Connection, doc_type: str, mode: str) -> str:
    for m in designer_modes(conn, doc_type):
        if m.upper() == (mode or "").strip().upper():
            return m
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"'{mode}' is not a payment mode of this document")


def defaults(conn: Connection, doc_type: str) -> dict:
    """Per payment mode: the cash / bank account most often used with it in this temple's own bills (what the clerk would pick)."""
    cfg = _cfg(doc_type)
    out: dict = {}
    for mode in designer_modes(conn, doc_type):
        row = conn.execute(
            text(
                f"SELECT TOP 1 h.LEDID, l.LEDNAME FROM {cfg['hdr']} h JOIN MstLed l ON l.LEDID = h.LEDID "
                f"WHERE UPPER({cfg['mode']}) = :m AND h.LEDID > 0 GROUP BY h.LEDID, l.LEDNAME ORDER BY COUNT(*) DESC"
            ),
            {"m": mode.upper()},
        ).first()
        out[mode] = {"led_id": int(row[0]), "label": str(row[1])} if row else None
    return out


def vch_type_for(conn: Connection, doc_type: str, mode: str) -> str:
    """The Voucher type (Cash / Bank / Card) the temple uses for that mode, from its own bills; a sensible default otherwise."""
    cfg = _cfg(doc_type)
    if cfg["vch"] and capabilities.has_col(cfg["hdr"], cfg["vch"]):
        row = conn.execute(
            text(f"SELECT TOP 1 {cfg['vch']} FROM {cfg['hdr']} WHERE UPPER({cfg['mode']}) = :m AND {cfg['vch']} IS NOT NULL GROUP BY {cfg['vch']} ORDER BY COUNT(*) DESC"),
            {"m": mode.upper()},
        ).scalar()
        if row and str(row).strip().title() in ("Cash", "Bank", "Card"):
            return str(row).strip().title()
    return _VCH_FALLBACK.get(mode.upper(), "Cash")


def validate(conn: Connection, doc_type: str, parts: list[SplitPart], total: float, income_led_id: int) -> list[SplitPart]:
    """Check the parts against the bill and return them with the mode spelled the way the Designer lists it."""
    if not available():
        raise HTTPException(status.HTTP_409_CONFLICT, "Split payment is not available in this database")
    if len(parts) < MIN_PARTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A split payment needs at least two parts")
    out: list[SplitPart] = []
    for i, p in enumerate(parts, start=1):
        if round(float(p.amount), 2) <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Split part {i}: Please Enter Amount Greater than 0")
        if not p.led_id or conn.execute(text("SELECT 1 FROM MstLed WHERE LEDID = :i AND ISNULL(InActive, 'N') <> 'Y'"), {"i": p.led_id}).first() is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Split part {i}: choose an active Cash or Bank Account")
        if int(p.led_id) == int(income_led_id):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Split part {i}: the Ledger Name (income) and the Cash or Bank Account are the same ledger - choose a different Cash or Bank Account.",
            )
        out.append(SplitPart(_canonical_mode(conn, doc_type, p.mode), round(float(p.amount), 2), int(p.led_id), (p.ref_no or "").strip(), p.chq_date, (p.bank_name or "").strip()))
    paid = round(sum(p.amount for p in out), 2)
    if abs(paid - round(float(total), 2)) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The split amounts ({paid:,.2f}) must add up to the bill total ({round(float(total), 2):,.2f})")
    return out


def main_part(parts: list[SplitPart]) -> SplitPart:
    return max(parts, key=lambda p: p.amount)  # max() keeps the first of equal amounts


def apply_main(conn: Connection, doc_type: str, parts: list[SplitPart], fields: dict) -> None:
    """Let the bill header carry the main part, so the legacy EXE and the original receipt see one ordinary payment."""
    cfg = _cfg(doc_type)
    main = main_part(parts)
    mode = _canonical_mode(conn, doc_type, main.mode)
    fields[cfg["mode"]] = mode
    fields["LEDID"] = main.led_id
    if cfg["vch"]:
        fields[cfg["vch"]] = vch_type_for(conn, doc_type, mode)
    fields["REFNO"] = main.ref_no
    no, dt_, bank = cfg["cheque"]
    if mode.upper() == "CHEQUE":
        fields[no], fields[bank] = main.ref_no, main.bank_name
        if main.chq_date:
            fields[dt_] = main.chq_date.isoformat()
    # a split bill is not entered through the single-payment fields: drop whatever the form had in the other mode's boxes
    elif mode.upper() != "CHEQUE":
        for k in (no, dt_, bank):
            fields.pop(k, None)


def save(conn: Connection, doc_type: str, doc_id: int, parts: list[SplitPart], user_code: str) -> None:
    delete(conn, doc_type, doc_id)
    for i, p in enumerate(parts, start=1):
        conn.execute(
            text(
                f"INSERT INTO {TABLE} (DocType, DocID, SlNo, PayMode, Amount, CashBankLedID, RefNo, ChqDate, BankName, AddedBy, AddedOn) "
                "VALUES (:t, :d, :n, :m, :a, :l, :r, :c, :b, :u, :now)"
            ),
            {"t": doc_type, "d": doc_id, "n": i, "m": p.mode, "a": p.amount, "l": p.led_id, "r": p.ref_no or None, "c": p.chq_date, "b": p.bank_name or None, "u": user_code, "now": datetime.now()},
        )


def load(conn: Connection, doc_type: str, doc_id: int) -> list[dict]:
    if not available():
        return []
    rows = conn.execute(
        text(
            f"SELECT s.SlNo, s.PayMode, s.Amount, s.CashBankLedID, l.LEDNAME, s.RefNo, s.ChqDate, s.BankName FROM {TABLE} s "
            "LEFT JOIN MstLed l ON l.LEDID = s.CashBankLedID WHERE s.DocType = :t AND s.DocID = :d ORDER BY s.SlNo"
        ),
        {"t": doc_type, "d": doc_id},
    ).mappings().all()
    return [
        {"mode": r["PayMode"], "amount": float(r["Amount"]), "led_id": int(r["CashBankLedID"]), "led_label": r["LEDNAME"] or "",
         "ref_no": r["RefNo"] or "", "chq_date": r["ChqDate"].date().isoformat() if r["ChqDate"] else None, "bank_name": r["BankName"] or ""}
        for r in rows
    ]


def delete(conn: Connection, doc_type: str, doc_id: int) -> None:
    if available():
        conn.execute(text(f"DELETE FROM {TABLE} WHERE DocType = :t AND DocID = :d"), {"t": doc_type, "d": doc_id})


def dr_parts(parts: list[SplitPart] | None) -> list[tuple[int, float]] | None:
    return [(p.led_id, p.amount) for p in parts] if parts else None
