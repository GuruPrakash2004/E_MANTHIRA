"""
Bill-wise adjustment of a voucher line (legacy `frmTrnVchPend`, opened by `frmTrnVch.showPendVch`).

When a voucher line's head is a customer / supplier / journal party (MstAcLed.LedType C, S or J) and the document has
`UtlTransactions.BillWiseFeatureReq = 'Y'`, entering the line's amount opens the "Bill wise Adjustment" window: the party's
pending bills (the stored procedure `mSP_GetPendBills`) are ticked off against the amount; what is left is either
"On-Account" (nothing stored) or a "New-Reference" (a new open item that later vouchers can be adjusted against).

What the legacy form writes (UpdtVchHdr / UpdtDocAdjDtl / GetDetSqlString), reproduced by `write()`:
  * `TrnDtlAccAdj`  (AccID = the voucher's posting, AcLedID, DrAmt | CrAmt, AdjAgnstAccID, AdjType 'A' | 'N', NewRefNo)
                    one row per bill adjusted ('A', against that bill's AccID) and one for a new reference ('N', against 0)
  * `<detail>BillDet` (<id>, AcLedID, AccID = the bill's AccID (0 for a new reference), AdjAmt, AdjType 'A')
  * the detail line's AgRefAmt (sum of the adjusted amounts) and NewRefAmt.
The sign of a stored adjustment is the sign of the *bill's* balance (a Dr payment against a Cr purchase voucher is stored as a Cr).
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.capabilities import has_table

PARTY_TYPES = ("C", "S", "J")  # legacy showPendVch: customer, supplier, journal party


def _money(v) -> float:
    return round(float(v or 0), 2)


def own_acc_id(conn: Connection, doc_type: str, voucher_id: int) -> int:
    return int(conn.execute(text("SELECT TOP 1 AccID FROM TrnHdrAcc WHERE DocType = :d AND TrnID = :i"), {"d": doc_type, "i": voucher_id}).scalar() or 0)


def pending_bills(conn: Connection, *, ac_led_id: int, side: str, own_acc: int = 0) -> list[dict]:
    """The party's open items for the window (legacy mSP_GetPendBills): Dr lines list what is owed *to* the party, Cr lines what the party owes.
    `own_acc` leaves out the voucher being edited, so its own adjustments do not count against the bills."""
    rows = conn.execute(
        text("SET NOCOUNT ON; EXEC mSP_GetPendBills @AcLedID = :l, @AccID = :a, @AcType = :t"),
        {"l": ac_led_id, "a": own_acc, "t": (side or "DR")[:1].upper()},
    ).mappings().all()
    out = []
    for r in rows:
        low = {str(k).lower(): v for k, v in r.items()}
        out.append(
            {
                "acc_id": int(low.get("accid") or 0),
                "doc_type": str(low.get("doctype") or "").strip(),
                "trn_no": str(low.get("trnno") or "").strip(),
                "trn_date": low.get("trndate"),
                "due_date": low.get("duedate"),
                "doc_ref": str(low.get("docref") or "").strip() if low.get("docref") is not None else "",
                "doc_amt": _money(low.get("docamt")),  # signed: Dr positive, Cr negative
                "cum_adj": _money(low.get("cumadjamt")),
                "bal_amt": _money(low.get("balamt")),
            }
        )
    return out


def saved_adjustments(conn: Connection, acc_id: int) -> dict[int, list[dict]]:
    """A saved voucher's adjustments per head (legacy fillAdjDtlFields), described with the bill each one was made against."""
    if not acc_id:
        return {}
    rows = conn.execute(
        text(
            "SELECT a.AcLedID, a.AdjAgnstAccID, a.DrAmt, a.CrAmt, a.AdjType, a.NewRefNo, h.DocType, h.TrnNo, h.TrnDate "
            "FROM TrnDtlAccAdj a LEFT JOIN TrnHdrAcc h ON h.AccID = a.AdjAgnstAccID WHERE a.AccID = :i"
        ),
        {"i": acc_id},
    ).mappings().all()
    out: dict[int, list[dict]] = {}
    for r in rows:
        cr = _money(r["CrAmt"]) > 0
        out.setdefault(int(r["AcLedID"]), []).append(
            {
                "adj_acc_id": int(r["AdjAgnstAccID"] or 0),
                "amount": _money(r["CrAmt"] if cr else r["DrAmt"]),
                "side": "CR" if cr else "DR",
                "adj_type": str(r["AdjType"] or "A").strip().upper() or "A",
                "new_ref_no": str(r["NewRefNo"] or "").strip(),
                "doc_type": str(r["DocType"] or "").strip(),
                "trn_no": str(r["TrnNo"] or "").strip(),
                "trn_date": r["TrnDate"],
            }
        )
    return out


