"""
Trading-module reports that the legacy menu still lists (ports of the decompiled forms):

  - Stock Level Report      <- frmRptStockLevel   (template-driven: SQL stored in UtlStkLevelReport)
  - Stock Ageing Report     <- FrmRptSTKBALAgeing (rows from UtlStockList, bucketed by age in days)
  - Customer/Supplier Outstanding (summary) <- FrmRptAccOSBillWise.ShowSummary (TrnHdrAcc/TrnDtlAcc via vwAcLed)
  - availability()          <- tells the UI which source objects exist (Daily Sales / Product Sales / Profit Margin
                               read sales-invoice tables that this database does not have).

Read-only. SQL Server 2014 syntax, bound parameters only (the one exception, the Stock Level template, is
admin-authored SQL stored in the DB itself — it is validated to be a single SELECT, see `_assert_select_only`).
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

MAX_ROWS = 5000

# ------------------------------------------------------------------ Stock Level Report (template driven)

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|merge|exec|execute|grant|revoke|deny|backup|restore|shutdown|xp_\w+|sp_\w+|openrowset|opendatasource|into)\b",
    re.I,
)


def _assert_select_only(sql: str) -> None:
    body = sql.strip().rstrip(";").strip()
    if not re.match(r"(?is)^(select|with)\b", body) or ";" in body or "--" in body or "/*" in body or _FORBIDDEN.search(body):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid SQL in Report Designer.")


def stock_level_templates(conn: Connection) -> list[str]:
    rows = conn.execute(text("SELECT SRptName FROM UtlStkLevelReport ORDER BY 1")).all()
    return [r[0] for r in rows]


def stock_level_report(conn: Connection, *, template: str, as_on: date, fy_start: date) -> dict:
    sql = conn.execute(text("SELECT StkQuery FROM UtlStkLevelReport WHERE SRptName = :n"), {"n": template}).scalar()
    if sql is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report template not found")
    # Same placeholders the legacy form substitutes (backtick stands for a single quote inside the stored SQL).
    sql = (
        str(sql)
        .replace("`", "'")
        .replace("<<CFDATE>>", f"'{fy_start:%Y%m%d}'")
        .replace("<<CTDATE>>", f"'{as_on:%Y%m%d}'")
    )
    if not sql.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid SQL in Report Designer.")
    _assert_select_only(sql)
    result = conn.execute(text(sql.replace(":", "\\:")))  # colons in literals must not look like bind params
    columns = list(result.keys())
    rows = [list(r) for r in result.fetchmany(MAX_ROWS + 1)]
    truncated = len(rows) > MAX_ROWS
    return {"columns": columns, "rows": [[_json(v) for v in r] for r in rows[:MAX_ROWS]], "truncated": truncated}


def _json(v):
    if v is None or isinstance(v, (int, float, str, bool)):
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return float(v) if hasattr(v, "__float__") else str(v)


# ------------------------------------------------------------------ Stock Ageing Report


def stock_ageing(conn: Connection, *, as_on: date, ranges: list[tuple[int, int | None]], item_group_ids: list[int] | None) -> dict:
    """
    Port of FrmRptSTKBALAgeing: stock movements from UtlStockList up to `as_on`; inward rows (StkMultiplier > 0)
    are bucketed by age in days (DATEDIFF(d, DocDate, as_on)); closing balance per item is then spread over the
    buckets exactly like FillRangeValues (balance consumed bucket by bucket, first bucket that exceeds what is left
    gets the remainder, later buckets are cleared).

    [A] Bucket i holds from_i <= age <= to_i (blank `to` = open-ended). The legacy code treats grid row 1 as
    `age < from_1` and rows >=2 as `age >= from_n [and <= to_n]`; that reads like an off-by-one in the screen, so the
    labelled range is used instead.
    """
    if not ranges:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter at least one age range")
    params: dict = {"d": as_on}
    group_sql = ""
    if item_group_ids:
        keys = []
        for i, g in enumerate(item_group_ids):
            params[f"g{i}"] = int(g)
            keys.append(f":g{i}")
        group_sql = f" AND i.ITEMGROUPID IN ({', '.join(keys)})"
    rows = conn.execute(
        text(
            f"""
            SELECT i.ITEMID, g.ITEMGROUPNAME AS item_group, i.ITEMCODE AS item_code, i.ITEMNAME AS item_name,
                   u.UOMCODE AS uom_code, s.StkMultiplier, s.Qty, DATEDIFF(d, s.DocDate, :d) AS adays
            FROM UtlStockList s
            JOIN MstItem i ON i.ITEMID = s.ItemID
            JOIN MstITEMGROUP g ON g.ITEMGROUPID = i.ITEMGROUPID
            LEFT JOIN MstUOM u ON u.UOMID = i.UOMID
            WHERE s.DocDate <= :d AND i.NonStkable <> 'Y'{group_sql}
            ORDER BY g.ITEMGROUPNAME, i.ITEMCODE
            """
        ),
        params,
    ).mappings().all()

    items: dict[int, dict] = {}
    for r in rows:
        it = items.setdefault(
            r["ITEMID"],
            {"item_group": r["item_group"], "item_code": r["item_code"], "item_name": r["item_name"], "uom_code": r["uom_code"], "balance": 0.0, "buckets": [0.0] * len(ranges)},
        )
        qty = float(r["Qty"] or 0)
        mult = int(r["StkMultiplier"] or 0)
        it["balance"] += mult * qty
        if mult > 0:
            for idx, (lo, hi) in enumerate(ranges):
                if r["adays"] >= lo and (hi is None or r["adays"] <= hi):
                    it["buckets"][idx] += qty
                    break

    out = []
    for it in items.values():
        bal = round(it["balance"], 3)
        if bal <= 0:  # legacy: HAVING SUM(DocQty * StkMultiplier) > 0
            continue
        remaining = bal
        vals: list[float | None] = []
        spent = False
        for b in it["buckets"]:
            if spent:
                vals.append(None)
                continue
            b = round(b, 3)
            if b <= remaining:
                vals.append(b or None)
                remaining = round(remaining - b, 3)
            else:
                vals.append(round(remaining, 3))
                spent = True
        out.append({**{k: it[k] for k in ("item_group", "item_code", "item_name", "uom_code")}, "balance": bal, "buckets": vals})
    labels = [f"{lo} to {hi}" if hi is not None else f">= {lo}" for lo, hi in ranges]
    return {"labels": labels, "rows": out[:MAX_ROWS]}


# ------------------------------------------------------------------ Customer / Supplier outstanding (summary)

_PARTY = {
    "C": {"name": "Customer", "table": "MstCUST", "id": "CUSTID", "group": "CUSTGROUPID"},
    "S": {"name": "Supplier", "table": "MstSUPP", "id": "SUPPID", "group": "SUPPGROUPID"},
}


def party_outstanding(
    conn: Connection,
    *,
    party: str,
    from_date: date,
    to_date: date,
    receivable: bool,
    min_amount: float,
    show_all_nonzero: bool,
    group_ids: list[int] | None,
    ac_ids: list[int] | None = None,
) -> dict:
    cfg = _PARTY.get(party)
    if cfg is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "party must be C (customer) or S (supplier)")
    params: dict = {"pt": party, "f": from_date, "t": to_date, "amt": min_amount}
    group_sql = ""
    if group_ids:
        keys = []
        for i, g in enumerate(group_ids):
            params[f"g{i}"] = int(g)
            keys.append(f":g{i}")
        group_sql = f" AND p.{cfg['group']} IN ({', '.join(keys)})"
    if ac_ids:
        keys = []
        for i, g in enumerate(ac_ids):
            params[f"a{i}"] = int(g)
            keys.append(f":a{i}")
        group_sql += f" AND a.AcLedID IN ({', '.join(keys)})"
    # Table/column names come from the fixed _PARTY map above, never from input.
    if receivable:
        having = "SUM(r.OpAmt + r.DrAmt - r.CrAmt) <> 0" if show_all_nonzero else "SUM(r.OpAmt + r.DrAmt - r.CrAmt) > :amt"
    else:
        having = "SUM(r.OpAmt + r.CrAmt - r.DrAmt) <> 0" if show_all_nonzero else "SUM(r.OpAmt + r.DrAmt - r.CrAmt) < :amt"
    sql = f"""
        SELECT a.PartyCode AS party_code, a.PartyName AS party_name,
               SUM(r.OpAmt) AS opening, SUM(r.DrAmt) AS debit, SUM(r.CrAmt) AS credit,
               SUM(r.OpAmt + r.DrAmt - r.CrAmt) AS balance
        FROM (
            SELECT d.AcLedID, SUM(d.DrAmt - d.CrAmt) AS OpAmt, 0.00 AS DrAmt, 0.00 AS CrAmt
            FROM TrnHdrAcc h
            JOIN TrnDtlAcc d ON d.AccID = h.AccID
            JOIN vwAcLed a ON a.AcLedID = d.AcLedID AND a.LedType = :pt
            WHERE h.TrnDate < :f
            GROUP BY d.AcLedID
            UNION ALL
            SELECT d.AcLedID, 0, d.DrAmt, d.CrAmt
            FROM TrnHdrAcc h
            JOIN TrnDtlAcc d ON d.AccID = h.AccID
            JOIN vwAcLed a ON a.AcLedID = d.AcLedID AND a.LedType = :pt
            WHERE h.TrnDate BETWEEN :f AND :t
        ) r
        JOIN vwAcLed a ON a.AcLedID = r.AcLedID AND a.LedType = :pt
        JOIN {cfg['table']} p ON p.{cfg['id']} = a.LedMstID
        WHERE 1 = 1{group_sql}
        GROUP BY a.PartyCode, a.PartyName
        HAVING {having}
        ORDER BY a.PartyCode
    """
    rows = [dict(r) for r in conn.execute(text(sql), params).mappings().all()]
    for r in rows:
        for k in ("opening", "debit", "credit", "balance"):
            r[k] = float(r[k] or 0)
    totals = {k: round(sum(r[k] for r in rows), 2) for k in ("opening", "debit", "credit", "balance")}
    return {"party_name": cfg["name"], "rows": rows, "totals": totals}


# ------------------------------------------------------------------ availability of source objects


def availability(conn: Connection) -> dict:
    def has_table(name: str) -> bool:
        return conn.execute(text("SELECT COUNT(*) FROM sys.objects WHERE name = :n AND type IN ('U', 'V')"), {"n": name}).scalar() > 0

    def count(name: str) -> int:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {name}")).scalar()) if has_table(name) else 0  # fixed names only

    sales_tables = [t for t in ("TrnHdrSINV", "TrnDtlSINV") if has_table(t)]
    return {
        "sales_invoice_tables": sales_tables,
        "sales_invoice_docs": int(conn.execute(text("SELECT COUNT(*) FROM UtlTransactions WHERE HdrTblName = 'TrnHdrSINV'")).scalar()),
        "stock_movements": count("UtlStockList"),
        "stock_level_templates": count("UtlStkLevelReport"),
        "label_layouts": count("UtlLBLLayout"),
        "customers": count("MstCUST"),
        "suppliers": count("MstSUPP"),
        "short_closed_fields": count("UtlShortClosedFlds"),
        "shared_documents": count("UtlSharedDocs"),
        "post_doc_entries": count("UtlHdrPostDocEntry"),
        "party_alert_messages": count("MstPartyAlertMessage"),
        "barcode_layouts": count("UtlBCLayout"),
        "voice_commands": count("MstVoiceCmd"),
        "docs_needing_authorisation": int(conn.execute(text("SELECT COUNT(*) FROM UtlTransactions WHERE AuthReq = 'Y' AND DocType = 'Transaction'")).scalar()),
    }


def party_outstanding_detail(conn: Connection, *, party: str, to_date: date, ac_ids: list[int] | None = None) -> dict:
    """Detailed (bill-wise) outstanding - legacy ShowDtl runs the stored procedure mSP_RptAccBillWisePend_Cust / _Supp
    with @mDate and filters the rows to the chosen parties. A client database without that procedure cannot run it
    (the legacy program fails the same way)."""
    cfg = _PARTY.get(party)
    if cfg is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "party must be C (customer) or S (supplier)")
    proc = "mSP_RptAccBillWisePend_" + ("Cust" if party == "C" else "Supp")
    if not conn.execute(text("SELECT 1 FROM sys.procedures WHERE name = :n"), {"n": proc}).first():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The bill-wise report is not available in this database ({proc} is not installed).")
    res = conn.execute(text(f"SET NOCOUNT ON; EXEC {proc} @mDate = :d"), {"d": to_date})
    rows = res.mappings().all() if res.returns_rows else []
    want = set(int(a) for a in ac_ids or [])
    out = []
    for r in rows:
        if want and int(r.get("acLedid") or r.get("AcLedID") or 0) not in want:
            continue
        out.append(
            {
                "party_code": r.get("PartyCode"), "party_name": r.get("Partyname") or r.get("PartyName"), "doc_type": r.get("docType"), "trn_no": r.get("trnNo"),
                "doc_ref": r.get("DocRef"), "trn_date": r.get("trnDate"), "due_date": r.get("DueDate"), "doc_amt": float(r.get("docAmt") or 0),
                "rcvd_amt": float(r.get("CumAdjAmt") or 0), "balance": float(r.get("BalAmt") or 0),
            }
        )
    out.sort(key=lambda x: (str(x["party_code"]), str(x["trn_date"])))
    return {"party_name": cfg["name"], "rows": out}
