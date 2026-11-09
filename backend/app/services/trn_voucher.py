"""
Voucher generated from a transaction document — port of the legacy `GenVch` / `frmTrnVch.GenDocFromTransactions`.

A document (Purchase Bill 1271 today) is tied to its voucher document (Purchase Voucher 1272) by metadata only:
  UtlTrnAccSettings     TrnDocID -> VchDocID, HdrVwName (the transaction's header table), DtlVwName (blank = amounts come from the header),
                        TrnVchIDColName (the transaction column that holds the voucher id, VCHID)
  UtlTrnAccSettingsHdr  voucher header fields: Fixed '<<literal>>' / Field <column> / Std SVTTRNID | SVTPARTY | SVTPFX | SVTITEM
  UtlTrnAccSettingsDtl  voucher lines, in SlNo order: ledger (Std SVTPARTY = the party's MstAcLed, or a column expression such as H.LEDIDPUR),
                        amount column (h.PBVALUE), Dr/Cr ('-' = by the sign of the amount)
Presence of the settings row turns the feature on for a document; a temple without it is untouched.

What the EXE does (checked on the legacy rows: vouchers 1, 2, 3 and 7 of the live database):
  save   the voucher takes the transaction's number (PURVCHNO = PBNO), print number and date, a blank Prefix, the header fields above, one line per
         settings row whose amount is not 0 (Dr/Cr, AmtType, PURVCHAmt = |amount|, AgRefAmt = NewRefAmt = 0), and a GL posting (TrnHdrAcc DocType
         'PURVCH', due date = date, no adjustment rows); the transaction's VCHID is then set to the voucher id.
  edit   VCHID > 0: the same voucher is refilled and saved again under its own number; VCHID = 0: one is created.
  delete the voucher, its lines and its GL rows go too, unless the voucher was already adjusted in accounting (TrnDtlAccAdj) - "available in
         accounting transactions... Can't Delete".
An unresolved ledger is written as account 0 (the "none" row of MstAcLed), exactly as the EXE does.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit, capabilities
from app.legacy.tables import insert_row, pad_blanks, table, update_row
from app.meta import edit_rules
from app.services import ledger

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_EXPR = re.compile(r"^\s*([hdHD])\.([A-Za-z_][A-Za-z0-9_]*)\s*$")  # the only expression the mapping tables may use: a column of the header (h.) or detail (d.)
_NUMERIC_COLS = ("numeric", "decimal", "int", "integer", "smallint", "bigint", "float", "real", "money")


@dataclass
class Setup:
    trn_doc_id: int
    vch_doc_id: int
    trn_sh: str  # DocShForm of the transaction (PB)
    trn_hdr: str
    trn_dtl: str  # '' = amounts come from the header
    vch_sh: str  # DocShForm of the voucher (PURVCH)
    vch_name: str
    id_col: str  # the transaction column holding the voucher id (VCHID)
    hdr_rows: list[dict]
    dtl_rows: list[dict]


def _ident(name: str) -> str:
    if not _IDENT.match(name or ""):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Voucher settings name an invalid identifier: {name!r}")
    return name


def settings_for(conn: Connection, trn_doc_id: int) -> Setup | None:
    """The voucher mapping of a document, or None when this database has none (feature off)."""
    for t in ("UtlTrnAccSettings", "UtlTrnAccSettingsHdr", "UtlTrnAccSettingsDtl"):
        if not capabilities.has_table(t):
            return None
    s = conn.execute(text("SELECT VchDocID, HdrVwName, DtlVwName, TrnVchIDColName FROM UtlTrnAccSettings WHERE TrnDocID = :d"), {"d": trn_doc_id}).mappings().first()
    if s is None or not int(s["VchDocID"] or 0) or not (s["HdrVwName"] or "").strip():
        return None
    trn = conn.execute(text("SELECT DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": trn_doc_id}).mappings().first()
    vch = conn.execute(text("SELECT DocName, DocShForm FROM UtlTransactions WHERE DocID = :d"), {"d": int(s["VchDocID"])}).mappings().first()
    if trn is None or vch is None:
        return None
    hdr = conn.execute(text("SELECT * FROM UtlTrnAccSettingsHdr WHERE TrnDocID = :d AND VchFldSection <> 'Detail' ORDER BY SlNo"), {"d": trn_doc_id}).mappings().all()
    dtl = conn.execute(text("SELECT * FROM UtlTrnAccSettingsDtl WHERE TrnDocID = :d ORDER BY SlNo"), {"d": trn_doc_id}).mappings().all()
    return Setup(
        trn_doc_id=trn_doc_id,
        vch_doc_id=int(s["VchDocID"]),
        trn_sh=_ident((trn["DocShForm"] or "").strip()),
        trn_hdr=_ident(s["HdrVwName"].strip()),
        trn_dtl=_ident(s["DtlVwName"].strip()) if (s["DtlVwName"] or "").strip() else "",
        vch_sh=_ident((vch["DocShForm"] or "").strip()),
        vch_name=(vch["DocName"] or "").strip(),
        id_col=_ident((s["TrnVchIDColName"] or "").strip()),
        hdr_rows=[dict(r) for r in hdr],
        dtl_rows=[dict(r) for r in dtl],
    )


def _col_expr(setup: Setup, expr: str) -> str:
    """`h.PBVALUE` / `H.LEDIDPUR` -> a safe `h.[PBVALUE]`; the column must exist on that table (nothing else is ever put into SQL)."""
    m = _EXPR.match(expr or "")
    if not m:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Voucher settings use an unsupported expression: {expr!r}")
    alias, col = m.group(1).lower(), m.group(2)
    tbl = setup.trn_hdr if alias == "h" else setup.trn_dtl
    if not tbl or not capabilities.has_col(tbl, col):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Voucher settings refer to {alias}.{col}, which {tbl or 'the transaction'} does not have")
    return f"{alias}.[{col}]"


def _from_where(setup: Setup) -> str:
    sh = setup.trn_sh
    if setup.trn_dtl:
        return f"FROM [{setup.trn_hdr}] h, [{setup.trn_dtl}] d WHERE h.[{sh}ID] = d.[{sh}ID] AND h.[{sh}ID] = :id"
    return f"FROM [{setup.trn_hdr}] h WHERE h.[{sh}ID] = :id"


def _party_ledger(conn: Connection, setup: Setup, trn_id: int) -> int:
    """`SVTPARTY`: the MstAcLed account of the transaction's party (SUPPID -> LedType 'S', CUSTID -> 'C'), 0 when there is none."""
    for col, led_type in (("SUPPID", "S"), ("CUSTID", "C")):
        if capabilities.has_col(setup.trn_hdr, col):
            pid = conn.execute(text(f"SELECT h.[{col}] FROM [{setup.trn_hdr}] h WHERE h.[{setup.trn_sh}ID] = :id"), {"id": trn_id}).scalar()
            if pid is None:
                return 0
            v = conn.execute(text("SELECT AcLedID FROM MstAcLed WHERE LedMstID = :p AND LedType = :t"), {"p": pid, "t": led_type}).scalar()
            return int(v or 0)
    return 0


