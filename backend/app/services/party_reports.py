"""
Receivable / payable reports ported from the decompiled EXE (read-only; nothing here writes):

  Customer / Supplier OutStanding (FrmRptAccOSBillWise)  -> outstanding_summary, outstanding_detail
  Party wise OutStanding          (frmRptAccOutstanding) -> party_outstanding
  Bill wise Ageing / Customer / Supplier Ageing (FrmRptAccAgeBillWise, FrmRptPartyAge) -> ageing
  Customer / Supplier Reminder    (frmRptPartyLtr)       -> reminders (the data; the letter print needs the EXE's staging
                                                            tables RptRemLetter / RptPartyLtrPlist, which are not created here)
  Customer / Supplier Ledger      (FrmRptPartyLedger)    -> the General Ledger report that already exists (general_ledger.py)

THE BILL-WISE MODEL (from the EXE's voucher write-set `frmTrnVch` and the database's own `mSP_AcBillWisePendReport`):
  * every posting is a `TrnHdrAcc` header (AccType 'B' = opening balance, 'V' = voucher) with `TrnDtlAcc` lines per ledger;
  * a bill is an opening-balance line, or a voucher's NEW reference (`TrnDtlAccAdj`, AdjType 'N', reference = NewRefNo);
  * a voucher settles earlier bills with AGAINST rows (AdjType 'A', `AdjAgnstAccID` = the bill's posting); these carry the same
    side as the bill, so  balance = (Dr - Cr of the bill) - sum(Dr - Cr of its 'A' rows)  (matched on posting AND ledger).
  * what a voucher posted to the ledger but did not allocate to any bill is "on account" (an advance):
        on_account = sum(V lines) - sum('N' rows) + sum('A' rows)
    so that  sum(bill balances) + on_account = the ledger's balance, which the tests assert.

Nothing about parties is typed in: the party master table, its id / code / name / group columns are read from
`UtlTransactions` (DocShForm), and the ageing ranges come from the request or the `Accounting / AgeBuckets` setting.
Tables this database lacks make the report say so (`available: false`).
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.captions import menu_title, tidy
from app.services.settings import get_setting

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TOL = 0.005

# KEYS only: which ledger-type code and party master a kind uses (the EXE's C / S + MstCUST / MstSUPP). Their names, columns
# and captions are read from the database.
KINDS = {"receivable": {"led_type": "C", "party_table": "MstCUST", "sign": 1}, "payable": {"led_type": "S", "party_table": "MstSUPP", "sign": -1}}
CORE_TABLES = ("TrnHdrAcc", "TrnDtlAcc", "TrnDtlAccAdj", "MstAcLed")
BUCKET_SETTING = ("Accounting", "AgeBuckets")  # e.g.  0-30;31-60;61-90;91-180;181+


def _tables(conn: Connection) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for t, c in conn.execute(text("SELECT table_name, column_name FROM information_schema.columns")):
        out.setdefault(t.lower(), set()).add(c.lower())
    return out


def _kind(conn: Connection, kind: str) -> dict:
    """The party master of this kind with its real column names, or a dict with `missing` listing what the database lacks."""
    if kind not in KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "kind must be one of the party kinds")
    spec = KINDS[kind]
    have = _tables(conn)
    missing = [t for t in CORE_TABLES if t.lower() not in have]
    sf = (conn.execute(text("SELECT TOP 1 DocShForm FROM UtlTransactions WHERE HdrTblName = :t ORDER BY DocID"), {"t": spec["party_table"]}).scalar() or "").strip()
    ptab = spec["party_table"]
    if spec["party_table"].lower() not in have or not _IDENT.match(sf):
        missing.append(ptab)
    cols = {c: f"{sf}{c}" for c in ("ID", "Code", "Name", "GroupID")}
    pc = have.get(ptab.lower(), set())
    lacking = [v for k, v in cols.items() if k != "GroupID" and v.lower() not in pc]
    if lacking and ptab not in missing:
        missing.append(f"{ptab}.{', '.join(lacking)}")
    if missing:
        return {"missing": missing, "kind": kind}
    gtab = f"Mst{sf}Group"
    grp = None
    if gtab.lower() in have and cols["GroupID"].lower() in pc and {f"{sf}groupid".lower(), f"{sf}groupname".lower()} <= have[gtab.lower()]:
        grp = {"table": gtab, "id": f"{sf}GroupID", "name": f"{sf}GroupName"}
    cap = (conn.execute(text("SELECT TOP 1 DocName FROM UtlTransactions WHERE HdrTblName = :t ORDER BY DocID"), {"t": ptab}).scalar() or "").strip()
    return {"kind": kind, "led_type": spec["led_type"], "sign": spec["sign"], "table": ptab, "id": cols["ID"], "code": cols["Code"], "name": cols["Name"], "group": grp,
            "group_col": cols["GroupID"] if grp else None, "caption": cap, "have_acc_cols": have["trnhdracc"]}


def _unavailable(conn: Connection, ctx: dict, report: str) -> dict:
    return {"available": False, "title": menu_title(conn, caption=report), "missing": ctx["missing"]}


def _in(prefix: str, values: list[int], params: dict) -> str:
    names = []
    for i, v in enumerate(values):
        params[f"{prefix}{i}"] = int(v)
        names.append(f":{prefix}{i}")
    return ", ".join(names)


def _party_filter(ctx: dict, party_ids: list[int], group_ids: list[int], params: dict, alias_a: str = "a", alias_p: str = "p") -> str:
    sql = ""
    if party_ids:
        sql += f" AND {alias_a}.AcLedID IN ({_in('pid', party_ids, params)})"
    if group_ids and ctx["group_col"]:
        sql += f" AND {alias_p}.{ctx['group_col']} IN ({_in('gid', group_ids, params)})"
    return sql


# ---------------------------------------------------------------- pick lists

def options(conn: Connection, kind: str, report: str) -> dict:
    ctx = _kind(conn, kind)
    if "missing" in ctx:
        return _unavailable(conn, ctx, report)
    groups = []
    if ctx["group"]:
        g = ctx["group"]
        groups = [{"id": int(r[0]), "name": (r[1] or "").strip()} for r in conn.execute(text(f"SELECT {g['id']}, {g['name']} FROM {g['table']} WHERE {g['id']} > 0 ORDER BY {g['name']}"))]
    bk = get_setting(conn, *BUCKET_SETTING)
    return {
        "available": True,
        "title": menu_title(conn, caption=report),
        "party_caption": ctx["caption"],
        "groups": groups,
        "default_buckets": parse_buckets(bk["value"]) if bk else [],
        "bucket_setting": {"group": BUCKET_SETTING[0], "name": BUCKET_SETTING[1], "format": "FROM-TO;FROM-TO;...;FROM+   (days past the due date)"},
    }


def parties(conn: Connection, kind: str, search: str = "", top: int = 200) -> list[dict]:
    from app.core.db import limit_clause

    ctx = _kind(conn, kind)
    if "missing" in ctx:
        return []
    params: dict = {"t": ctx["led_type"]}
    sql = (
        f"SELECT a.AcLedID, p.{ctx['code']} AS Code, p.{ctx['name']} AS Name FROM MstAcLed a JOIN {ctx['table']} p ON a.LedMstID = p.{ctx['id']} "
        f"WHERE a.LedType = :t AND a.AcLedID > 0"
    )
    if search.strip():
        sql += f" AND (p.{ctx['code']} LIKE :q OR p.{ctx['name']} LIKE :q)"
        params["q"] = f"%{search.strip()}%"
    sql += f" ORDER BY p.{ctx['code']} {limit_clause(top)}"
    return [{"id": int(r["AcLedID"]), "code": (r["Code"] or "").strip(), "name": (r["Name"] or "").strip()} for r in conn.execute(text(sql), params).mappings()]


# ---------------------------------------------------------------- the bill-wise engine

def pending_bills(conn: Connection, ctx: dict, as_on: date, party_ids: list[int] | None = None, group_ids: list[int] | None = None) -> dict:
    """Every bill of the kind's parties with its settled amount and balance as on `as_on`, plus each party's on-account amount.
    Returns {bills: [...], on_account: {AcLedID: amount}, ledger_balance: {AcLedID: amount}} (all raw Dr - Cr)."""
    params: dict = {"t": ctx["led_type"], "d": as_on}
    pf = _party_filter(ctx, party_ids or [], group_ids or [], params, "a", "p")
    parties_cte = (
        f"parties AS (SELECT a.AcLedID, p.{ctx['code']} AS PartyCode, p.{ctx['name']} AS PartyName FROM MstAcLed a "
        f"JOIN {ctx['table']} p ON a.LedMstID = p.{ctx['id']} WHERE a.LedType = :t{pf})"
    )
    bills_sql = f"""
        WITH {parties_cte},
        bills AS (
            SELECT h.AccID, d.AcLedID, h.DocType, h.TrnNo AS Ref, h.TrnDate, h.DueDate, d.DrAmt - d.CrAmt AS DocAmt
            FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID
            WHERE h.AccType = 'B' AND h.TrnDate <= :d AND d.AcLedID IN (SELECT AcLedID FROM parties)
            UNION ALL
            SELECT h.AccID, a.AcLedID, h.DocType, a.NewRefNo, h.TrnDate, h.DueDate, a.DrAmt - a.CrAmt
            FROM TrnHdrAcc h JOIN TrnDtlAccAdj a ON h.AccID = a.AccID
            WHERE h.AccType = 'V' AND a.AdjType = 'N' AND h.TrnDate <= :d AND a.AcLedID IN (SELECT AcLedID FROM parties)
        ),
        adj AS (
            SELECT a.AdjAgnstAccID, a.AcLedID, SUM(a.DrAmt - a.CrAmt) AS Adjusted
            FROM TrnDtlAccAdj a JOIN TrnHdrAcc ah ON ah.AccID = a.AccID
            WHERE a.AdjType = 'A' AND ah.TrnDate <= :d AND a.AcLedID IN (SELECT AcLedID FROM parties)
            GROUP BY a.AdjAgnstAccID, a.AcLedID
        )
        SELECT p.AcLedID, p.PartyCode, p.PartyName, b.AccID, b.DocType, b.Ref, b.TrnDate, b.DueDate, b.DocAmt,
               ISNULL(x.Adjusted, 0) AS Adjusted, b.DocAmt - ISNULL(x.Adjusted, 0) AS Balance
        FROM bills b JOIN parties p ON p.AcLedID = b.AcLedID
        LEFT JOIN adj x ON x.AdjAgnstAccID = b.AccID AND x.AcLedID = b.AcLedID
        ORDER BY p.PartyCode, b.TrnDate, b.AccID
    """
    bills = []
    for r in conn.execute(text(bills_sql), params).mappings():
        bal = round(float(r["Balance"] or 0), 2)
        if abs(bal) < TOL:
            continue
        bills.append(
            {
                "acled_id": int(r["AcLedID"]), "party_code": (r["PartyCode"] or "").strip(), "party_name": (r["PartyName"] or "").strip(),
                "acc_id": int(r["AccID"]), "doc_type": (r["DocType"] or "").strip(), "ref": (r["Ref"] or "").strip(),
                "date": r["TrnDate"].date().isoformat() if r["TrnDate"] else None, "due": r["DueDate"].date().isoformat() if r["DueDate"] else None,
                "doc_amt": round(float(r["DocAmt"] or 0), 2), "adjusted": round(float(r["Adjusted"] or 0), 2), "balance": bal,
            }
        )
    # on account = what vouchers posted to the ledger and did not allocate to a bill
    acct_sql = f"""
        WITH {parties_cte}
        SELECT d.AcLedID,
               SUM(d.DrAmt - d.CrAmt) AS AllLines,
               SUM(CASE WHEN h.AccType = 'V' THEN d.DrAmt - d.CrAmt ELSE 0 END) AS VLines
        FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID
        WHERE h.TrnDate <= :d AND d.AcLedID IN (SELECT AcLedID FROM parties) GROUP BY d.AcLedID
    """
    ledger_bal = {}
    vlines = {}
    for r in conn.execute(text(acct_sql), params).mappings():
        ledger_bal[int(r["AcLedID"])] = round(float(r["AllLines"] or 0), 2)
        vlines[int(r["AcLedID"])] = float(r["VLines"] or 0)
    rows_sql = f"""
        WITH {parties_cte}
        SELECT a.AcLedID, a.AdjType, SUM(a.DrAmt - a.CrAmt) AS Amt
        FROM TrnDtlAccAdj a JOIN TrnHdrAcc h ON h.AccID = a.AccID
        WHERE h.TrnDate <= :d AND h.AccType = 'V' AND a.AdjType IN ('N', 'A') AND a.AcLedID IN (SELECT AcLedID FROM parties) GROUP BY a.AcLedID, a.AdjType
    """
    nrows: dict[int, float] = {}
    arows: dict[int, float] = {}
    for r in conn.execute(text(rows_sql), params).mappings():
        (nrows if r["AdjType"] == "N" else arows)[int(r["AcLedID"])] = float(r["Amt"] or 0)
    on_account = {led: round(vlines.get(led, 0) - nrows.get(led, 0) + arows.get(led, 0), 2) for led in ledger_bal}
    return {"bills": bills, "on_account": on_account, "ledger_balance": ledger_bal}


def _age(due: str | None, as_on: date) -> int | None:
    return (as_on - date.fromisoformat(due)).days if due else None


# ---------------------------------------------------------------- reports

def outstanding_detail(conn: Connection, kind: str, as_on: date, party_ids: list[int], group_ids: list[int]) -> dict:
    ctx = _kind(conn, kind)
    rep = f"{kind} outstanding"
    if "missing" in ctx:
        return {"available": False, "missing": ctx["missing"], "title": ""}
    res = pending_bills(conn, ctx, as_on, party_ids, group_ids)
    sign = ctx["sign"]  # receivable: pending = debit balances; payable: credit balances, shown as positive amounts
    out_parties: dict[int, dict] = {}
    for b in res["bills"]:
        if b["balance"] * sign <= 0:
            continue  # a bill of the other side (excess) is not outstanding
        p = out_parties.setdefault(b["acled_id"], {"acled_id": b["acled_id"], "code": b["party_code"], "name": b["party_name"], "bills": [], "doc_amt": 0.0, "adjusted": 0.0, "balance": 0.0})
        row = {**b, "doc_amt": round(b["doc_amt"] * sign, 2), "adjusted": round(b["adjusted"] * sign, 2), "balance": round(b["balance"] * sign, 2), "age": _age(b["due"], as_on)}
        p["bills"].append(row)
        for k in ("doc_amt", "adjusted", "balance"):
            p[k] = round(p[k] + row[k], 2)
    for led, p in out_parties.items():
        # positive = an advance (money received from / paid to the party ahead of any bill); negative = an unallocated charge
        p["on_account"] = round(-res["on_account"].get(led, 0) * sign, 2)
    return {
        "available": True, "as_on": as_on.isoformat(), "party_caption": ctx["caption"],
        "parties": sorted(out_parties.values(), key=lambda p: p["code"]),
        "total": {k: round(sum(p[k] for p in out_parties.values()), 2) for k in ("doc_amt", "adjusted", "balance")},
        "captions": {"party_code": tidy(ctx["code"]), "party_name": tidy(ctx["name"]), "doc_type": tidy("DocType"), "ref": tidy("TrnNo"), "date": tidy("TrnDate"), "due": tidy("DueDate"),
                     "doc_amt": tidy("DocAmt"), "adjusted": tidy("CumAdjAmt"), "balance": tidy("BalAmt"), "age": tidy("Ageing"), "on_account": tidy("OnAccount")},
    }


def outstanding_summary(conn: Connection, kind: str, start: date, end: date, party_ids: list[int], group_ids: list[int], min_amount: float, show_excess: bool) -> dict:
    """The EXE's ShowSummary: per party opening (before `start`), debit and credit in [start, end], balance."""
    ctx = _kind(conn, kind)
    if "missing" in ctx:
        return {"available": False, "missing": ctx["missing"], "title": ""}
    if start > end:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "From Date should be less than To Date....")
    params: dict = {"t": ctx["led_type"], "a": start, "b": end, "amt": float(min_amount or 0)}
    pf = _party_filter(ctx, party_ids, group_ids, params, "a", "p")
    if kind == "receivable":
        having = "SUM(r.OpAmt + r.DrAmt - r.CrAmt) <> 0" if show_excess else "SUM(r.OpAmt + r.DrAmt - r.CrAmt) > :amt"
    else:
        having = "SUM(r.OpAmt + r.CrAmt - r.DrAmt) <> 0" if show_excess else "SUM(r.OpAmt + r.DrAmt - r.CrAmt) < :amt"
    sql = f"""
        SELECT p.{ctx['code']} AS PartyCode, p.{ctx['name']} AS PartyName, SUM(r.OpAmt) AS OAmt, SUM(r.DrAmt) AS DocAmt, SUM(r.CrAmt) AS RcptAmt,
               SUM(r.OpAmt + r.DrAmt - r.CrAmt) AS BalanceAmt
        FROM (
            SELECT d.AcLedID, SUM(d.DrAmt - d.CrAmt) AS OpAmt, 0.00 AS DrAmt, 0.00 AS CrAmt
            FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID WHERE h.TrnDate < :a GROUP BY d.AcLedID
            UNION ALL
            SELECT d.AcLedID, 0, d.DrAmt, d.CrAmt FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID WHERE h.TrnDate BETWEEN :a AND :b
        ) r JOIN MstAcLed a ON r.AcLedID = a.AcLedID JOIN {ctx['table']} p ON a.LedMstID = p.{ctx['id']}
        WHERE a.LedType = :t{pf}
        GROUP BY p.{ctx['code']}, p.{ctx['name']} HAVING {having} ORDER BY p.{ctx['code']}
    """
    rows = [
        {"code": (r["PartyCode"] or "").strip(), "name": (r["PartyName"] or "").strip(), "opening": round(float(r["OAmt"] or 0), 2), "debit": round(float(r["DocAmt"] or 0), 2),
         "credit": round(float(r["RcptAmt"] or 0), 2), "balance": round(float(r["BalanceAmt"] or 0), 2)}
        for r in conn.execute(text(sql), params).mappings()
    ]
    return {
        "available": True, "from": start.isoformat(), "to": end.isoformat(), "party_caption": ctx["caption"], "rows": rows,
        "total": {k: round(sum(r[k] for r in rows), 2) for k in ("opening", "debit", "credit", "balance")},
        "captions": {"code": tidy(ctx["code"]), "name": tidy(ctx["name"]), "opening": tidy("OpAmt"), "debit": tidy("DrAmt").removesuffix(" Amt"), "credit": tidy("CrAmt").removesuffix(" Amt"), "balance": tidy("BalanceAmt")},
    }


