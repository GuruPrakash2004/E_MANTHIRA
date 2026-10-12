"""
General ledger posting — port of `svtModule.UpdtTrnToAccVch` and the
inline `TrnHdrAcc`/`TrnDtlAcc` inserts in frmTrnSeva/frmTrnDONREC/frmTrnHBE/
frmTrnVch (see doc 07 §6.2/§6.4/§6.5).

Every legacy voucher-affecting save writes ONE `TrnHdrAcc` row (the posting
header) and 2+ `TrnDtlAcc` rows (Dr/Cr lines) whose DrAmt/CrAmt always sum
equal — this module is the single place that does that for the new system,
so no service ever hand-writes GL rows itself (CLAUDE.md rule 8).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.legacy.tables import insert_row


@dataclass
class JournalLine:
    ac_led_id: int
    dr_amt: float = 0.0
    cr_amt: float = 0.0


def acled_id_for_ledger(conn: Connection, led_id: int) -> int:
    """`MstAcLed` row for a `MstLed` ledger (LedType='L', MstDocID=1204 = Ledger Master)."""
    row = conn.execute(
        text("SELECT AcLedID FROM MstAcLed WHERE LedType = 'L' AND LedMstID = :lid AND MstDocID = 1204"),
        {"lid": led_id},
    ).scalar()
    if row is None:
        raise ValueError(f"No MstAcLed row for ledger id {led_id} — was the Ledger master saved via the Ledger screen?")
    return int(row)


def post(
    conn: Connection,
    *,
    doc_type: str,  # 'RCPTVCH' | 'PMTVCH' | 'JNRVCH' | ...
    trn_id: int,
    trn_no: str,
    trn_date: date,
    due_date: date,
    narration: str,
    lines: list[JournalLine],
) -> int:
    total_dr = round(sum(l.dr_amt for l in lines), 2)
    total_cr = round(sum(l.cr_amt for l in lines), 2)
    if abs(total_dr - total_cr) > 0.005:
        raise ValueError(f"Ledger posting not balanced: Dr {total_dr} != Cr {total_cr}")

    acc_id = insert_row(
        conn,
        "TrnHdrAcc",
        {
            "DocType": doc_type,
            "AccType": "V",
            "TrnID": trn_id,
            "TrnNo": trn_no,
            "TrnDate": trn_date,
            "DueDate": due_date,
            "Narrn": narration,
        },
        returning="AccID",
    )
    for line in lines:
        insert_row(
            conn,
            "TrnDtlAcc",
            {"AccID": acc_id, "AcLedID": line.ac_led_id, "DrAmt": line.dr_amt, "CrAmt": line.cr_amt},
        )
    return acc_id


def delete_posting(conn: Connection, *, doc_type: str, trn_no: str, trn_id: int | None = None) -> None:
    """
    Delete a posting, looked up by (DocType, TrnID) when trn_id is given —
    falls back to TrnNo only for old callers that haven't been updated yet.
    TrnID (not TrnNo) is the right key: `next_receipt_no()`/`next_doc_no()`
    deliberately exclude Cancelled='Y' rows (a faithful port of the legacy
    numbering SQL — see app/meta/numbering.py), so a doc-number CAN be
    reused across two unrelated transactions once the first is cancelled.
    TrnNo alone can then match more than one TrnHdrAcc row; TrnID can't
    (caught 2026-10-12: a reversal picked up an unrelated cancelled
    transaction's GL lines too, via a recycled receipt number, and crashed
    on a duplicate TrnDtlAcc primary key).
    """
    if trn_id is not None:
        acc_id = conn.execute(
            text("SELECT AccID FROM TrnHdrAcc WHERE DocType = :dt AND TrnID = :tid"),
            {"dt": doc_type, "tid": trn_id},
        ).scalar()
    else:
        acc_id = conn.execute(
            text("SELECT AccID FROM TrnHdrAcc WHERE DocType = :dt AND TrnNo = :no"),
            {"dt": doc_type, "no": trn_no},
        ).scalar()
    if acc_id is None:
        return
    conn.execute(text("DELETE FROM TrnDtlAcc WHERE AccID = :id"), {"id": acc_id})
    conn.execute(text("DELETE FROM TrnDtlAccAdj WHERE AccID = :id"), {"id": acc_id})
    conn.execute(text("DELETE FROM TrnHdrAcc WHERE AccID = :id"), {"id": acc_id})


def reverse(
    conn: Connection,
    *,
    doc_type: str,
    trn_no: str,
    trn_id: int,
    trn_date: date,
    narration: str,
) -> int | None:
    """
    NEW behaviour (fixes D-06): instead of deleting the original posting, write
    a mirror-image entry (Dr<->Cr swapped) dated today, so the GL keeps full
    history of the cancellation instead of silently losing the audit trail.
    Used when a Seva/Donation/Hall document is cancelled — see services/seva.py.

    Looked up by (DocType, TrnID), not TrnNo — see delete_posting()'s
    docstring for why TrnNo alone is not safely unique here.
    """
    original = conn.execute(
        text(
            """
            SELECT d.AcLedID, d.DrAmt, d.CrAmt
            FROM TrnHdrAcc h JOIN TrnDtlAcc d ON d.AccID = h.AccID
            WHERE h.DocType = :dt AND h.TrnID = :tid
            """
        ),
        {"dt": doc_type, "tid": trn_id},
    ).mappings().all()
    if not original:
        return None
    lines = [JournalLine(ac_led_id=r["AcLedID"], dr_amt=float(r["CrAmt"] or 0), cr_amt=float(r["DrAmt"] or 0)) for r in original]
    return post(
        conn,
        doc_type=doc_type,
        trn_id=trn_id,
        trn_no=trn_no,
        trn_date=trn_date,
        due_date=trn_date,
        narration=f"CANCEL REVERSAL: {narration}",
        lines=lines,
    )