def _build_lines(conn: Connection, setup: Setup, trn_id: int) -> list[dict]:
    """The voucher lines the EXE builds: per settings row, per matching row, skipping zero amounts."""
    lines: list[dict] = []
    for r in setup.dtl_rows:
        kind = str(r.get("TrnFldType") or "").strip().upper()
        led_fld = str(r.get("LedNameFld") or "").strip()
        amt_expr = _col_expr(setup, str(r.get("LedAmtFldName") or ""))
        if kind == "STD":
            if led_fld.upper() != "SVTPARTY":
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Voucher settings: unsupported standard ledger {led_fld!r}")
            ledger_sql = None
            fixed_led = _party_ledger(conn, setup, trn_id)
        else:
            ledger_sql, fixed_led = _col_expr(setup, led_fld), None
        order = "ORDER BY 1, 2" if ledger_sql else "ORDER BY 1"  # the EXE orders by ledger then amount; with the party account there is only the amount
        sel = f"SELECT {ledger_sql + ' AS LedID, ' if ledger_sql else ''}{amt_expr} AS LedAmt {_from_where(setup)} AND {amt_expr} <> 0 {order}"
        for row in conn.execute(text(sel), {"id": trn_id}).mappings().all():
            amt = float(row["LedAmt"] or 0)
            led = int(row["LedID"] or 0) if ledger_sql else fixed_led
            drcr = str(r.get("DrCr") or "").strip().upper()
            if drcr == "-":
                drcr = "CR" if amt > 0 else "DR"
            if drcr not in ("DR", "CR"):
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Voucher settings: Dr/Cr must be DR, CR or -, not {drcr!r}")
            lines.append({"ac_led_id": led, "amount": round(abs(amt), 2), "drcr": drcr})
    return lines


