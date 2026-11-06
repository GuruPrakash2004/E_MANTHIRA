"""
Phase-2 legacy masters ported from the decompiled EXE (no table is ever created or altered; a database without them
reports `available: false` and the screen says so):

* Holiday Master (frmMstHoliday)  - `MstHoliday` (Id identity, Hdate, HolidayName); one holiday per date.
* Accounting Ledger Master (frmMstAccountLed + frmMstOPBalLed) - bill-wise opening balances in `MstLedBillWiseOPBal`,
  each one also posted to the books as a `TrnHdrAcc` / `TrnDtlAcc` row (DocType 'OP', AccType 'B', ONE unbalanced
  detail line - exactly what the EXE writes). The EXE did the delete + insert as separate statements; here a save is one
  transaction.
* Sannidhi vs Seva (menu row `frmMstSanSeva`; the EXE has no such form - the mapping is the "Attach Sevas" dialog,
  already in master_extras) - this module only adds the overview of how many sevas each Sannidhi has.
"""
from __future__ import annotations

import re
from datetime import date, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.captions import captions as make_captions
from app.core.captions import menu_title, tidy
from app.core.fy import FinancialYear, assert_date_in_fy
from app.legacy.tables import insert_row


def missing(conn: Connection, *tables: str) -> list[str]:
    have = {r[0].lower() for r in conn.execute(text("SELECT name FROM sys.tables"))}
    return [t for t in tables if t.lower() not in have]


def doc_caption(conn: Connection, table: str) -> str:
    """The Doc Designer's own name for the master that owns `table` (UtlTransactions.DocName), e.g. what the menu calls it."""
    return (conn.execute(text("SELECT TOP 1 DocName FROM UtlTransactions WHERE HdrTblName = :t"), {"t": table}).scalar() or "").strip()


def doc_id_of(conn: Connection, table: str) -> int | None:
    """The DocID of the master that owns `table` (UtlTransactions), so no DocID is typed into a screen."""
    v = conn.execute(text("SELECT TOP 1 DocID FROM UtlTransactions WHERE HdrTblName = :t ORDER BY DocID"), {"t": table}).scalar()
    return int(v) if v is not None else None