def party_outstanding(conn: Connection, kind: str, as_on: date, party_ids: list[int], group_ids: list[int], debit_over: float, credit_over: float) -> dict:
    """frmRptAccOutstanding: each party's net balance split into a debit and a credit column. (The EXE ignored its own "as on"
    date; this one honours it.)  A threshold keeps only parties whose debit / credit exceeds it."""
    ctx = _kind(conn, kind)
    if "missing" in ctx:
        return {"available": False, "missing": ctx["missing"], "title": ""}
    params: dict = {"t": ctx["led_type"], "d": as_on}
    pf = _party_filter(ctx, party_ids, group_ids, params, "a", "p")
    sql = f"""
        SELECT p.{ctx['code']} AS PartyCode, p.{ctx['name']} AS PartyName, SUM(d.DrAmt - d.CrAmt) AS Net
        FROM TrnHdrAcc h JOIN TrnDtlAcc d ON h.AccID = d.AccID JOIN MstAcLed a ON d.AcLedID = a.AcLedID JOIN {ctx['table']} p ON a.LedMstID = p.{ctx['id']}
        WHERE a.LedType = :t AND h.TrnDate <= :d{pf} GROUP BY p.{ctx['code']}, p.{ctx['name']} HAVING SUM(d.DrAmt - d.CrAmt) <> 0 ORDER BY p.{ctx['code']}
    """
    rows = []
    for r in conn.execute(text(sql), params).mappings():
        net = round(float(r["Net"] or 0), 2)
        dr, cr = (net, 0.0) if net >= 0 else (0.0, -net)
        if (credit_over > 0 and cr and cr <= credit_over) or (debit_over > 0 and dr and dr <= debit_over):
            continue
        rows.append({"code": (r["PartyCode"] or "").strip(), "name": (r["PartyName"] or "").strip(), "debit": dr, "credit": cr})
    return {
        "available": True, "as_on": as_on.isoformat(), "party_caption": ctx["caption"], "rows": rows,
        "total": {"debit": round(sum(r["debit"] for r in rows), 2), "credit": round(sum(r["credit"] for r in rows), 2)},
        "captions": {"code": tidy(ctx["code"]), "name": tidy(ctx["name"]), "debit": tidy("DAmt").replace("D Amt", "Debit"), "credit": tidy("CAmt").replace("C Amt", "Credit")},
    }