def _header_values(conn: Connection, setup: Setup, trn_id: int) -> dict:
    """Voucher header columns from UtlTrnAccSettingsHdr (Fixed / Field / Std)."""
    out: dict = {}
    for r in setup.hdr_rows:
        kind = str(r.get("TrnFldType") or "").strip().upper()
        code = str(r.get("FldCode") or "").strip()
        target = _ident(str(r.get("VchFldCode") or "").strip())
        if kind == "FIXED":
            out[target] = code.replace("<", "").replace(">", "")
        elif kind == "FIELD":
            out[target] = conn.execute(text(f"SELECT h.[{_ident(code)}] FROM [{setup.trn_hdr}] h WHERE h.[{setup.trn_sh}ID] = :id"), {"id": trn_id}).scalar()
        elif kind == "STD":
            std = code.upper()
            if std == "SVTTRNID":
                out[target] = trn_id
            elif std == "SVTPARTY":
                out[target] = _party_ledger(conn, setup, trn_id)
            elif std == "SVTPFX":
                out[target] = conn.execute(text(f"SELECT h.[Prefix] FROM [{setup.trn_hdr}] h WHERE h.[{setup.trn_sh}ID] = :id"), {"id": trn_id}).scalar()
    return out


def _coerce(tbl: str, cols: dict) -> dict:
    """Header values typed for the real column (numeric columns get numbers, the rest text)."""
    t = table(tbl)
    out = {}
    for k, v in cols.items():
        col = next((c for c in t.columns if c.name.lower() == k.lower()), None)
        if col is None:
            continue
        if v is None:
            out[col.name] = None
        elif str(col.type).lower().startswith(_NUMERIC_COLS):
            try:
                out[col.name] = float(v)
            except (TypeError, ValueError):
                out[col.name] = 0
        else:
            out[col.name] = str(v)
    return out


def _write_lines_and_gl(conn: Connection, setup: Setup, vch_id: int, vch_no: str, vch_date, lines: list[dict]) -> None:
    sh = setup.vch_sh
    total_dr = round(sum(l["amount"] for l in lines if l["drcr"] == "DR"), 2)
    total_cr = round(sum(l["amount"] for l in lines if l["drcr"] == "CR"), 2)
    if not lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The {setup.vch_name or 'voucher'} would have no lines (the amount is 0)")
    if abs(total_dr - total_cr) > 0.005:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The {setup.vch_name or 'voucher'} is not balanced: debit {total_dr:.2f}, credit {total_cr:.2f}")
    for i, l in enumerate(lines, start=1):
        insert_row(
            conn, f"TrnDtl{sh}",
            {
                f"{sh}ID": vch_id, "SlNo": i, "AcLedID": l["ac_led_id"], f"{sh}Amt": l["amount"],
                "CrAmt": l["amount"] if l["drcr"] == "CR" else 0, "DrAmt": l["amount"] if l["drcr"] == "DR" else 0,
                "AmtType": l["drcr"], "AgRefAmt": 0, "NewRefAmt": 0,
            },
        )
    ledger.post(
        conn, doc_type=sh, trn_id=vch_id, trn_no=vch_no, trn_date=vch_date, due_date=vch_date, narration="",
        lines=[ledger.JournalLine(ac_led_id=l["ac_led_id"], dr_amt=l["amount"] if l["drcr"] == "DR" else 0, cr_amt=l["amount"] if l["drcr"] == "CR" else 0) for l in lines],
    )


def _as_date(v) -> date:
    return v.date() if isinstance(v, datetime) else v


def linked_voucher(conn: Connection, setup: Setup, trn_id: int) -> dict | None:
    """{id, no, print_no} of the voucher generated for a transaction (VCHID > 0 and the voucher exists), else None."""
    vid = conn.execute(text(f"SELECT h.[{setup.id_col}] FROM [{setup.trn_hdr}] h WHERE h.[{setup.trn_sh}ID] = :id"), {"id": trn_id}).scalar()
    if not vid or int(vid) <= 0:
        return None
    sh = setup.vch_sh
    row = conn.execute(text(f"SELECT [{sh}NO] AS no, [Print{sh}NO] AS print_no FROM TrnHdr{sh} WHERE [{sh}ID] = :v"), {"v": int(vid)}).mappings().first()
    return {"id": int(vid), "no": row["no"], "print_no": row["print_no"]} if row else None


