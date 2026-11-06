"""
Account heads for the voucher grids - a port of the legacy `frmTrnVch` account-head logic.

Legacy behaviour reproduced here (decompiled from vTemple7.exe, frmTrnVch + svtModule):

* **Which heads may be picked** (`applyFilterFromGrid` / the F-key dialog): the ledger groups the document allows for that
  side (`UtlAccAmtTypeLedGrps`: DocID + AmtType, 'TO' = debit side, 'BY' = credit side) and every child group below them
  (recursive `MstLedGroup.PLedGroupID`). Heads are `MstAcLed` rows of three kinds - ledgers (`MstLed`), suppliers
  (`MstSupp`) and customers (`MstCust`) - whose master is not InActive; the list shows the head and its group name and
  filters on `AcLedName LIKE '%text%'`.
* **Choosing a head** (`FillItemDet`): "A/c Head does not exist!!", "This Account Head is InActive! ...", and for a supplier
  / customer "Selected Party [name] Not Approved...." (its master must be Authorised = 'Y').
* **Balance column** (`BalanceColReq = 'Y'`): `getAcBalance` = sum(DrAmt - CrAmt) over `TrnDtlAcc` for that head, shown as
  "x.xx Dr" / "x.xx Cr".

One deliberate difference: a document with NO `UtlAccAmtTypeLedGrps` rows at all (Purchase Voucher here) would show an empty
list in the legacy form, which makes the screen unusable. For such a document every active head is offered instead
(`restricted: false` tells the screen), and the selection checks still apply.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import capabilities
from app.core.config import get_settings

# legacy: "BY"/"CR" -> 'BY', "TO"/"DR" -> 'TO'
_SIDE_TYPE = {"DR": "TO", "TO": "TO", "CR": "BY", "BY": "BY"}
MAX_ROWS = 300


def amt_type(side: str | None) -> str | None:
    return _SIDE_TYPE.get((side or "").strip().upper())


def _party_tables() -> list[tuple[str, str, str, str]]:
    """(LedType, master table, id column, label) for the party masters this database has (suppliers / customers)."""
    out = []
    for led_type, table, id_col in (("S", "MstSupp", "SuppID"), ("C", "MstCust", "CustID")):
        if capabilities.has_table(table) and capabilities.has_col(table, id_col):
            out.append((led_type, table, id_col, table))
    return out


def _approved_sql(alias: str = "a") -> str:
    """SQL expression: 'Y' when the head is a ledger, or a party whose master is Authorised = 'Y'."""
    parts = []
    for led_type, table, id_col, _ in _party_tables():
        if capabilities.has_col(table, "Authorised"):
            parts.append(f"WHEN {alias}.LedType = '{led_type}' THEN ISNULL((SELECT TOP 1 m.Authorised FROM {table} m WHERE m.{id_col} = {alias}.LedMstID), 'N')")
    return f"CASE {' '.join(parts)} ELSE 'Y' END" if parts else "'Y'"


def restricted_for(conn: Connection, doc_id: int, side: str) -> bool:
    t = amt_type(side)
    if not t or not capabilities.has_table("UtlAccAmtTypeLedGrps"):
        return False
    return bool(conn.execute(text("SELECT COUNT(*) FROM UtlAccAmtTypeLedGrps WHERE DocID = :d AND AmtType = :t"), {"d": doc_id, "t": t}).scalar())


def list_heads(conn: Connection, *, doc_id: int, side: str, search: str = "", limit: int = MAX_ROWS) -> dict:
    """-> {'restricted': bool, 'items': [{value, label, group, led_type, approved}]} for one voucher line of the given side."""
    limit = max(1, min(int(limit), MAX_ROWS))
    like = f"%{search.strip()}%"
    restricted = restricted_for(conn, doc_id, side) and not get_settings().is_mysql
    if restricted:
        branches = [
            "SELECT a.AcLedID, a.AcLedName, t.LedGroupName AS GroupName, a.LedType, 'Y' AS Approved "
            "FROM tblChild t JOIN MstAcLed a ON t.LedGroupID = a.LedGroupID JOIN MstLed l ON a.LedMstID = l.LEDID "
            "WHERE a.LedType = 'L' AND ISNULL(l.InActive, '') <> 'Y' AND a.AcLedName LIKE :q"
        ]
        for led_type, table, id_col, _ in _party_tables():
            auth = f"ISNULL(l.Authorised, 'N')" if capabilities.has_col(table, "Authorised") else "'Y'"
            inactive = "AND ISNULL(l.InActive, '') <> 'Y'" if capabilities.has_col(table, "InActive") else ""
            branches.append(
                f"SELECT a.AcLedID, a.AcLedName, t.LedGroupName, a.LedType, {auth} "
                f"FROM tblChild t JOIN MstAcLed a ON t.LedGroupID = a.LedGroupID JOIN {table} l ON a.LedMstID = l.{id_col} "
                f"WHERE a.LedType = '{led_type}' {inactive} AND a.AcLedName LIKE :q"
            )
        sql = (
            "WITH tblChild AS (SELECT * FROM MstLedGroup WHERE LedGroupID IN "
            "(SELECT LedGroupID FROM UtlAccAmtTypeLedGrps WHERE DocID = :d AND AmtType = :t) "
            "UNION ALL SELECT g.* FROM MstLedGroup g JOIN tblChild c ON g.PLedGroupID = c.LedGroupID) "
            f"SELECT TOP {limit} x.* FROM ({' UNION ALL '.join(branches)}) x ORDER BY x.AcLedName OPTION (MAXRECURSION 32767)"
        )
        rows = conn.execute(text(sql), {"d": doc_id, "t": amt_type(side), "q": like}).mappings().all()
    else:
        # the legacy combo list: every active head
        sql = (
            f"SELECT TOP {limit} a.AcLedID, a.AcLedName, g.LedGroupName AS GroupName, a.LedType, {_approved_sql('a')} AS Approved "
            "FROM MstAcLed a LEFT JOIN MstLedGroup g ON g.LedGroupID = a.LedGroupId "
            "WHERE ISNULL(a.InActive, 'N') = 'N' AND a.AcLedID > 0 AND a.AcLedName LIKE :q ORDER BY a.AcLedName"
        )
        if get_settings().is_mysql:
            sql = sql.replace("TOP " + str(limit) + " ", "").rstrip() + f" LIMIT {limit}"
        rows = conn.execute(text(sql), {"q": like}).mappings().all()
    return {
        "restricted": restricted,
        "items": [
            {"value": int(r["AcLedID"]), "label": r["AcLedName"], "group": r["GroupName"] or "", "led_type": r["LedType"],
             "approved": str(r["Approved"] or "N").strip().upper() == "Y"}
            for r in rows
        ],
    }


def balance(conn: Connection, ac_led_id: int) -> float:
    """Legacy svtModule.getAcBalance: sum(dramt - cramt) over every posting of the head (all dates, like the EXE)."""
    v = conn.execute(text("SELECT SUM(DrAmt - CrAmt) FROM TrnDtlAcc WHERE AcLedID = :i"), {"i": ac_led_id}).scalar()
    return round(float(v or 0), 2)


def problem(conn: Connection, ac_led_id: int) -> str | None:
    """The legacy FillItemDet message for an unusable head, or None when it may be used."""
    row = conn.execute(
        text(f"SELECT a.AcLedName, a.InActive, a.LedType, {_approved_sql('a')} AS Approved FROM MstAcLed a WHERE a.AcLedID = :i"), {"i": ac_led_id}
    ).mappings().first()
    if row is None:
        return "A/c Head does not exist!!"
    if str(row["InActive"] or "N").strip().upper() == "Y":
        return "This Account Head is InActive! Please select an Active one from the list."
    if row["LedType"] in ("S", "C") and str(row["Approved"] or "N").strip().upper() != "Y":
        return f"Selected Party [{str(row['AcLedName']).strip()}] Not Approved...."
    return None


def detail(conn: Connection, ac_led_id: int) -> dict:
    """One head for the grid: name, group, balance and whether it may be used (legacy FillItemDet + getAcBalance)."""
    row = conn.execute(
        text(
            f"SELECT a.AcLedID, a.AcLedName, a.LedType, g.LedGroupName AS GroupName FROM MstAcLed a LEFT JOIN MstLedGroup g ON g.LedGroupID = a.LedGroupId WHERE a.AcLedID = :i"
        ),
        {"i": ac_led_id},
    ).mappings().first()
    if row is None:
        return {"found": False, "error": "A/c Head does not exist!!"}
    bal = balance(conn, ac_led_id)
    return {
        "found": True,
        "value": int(row["AcLedID"]),
        "label": row["AcLedName"],
        "group": row["GroupName"] or "",
        "led_type": row["LedType"],
        "balance": abs(bal),
        "balance_side": "Dr" if bal > 0 else "Cr" if bal < 0 else "",
        "error": problem(conn, ac_led_id),
    }


def check_head(conn: Connection, ac_led_id: int) -> None:
    msg = problem(conn, ac_led_id)
    if msg:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg)