def parse_buckets(value: str) -> list[dict]:
    """`0-30;31-60;181+` -> [{from, to}, ..., {from, to: None}] (the last one open-ended)."""
    out = []
    for part in (value or "").split(";"):
        part = part.strip()
        m = re.fullmatch(r"(-?\d+)\s*-\s*(-?\d+)", part)
        if m:
            out.append({"from": int(m.group(1)), "to": int(m.group(2))})
            continue
        m = re.fullmatch(r"(-?\d+)\s*\+", part)
        if m:
            out.append({"from": int(m.group(1)), "to": None})
    return out


def _bucket_label(b: dict) -> str:
    return f">= {b['from']}" if b["to"] is None else f"{b['from']} to {b['to']}"


def ageing(conn: Connection, kind: str, as_on: date, party_ids: list[int], buckets: list[dict], billwise: bool, debit_over: float, credit_over: float) -> dict:
    """FrmRptAccAgeBillWise: every pending bill aged by (as-on date - due date), summed per party into the user's ranges.
    Bills not yet due (negative age) fall in no range in the EXE and vanish; here they are reported in `not_due`."""
    ctx = _kind(conn, kind)
    if "missing" in ctx:
        return {"available": False, "missing": ctx["missing"], "title": ""}
    if not buckets:
        bk = get_setting(conn, *BUCKET_SETTING)
        buckets = parse_buckets(bk["value"]) if bk else []
    if not buckets:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter the ageing ranges (or add the Accounting / AgeBuckets setting in Global Settings)")
    buckets = sorted(({"from": int(b["from"]), "to": (None if b.get("to") is None else int(b["to"]))} for b in buckets), key=lambda b: b["from"])
    res = pending_bills(conn, ctx, as_on, party_ids, [])
    labels = [_bucket_label(b) for b in buckets]
    parties_out: dict[int, dict] = {}
    bills_out = []
    for b in res["bills"]:
        bal = b["balance"]
        if (credit_over > 0 and bal < 0 and abs(bal) <= credit_over) or (debit_over > 0 and bal > 0 and abs(bal) <= debit_over):
            continue
        age = _age(b["due"], as_on)
        slot = None
        if age is not None:
            for i, bk in enumerate(buckets):
                if age >= bk["from"] and (bk["to"] is None or age <= bk["to"]):
                    slot = i
                    break
        amt = abs(bal)
        p = parties_out.setdefault(b["acled_id"], {"acled_id": b["acled_id"], "code": b["party_code"], "name": b["party_name"], "buckets": [0.0] * len(buckets), "not_due": 0.0})
        if slot is None:
            if age is not None and age < buckets[0]["from"]:
                p["not_due"] = round(p["not_due"] + amt, 2)
        else:
            p["buckets"][slot] = round(p["buckets"][slot] + amt, 2)
        bills_out.append({**b, "age": age, "amount": amt, "bucket": slot})
    plist = sorted(parties_out.values(), key=lambda p: p["code"])
    return {
        "available": True, "as_on": as_on.isoformat(), "party_caption": ctx["caption"], "labels": labels,
        "parties": plist,
        "bills": sorted(bills_out, key=lambda x: (x["party_code"], x["date"] or "", x["acc_id"])) if billwise else [],
        "total": {"buckets": [round(sum(p["buckets"][i] for p in plist), 2) for i in range(len(buckets))], "not_due": round(sum(p["not_due"] for p in plist), 2)},
        "captions": {"party_code": tidy(ctx["code"]), "party_name": tidy(ctx["name"]), "doc_type": tidy("DocType"), "ref": tidy("DocNo"), "date": tidy("DocDate"), "due": tidy("DueDate"), "age": tidy("Age"), "not_due": "Not due"},
    }