def _check(conn: Connection, doc_type: str, ac_led_id: int, line_amount: float, adjustments: list[dict]) -> None:
    total = 0.0
    bills = None
    for a in adjustments:
        amt = _money(a.get("amount"))
        if amt <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Adjusted amount must be greater than 0")
        total += amt
        if str(a.get("adj_type") or "A").upper() == "N":
            ref = str(a.get("new_ref_no") or "").strip()
            if not ref:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter New reference number.")
            used = conn.execute(
                text(
                    "SELECT TOP 1 h.DocType + ' - ' + h.TrnNo FROM TrnHdrAcc h JOIN TrnDtlAccAdj a ON h.AccID = a.AccID "
                    "WHERE h.AccType = 'V' AND h.DocType = :d AND a.NewRefNo = :r"
                ),
                {"d": doc_type, "r": ref},
            ).scalar()
            if used:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"New reference number {ref} is already used in {used}")
        else:
            if bills is None:
                bills = {b["acc_id"]: b for b in pending_bills(conn, ac_led_id=ac_led_id, side="DR") + pending_bills(conn, ac_led_id=ac_led_id, side="CR")}
            bill = bills.get(int(a.get("adj_acc_id") or 0))
            if bill is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "A selected bill is no longer pending for this party. Open the adjustment again.")
            if amt - abs(bill["bal_amt"]) > 0.005:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Adjusted amount exceeds the balance of {bill['doc_type']} {bill['trn_no']}")
    if total - line_amount > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Adjusted amounts exceed the line amount")


def write(conn: Connection, *, doc_type: str, voucher_id: int, acc_id: int, ac_led_id: int, line_amount: float, adjustments: list[dict]) -> None:
    """Store one line's adjustments (after the voucher's posting `acc_id` exists)."""
    if not adjustments:
        return
    _check(conn, doc_type, ac_led_id, line_amount, adjustments)
    id_col, dtl = f"{doc_type}ID", f"TrnDtl{doc_type}"
    has_billdet = has_table(f"{dtl}BillDet")
    total, has_new = 0.0, False
    for a in adjustments:
        amt = _money(a.get("amount"))
        new = str(a.get("adj_type") or "A").upper() == "N"
        has_new = has_new or new
        total += amt
        cr = str(a.get("side") or "DR").upper() == "CR"
        conn.execute(
            text(
                "INSERT INTO TrnDtlAccAdj (AccID, AcLedID, DrAmt, CrAmt, AdjAgnstAccID, AdjType, NewRefNo) "
                "VALUES (:acc, :led, :dr, :cr, :against, :t, :ref)"
            ),
            {
                "acc": acc_id, "led": ac_led_id, "dr": 0 if cr else amt, "cr": amt if cr else 0,
                "against": 0 if new else int(a.get("adj_acc_id") or 0), "t": "N" if new else "A",
                "ref": str(a.get("new_ref_no") or "").strip() if new else "",
            },
        )
        if has_billdet:
            conn.execute(
                text(f"INSERT INTO {dtl}BillDet ({id_col}, AcLedID, AccID, AdjAmt, AdjType) VALUES (:i, :led, :acc, :amt, 'A')"),
                {"i": voucher_id, "led": ac_led_id, "acc": 0 if new else int(a.get("adj_acc_id") or 0), "amt": amt},
            )
    new_ref_amt = round(line_amount - total, 2) if has_new else 0  # legacy: line amount minus everything listed (new reference included)
    conn.execute(
        text(f"UPDATE {dtl} SET AgRefAmt = :ag, NewRefAmt = :nr WHERE {id_col} = :i AND AcLedID = :led"),
        {"ag": round(total, 2), "nr": new_ref_amt, "i": voucher_id, "led": ac_led_id},
    )
