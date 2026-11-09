"""
Read one saved voucher (header + Dr/Cr lines) for the record-navigation "View" mode of the Payment / Receipt / Journal
voucher screens (legacy frmTrnVch opened in View mode).
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

# kind -> (header table, id column, detail table, amount column)
_KINDS = {
    "payments": ("TrnHdrPMTVCH", "PMTVCHID", "TrnDtlPMTVCH"),
    "receipts": ("TrnHdrRCPTVCH", "RCPTVCHID", "TrnDtlRCPTVCH"),
    "journals": ("TrnHdrJNRVCH", "JNRVCHID", "TrnDtlJNRVCH"),
    "purchase": ("TrnHdrPURVCH", "PURVCHID", "TrnDtlPURVCH"),
    "credit-notes": ("TrnHdrCRDNT", "CRDNTID", "TrnDtlCRDNT"),
    "debit-notes": ("TrnHdrDBTNT", "DBTNTID", "TrnDtlDBTNT"),
    "contra": ("TrnHdrCNTVCH", "CNTVCHID", "TrnDtlCNTVCH"),
}


def get_voucher(conn: Connection, kind: str, voucher_id: int) -> dict:
    spec = _KINDS.get(kind)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown voucher type")
    hdr_t, id_c, dtl_t = spec
    hdr = conn.execute(text(f"SELECT * FROM {hdr_t} WHERE {id_c} = :i"), {"i": voucher_id}).mappings().first()
    if hdr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher not found")
    lines = conn.execute(text(f"SELECT SlNo, AcLedID, DrAmt, CrAmt FROM {dtl_t} WHERE {id_c} = :i ORDER BY SlNo"), {"i": voucher_id}).mappings().all()
    # Copy From with "DC / CR Reversal" is refused when the journal carries bill references (legacy frmUtlCopyFrom)
    bill_refs = False
    if kind == "journals":
        bill_refs = bool(conn.execute(text("SELECT TOP 1 1 FROM TrnDtlJNRVCHBillDet WHERE JNRVCHID = :i"), {"i": voucher_id}).first())
    from app.services import bill_adjust

    doc_type = id_c[:-2]  # PMTVCHID -> PMTVCH: the DocType of the voucher's ledger posting
    acc_id = bill_adjust.own_acc_id(conn, doc_type, voucher_id)
    adj = bill_adjust.saved_adjustments(conn, acc_id)
    return {
        "has_bill_refs": bill_refs, "acc_id": acc_id, "header": dict(hdr),
        "lines": [{"ac_led_id": l["AcLedID"], "dr_amt": float(l["DrAmt"] or 0), "cr_amt": float(l["CrAmt"] or 0), "adjustments": adj.get(int(l["AcLedID"]), [])} for l in lines],
    }