def reminders(conn: Connection, kind: str, as_on: date, party_ids: list[int], group_ids: list[int], omit_below: float) -> dict:
    """frmRptPartyLtr data: each party's pending bills with due days, parties whose total pending is below `omit_below` left out,
    plus the party's address lines (the EXE's BAdd1..4) when the master has them."""
    ctx = _kind(conn, kind)
    if "missing" in ctx:
        return {"available": False, "missing": ctx["missing"], "title": ""}
    det = outstanding_detail(conn, kind, as_on, party_ids, group_ids)
    pcols = _tables(conn).get(ctx["table"].lower(), set())
    addr_cols = [c for c in ("BAdd1", "BAdd2", "BAdd3", "BAdd4") if c.lower() in pcols]
    keep = []
    for p in det["parties"]:
        if omit_below and p["balance"] < omit_below:
            continue
        addr: list[str] = []
        if addr_cols:
            row = conn.execute(text(f"SELECT {', '.join(addr_cols)} FROM {ctx['table']} p JOIN MstAcLed a ON p.{ctx['id']} = a.LedMstID WHERE a.AcLedID = :i"), {"i": p["acled_id"]}).first()
            addr = [str(v).strip() for v in (row or []) if v and str(v).strip()]
        keep.append({**p, "address": addr})
    return {**det, "parties": keep, "total": {k: round(sum(p[k] for p in keep), 2) for k in ("doc_amt", "adjusted", "balance")}, "omit_below": omit_below}