def sides(conn: Connection) -> list[dict]:
    """The Dr / Cr choices, taken from the books' own detail table: its amount columns (DrAmt, CrAmt) name the two sides.
    The master table stores the first letter (D / C)."""
    cols = [r[0] for r in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'TrnDtlAcc' AND column_name LIKE '%Amt' ORDER BY ordinal_position"))]
    return [{"value": c[0].upper(), "label": c[: -len("Amt")]} for c in cols if len(c) > 3]


def _need(conn: Connection, *tables: str) -> None:
    m = missing(conn, *tables)
    if m:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This database has no {', '.join(m)}")


# ---------------------------------------------------------------- Holiday Master

HOLIDAY_TABLES = ("MstHoliday",)
HOLIDAY_CAPTION = "Holiday Master"  # the menu row has no form name, so it is found by its caption


def holidays(conn: Connection, *, start: date, end: date) -> dict:
    m = missing(conn, *HOLIDAY_TABLES)
    if m:
        return {"available": False, "missing": m}
    rows = conn.execute(
        text("SELECT Id, Hdate, HolidayName FROM MstHoliday WHERE Hdate BETWEEN :a AND :b ORDER BY Hdate"), {"a": start, "b": end}
    ).mappings().all()
    return {"available": True, "title": menu_title(conn, caption=HOLIDAY_CAPTION), "captions": make_captions({"date": "Hdate", "name": "HolidayName"}), "from": start.isoformat(), "to": end.isoformat(), "rows": [{"id": r["Id"], "date": r["Hdate"].date().isoformat(), "name": (r["HolidayName"] or "").strip()} for r in rows]}


def _check_holiday(day: date, name: str, fy: FinancialYear) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Holiday Name should not be blank")
    if re.fullmatch(r"[\d.,\s+-]+", name):  # legacy txtHolidayName_KeyPress: "Please Enter holiday in words"
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please Enter holiday in words")
    assert_date_in_fy(day, fy)
    return name


def add_holiday(conn: Connection, *, day: date, name: str, fy: FinancialYear, user_code: str) -> None:
    _need(conn, *HOLIDAY_TABLES)
    name = _check_holiday(day, name, fy)
    if conn.execute(text("SELECT 1 FROM MstHoliday WHERE Hdate = :d"), {"d": day}).scalar():
        raise HTTPException(status.HTTP_409_CONFLICT, "HolidayName Already exists")
    conn.execute(text("INSERT INTO MstHoliday (Hdate, HolidayName) VALUES (:d, :n)"), {"d": day, "n": name})
    audit.record(conn, entity="Holiday Master", entity_id=day.isoformat(), action="A", user_code=user_code, details=name)


def update_holiday(conn: Connection, *, day: date, name: str, fy: FinancialYear, user_code: str) -> None:
    _need(conn, *HOLIDAY_TABLES)
    name = _check_holiday(day, name, fy)
    n = conn.execute(text("UPDATE MstHoliday SET HolidayName = :n WHERE Hdate = :d"), {"d": day, "n": name}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no holiday on that date")
    audit.record(conn, entity="Holiday Master", entity_id=day.isoformat(), action="E", user_code=user_code, details=name)


def delete_holiday(conn: Connection, *, day: date, fy: FinancialYear, user_code: str) -> None:
    _need(conn, *HOLIDAY_TABLES)
    assert_date_in_fy(day, fy)
    n = conn.execute(text("DELETE FROM MstHoliday WHERE Hdate = :d"), {"d": day}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no holiday on that date")
    audit.record(conn, entity="Holiday Master", entity_id=day.isoformat(), action="D", user_code=user_code)


# ---------------------------------------------------------------- Accounting Ledger Master: bill-wise opening balances

OPENING_TABLES = ("MstAcLed", "MstLedGroup", "MstLedBillWiseOPBal", "TrnHdrAcc", "TrnDtlAcc")
LEDGER_FORM = "FRMMSTACCOUNTLED"


def ledgers(conn: Connection, *, search: str = "", top: int = 200) -> dict:
    m = missing(conn, *OPENING_TABLES)
    if m:
        return {"available": False, "missing": m}
    from app.core.db import limit_clause

    sql = (
        "SELECT a.AcLedID, a.AcLedName, a.LedType, g.LEDGROUPNAME AS GroupName, "
        "(SELECT COUNT(*) FROM MstLedBillWiseOPBal o WHERE o.AcLedID = a.AcLedID) AS OpCount "
        "FROM MstAcLed a JOIN MstLedGroup g ON a.LedGroupId = g.LEDGROUPID WHERE a.AcLedName <> '-'"
    )
    params: dict = {}
    if search.strip():
        sql += " AND a.AcLedName LIKE :q"
        params["q"] = f"%{search.strip()}%"
    sql += f" ORDER BY a.AcLedName, a.AcLedID {limit_clause(top)}"
    return {
        "available": True,
        "title": menu_title(conn, form_key=LEDGER_FORM),
        "captions": {**make_captions({"name": "AcLedName", "type": "LedType"}), "group": tidy("LedGroupId").removesuffix(" Id"), "op_count": tidy("OPID").removesuffix(" Id") or "OP"},
        "rows": [
            {"id": int(r["AcLedID"]), "name": (r["AcLedName"] or "").strip(), "type": (r["LedType"] or "").strip(), "group": (r["GroupName"] or "").strip(), "op_count": int(r["OpCount"])}
            for r in conn.execute(text(sql), params).mappings()
        ],
    }


def _ledger(conn: Connection, led_id: int) -> dict:
    r = conn.execute(
        text("SELECT a.AcLedID, a.AcLedName, a.LedType, g.LEDGROUPNAME AS GroupName FROM MstAcLed a JOIN MstLedGroup g ON a.LedGroupId = g.LEDGROUPID WHERE a.AcLedID = :i AND a.AcLedName <> '-'"),
        {"i": led_id},
    ).mappings().first()
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ledger not found")
    return {"id": int(r["AcLedID"]), "name": (r["AcLedName"] or "").strip(), "type": (r["LedType"] or "").strip(), "group": (r["GroupName"] or "").strip()}


def opening_balances(conn: Connection, led_id: int) -> dict:
    _need(conn, *OPENING_TABLES)
    led = _ledger(conn, led_id)
    rows = conn.execute(text("SELECT OPID, DocType, OPRefNo, OPRefDate, OpAmt, DrCr FROM MstLedBillWiseOPBal WHERE AcLedID = :i ORDER BY OPID"), {"i": led_id}).mappings().all()
    sd = sides(conn)
    label = {x["value"]: x["label"] for x in sd}
    items = [
        {"op_id": int(r["OPID"]), "doc_type": (r["DocType"] or "").strip(), "ref_no": (r["OPRefNo"] or "").strip(), "ref_date": r["OPRefDate"].date().isoformat() if r["OPRefDate"] else None, "amount": float(r["OpAmt"] or 0), "side": (r["DrCr"] or "").strip().upper(), "side_label": label.get((r["DrCr"] or "").strip().upper(), (r["DrCr"] or "").strip())}
        for r in rows
    ]
    return {
        "title": menu_title(conn, form_key=LEDGER_FORM),
        "captions": make_captions({"ref_no": "OPRefNo", "ref_date": "OPRefDate", "amount": "OpAmt", "side": "DrCr", "type": "LedType"}),
        "sides": sd,
        "ledger": led,
        "rows": items,
        "totals": {x["value"]: round(sum(i["amount"] for i in items if i["side"] == x["value"]), 2) for x in sd},
    }


def _clean(conn: Connection, ref_no: str, amount: float, dr_cr: str) -> tuple[str, float, str]:
    ref_no = (ref_no or "").strip()
    if not ref_no:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "RefNo should not be empty!")
    amount = round(float(amount or 0), 2)
    if amount <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Amount cannot be empty or zero!! Please enter a valid number greater than 0")
    side = (dr_cr or "").strip().upper()[:1]  # the table keeps one letter per side
    if side not in {x["value"] for x in sides(conn)}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid Account Type!!!")
    return ref_no, amount, side


def _post_op(conn: Connection, *, led_id: int, op_id: int, ref_no: str, ref_date: date, amount: float, side: str) -> None:
    """UpdtVchHdr: one TrnHdrAcc (DocType 'OP', AccType 'B', TrnID = OPID) with ONE detail line for the ledger."""
    acc_id = conn.execute(
        text("SELECT h.AccID FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID WHERE d.AcLedID = :l AND h.TrnID = :t AND h.DocType = 'OP'"),
        {"l": led_id, "t": op_id},
    ).scalar()
    if acc_id:
        conn.execute(text("DELETE FROM TrnDtlAcc WHERE AccID = :a"), {"a": acc_id})
        conn.execute(
            text("UPDATE TrnHdrAcc SET TrnNo = :n, TrnDate = :d, DueDate = :d WHERE AccID = :a"), {"n": ref_no, "d": ref_date, "a": acc_id}
        )
    else:
        acc_id = insert_row(
            conn,
            "TrnHdrAcc",
            {"DocType": "OP", "AccType": "B", "TrnID": op_id, "TrnNo": ref_no, "TrnDate": ref_date, "DueDate": ref_date, "Narrn": ""},
            returning="AccID",
        )
    insert_row(conn, "TrnDtlAcc", {"AccID": acc_id, "AcLedID": led_id, "DrAmt": amount if side == "D" else 0, "CrAmt": amount if side == "C" else 0})


def add_opening(conn: Connection, *, led_id: int, ref_no: str, ref_date: date, amount: float, dr_cr: str, user_code: str) -> dict:
    _need(conn, *OPENING_TABLES)
    led = _ledger(conn, led_id)
    ref_no, amount, side = _clean(conn, ref_no, amount, dr_cr)
    if conn.execute(text("SELECT 1 FROM MstLedBillWiseOPBal WHERE AcLedID = :l AND OPRefNo = :r"), {"l": led_id, "r": ref_no}).scalar():
        raise HTTPException(status.HTTP_409_CONFLICT, "OpeningBalance RefNo already exists..")
    op_id = insert_row(  # OPID is an identity column; like the EXE's INSERT, it is not listed
        conn,
        "MstLedBillWiseOPBal",
        {"AcLedID": led_id, "DocType": led["type"][:1], "OPRefNo": ref_no, "OPRefDate": ref_date, "OpAmt": amount, "DrCr": side},
        returning="OPID",
    )
    _post_op(conn, led_id=led_id, op_id=op_id, ref_no=ref_no, ref_date=ref_date, amount=amount, side=side)
    audit.record(conn, entity="Ledger Opening Balance", entity_id=op_id, action="A", user_code=user_code, details=f"{led['name']} {ref_no} {amount:.2f} {side}")
    return {"op_id": op_id}


def update_opening(conn: Connection, *, led_id: int, op_id: int, ref_date: date, amount: float, dr_cr: str, user_code: str) -> None:
    _need(conn, *OPENING_TABLES)
    led = _ledger(conn, led_id)
    row = conn.execute(text("SELECT OPRefNo FROM MstLedBillWiseOPBal WHERE OPID = :i AND AcLedID = :l"), {"i": op_id, "l": led_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Opening balance not found")
    ref_no, amount, side = _clean(conn, row["OPRefNo"], amount, dr_cr)  # the ref no is locked when editing, as in the EXE
    conn.execute(
        text("UPDATE MstLedBillWiseOPBal SET OPRefDate = :d, OpAmt = :a, DrCr = :s WHERE OPID = :i"), {"d": ref_date, "a": amount, "s": side, "i": op_id}
    )
    _post_op(conn, led_id=led_id, op_id=op_id, ref_no=ref_no, ref_date=ref_date, amount=amount, side=side)
    audit.record(conn, entity="Ledger Opening Balance", entity_id=op_id, action="E", user_code=user_code, details=f"{led['name']} {ref_no} {amount:.2f} {side}")


def delete_opening(conn: Connection, *, led_id: int, op_id: int, user_code: str) -> None:
    _need(conn, *OPENING_TABLES)
    led = _ledger(conn, led_id)
    row = conn.execute(text("SELECT OPRefNo FROM MstLedBillWiseOPBal WHERE OPID = :i AND AcLedID = :l"), {"i": op_id, "l": led_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Opening balance not found")
    acc_id = conn.execute(
        text("SELECT h.AccID FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID WHERE d.AcLedID = :l AND h.TrnID = :t AND h.DocType = 'OP'"),
        {"l": led_id, "t": op_id},
    ).scalar()
    conn.execute(text("DELETE FROM MstLedBillWiseOPBal WHERE OPID = :i"), {"i": op_id})
    if acc_id:
        conn.execute(text("DELETE FROM TrnDtlAcc WHERE AccID = :a AND AcLedID = :l"), {"a": acc_id, "l": led_id})
        conn.execute(text("DELETE FROM TrnHdrAcc WHERE AccID = :a"), {"a": acc_id})
    audit.record(conn, entity="Ledger Opening Balance", entity_id=op_id, action="D", user_code=user_code, details=f"{led['name']} {(row['OPRefNo'] or '').strip()}")


# ---------------------------------------------------------------- Sannidhi vs Seva overview

SANSEVA_TABLES = ("MstSanSeva", "MstSANNIDHI", "MstSVA")
SANSEVA_FORM = "frmMstSanSeva"


def sannidhi_sevas(conn: Connection) -> dict:
    m = missing(conn, *SANSEVA_TABLES)
    if m:
        return {"available": False, "missing": m}
    rows = conn.execute(
        text(
            "SELECT s.SANNIDHIID AS id, s.SANNIDHICODE AS code, s.SANNIDHINAME AS name, COUNT(v.SVAID) AS seva_count "
            "FROM MstSANNIDHI s "
            "LEFT JOIN MstSanSeva m ON m.SanID = s.SANNIDHIID "
            "LEFT JOIN MstSVA v ON v.SVAID = m.SvaID AND v.InActive = 'N' "
            "WHERE s.SANNIDHIID > 0 AND s.InActive = 'N' GROUP BY s.SANNIDHIID, s.SANNIDHICODE, s.SANNIDHINAME ORDER BY s.SANNIDHINAME"
        )
    ).mappings().all()
    total = int(conn.execute(text("SELECT COUNT(*) FROM MstSVA WHERE SVAID > 0 AND InActive = 'N'")).scalar() or 0)
    return {"available": True, "title": menu_title(conn, form_key=SANSEVA_FORM), "captions": {"sannidhi": doc_caption(conn, "MstSANNIDHI"), "sevas": doc_caption(conn, "MstSVA")}, "sannidhi_doc_id": doc_id_of(conn, "MstSANNIDHI"), "total_sevas": total, "rows": [{"id": int(r["id"]), "code": (r["code"] or "").strip(), "name": (r["name"] or "").strip(), "seva_count": int(r["seva_count"])} for r in rows]}