def generate(conn: Connection, trn_doc_id: int, trn_id: int, *, user_code: str) -> dict | None:
    """Create the voucher of a transaction (after its save). None when the temple has no mapping for this document."""
    setup = settings_for(conn, trn_doc_id)
    if setup is None:
        return None
    sh, tsh = setup.vch_sh, setup.trn_sh
    head = conn.execute(text(f"SELECT [{tsh}NO] AS no, [Print{tsh}NO] AS print_no, [{tsh}Date] AS dt FROM [{setup.trn_hdr}] WHERE [{tsh}ID] = :id"), {"id": trn_id}).mappings().first()
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The document to make the voucher from was not found")
    lines = _build_lines(conn, setup, trn_id)
    cols = _coerce(f"TrnHdr{sh}", _header_values(conn, setup, trn_id))
    cols.update(
        {
            f"{sh}NO": head["no"], "Prefix": "", f"Print{sh}NO": head["print_no"] or head["no"], f"{sh}Date": head["dt"],
            "Authorised": edit_rules.authorised_on_save(conn, setup.vch_doc_id), "Cancelled": "N", "AddedBy": user_code, "AddedOn": datetime.now(),
        }
    )
    pad_blanks(cols, keep=())
    vch_id = insert_row(conn, f"TrnHdr{sh}", cols, returning=f"{sh}ID")
    _write_lines_and_gl(conn, setup, vch_id, head["no"], _as_date(head["dt"]), lines)
    conn.execute(text(f"UPDATE [{setup.trn_hdr}] SET [{setup.id_col}] = :v WHERE [{tsh}ID] = :id"), {"v": vch_id, "id": trn_id})
    audit.record(conn, entity=setup.vch_name or "Voucher", entity_id=vch_id, action="A", user_code=user_code, details=head["no"])
    return {"id": vch_id, "no": head["no"], "print_no": head["print_no"] or head["no"]}


def regenerate(conn: Connection, trn_doc_id: int, trn_id: int, *, user_code: str) -> dict | None:
    """After a transaction is edited: refill the voucher it already has (same number, id), or create one when it has none (legacy Mode 'M')."""
    setup = settings_for(conn, trn_doc_id)
    if setup is None:
        return None
    existing = linked_voucher(conn, setup, trn_id)
    if existing is None:
        return generate(conn, trn_doc_id, trn_id, user_code=user_code)
    sh, tsh, vch_id = setup.vch_sh, setup.trn_sh, existing["id"]
    if _adjusted(conn, sh, vch_id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"The {setup.vch_name or 'voucher'} of this document is already used in accounting transactions, so it cannot be changed")
    head = conn.execute(text(f"SELECT [{tsh}Date] AS dt FROM [{setup.trn_hdr}] WHERE [{tsh}ID] = :id"), {"id": trn_id}).mappings().first()
    lines = _build_lines(conn, setup, trn_id)
    cols = _coerce(f"TrnHdr{sh}", _header_values(conn, setup, trn_id))
    cols.update({f"{sh}Date": head["dt"], "ChangedBy": user_code, "ChangedOn": datetime.now()})
    update_row(conn, f"TrnHdr{sh}", f"{sh}ID", vch_id, cols)
    conn.execute(text(f"DELETE FROM TrnDtl{sh} WHERE [{sh}ID] = :v"), {"v": vch_id})
    ledger.delete_posting(conn, doc_type=sh, trn_no=existing["no"], trn_id=vch_id)
    _write_lines_and_gl(conn, setup, vch_id, existing["no"], _as_date(head["dt"]), lines)
    audit.record(conn, entity=setup.vch_name or "Voucher", entity_id=vch_id, action="E", user_code=user_code, details=existing["no"])
    return existing


def _adjusted(conn: Connection, sh: str, vch_id: int) -> bool:
    """Legacy ChkAccTransaction: the voucher's posting has been adjusted against in accounting."""
    return conn.execute(
        text(
            "SELECT TOP 1 1 FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID JOIN TrnDtlAccAdj v ON d.AccID = v.AdjAgnstAccID AND d.AcLedID = v.AcLedID "
            "WHERE h.DocType = :dt AND h.TrnID = :id"
        ),
        {"dt": sh, "id": vch_id},
    ).first() is not None


def delete_generated(conn: Connection, trn_doc_id: int, trn_id: int, *, user_code: str) -> bool:
    """Before a transaction is deleted: remove its voucher, lines and GL rows. False when it had none."""
    setup = settings_for(conn, trn_doc_id)
    if setup is None:
        return False
    existing = linked_voucher(conn, setup, trn_id)
    if existing is None:
        return False
    sh, vch_id = setup.vch_sh, existing["id"]
    if _adjusted(conn, sh, vch_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "This document is available in accounting transactions... Can't Delete...")
    ledger.delete_posting(conn, doc_type=sh, trn_no=existing["no"], trn_id=vch_id)
    conn.execute(text(f"DELETE FROM TrnDtl{sh} WHERE [{sh}ID] = :v"), {"v": vch_id})
    conn.execute(text(f"DELETE FROM TrnHdr{sh} WHERE [{sh}ID] = :v"), {"v": vch_id})
    audit.record(conn, entity=setup.vch_name or "Voucher", entity_id=vch_id, action="D", user_code=user_code, details=existing["no"])
    return True