def payment_plan(conn: Connection, as_on: date, party_ids: list[int], max_outstanding: float, payments: dict[int, float]) -> dict:
    """The planning half of Generate Multi Payment Voucher (FrmRptAccMultiPayVch): the payable parties with what is outstanding
    (optionally only those owing at most `max_outstanding`), and for every party given a payment amount, that amount spread over
    its bills in due-date order until it runs out (the EXE's "Adjust Bills"). Nothing is written: the EXE then fills its own
    Payment Voucher screen and saves bill-wise adjustments through it, which the web's Payment Voucher does not support yet."""
    ctx = _kind(conn, "payable")
    if "missing" in ctx:
        return {"available": False, "missing": ctx["missing"], "title": ""}
    det = outstanding_detail(conn, "payable", as_on, party_ids, [])
    out = []
    for p in det["parties"]:
        if max_outstanding and p["balance"] > max_outstanding:
            continue
        pay = round(float(payments.get(p["acled_id"], 0) or 0), 2)
        left = pay
        bills = []
        for b in sorted(p["bills"], key=lambda x: (x["due"] or "9999-12-31", x["date"] or "", x["acc_id"])):
            alloc = round(min(b["balance"], left), 2) if left > 0 else 0.0
            left = round(left - alloc, 2)
            bills.append({**b, "allocate": alloc})
        out.append({**{k: p[k] for k in ("acled_id", "code", "name", "balance")}, "pay": pay, "allocated": round(pay - left, 2), "on_account": left, "bills": bills})
    return {
        "available": True, "as_on": as_on.isoformat(), "party_caption": ctx["caption"], "parties": out,
        "total": {"balance": round(sum(p["balance"] for p in out), 2), "pay": round(sum(p["pay"] for p in out), 2), "allocated": round(sum(p["allocated"] for p in out), 2)},
        "captions": det["captions"],
    }
