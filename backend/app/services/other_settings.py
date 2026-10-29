"""
Global Settings -> "Other Settings..." screens of the legacy EXE (FrmUtlGSettings.btnAdnlSettings), ADMIN only.

Each function here is the port of one legacy form's reads and writes against the same table, with the same
messages:
  Field Captions               frmUtlFldCaptions        UtlFldCaptions (Code, Caption)
  Delete Linkage Updation      FrmUtlDeleteLinkageUpdation  UtlDeletion
  View Search Display Fields   frmUtlFindFlds           UtlFindFlds
Table / column names the user picks are always checked against INFORMATION_SCHEMA before they are stored.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection

from app.legacy.tables import insert_row

_PREFIXES = ("mst", "trn", "utl", "rpt")  # the legacy combos list only tables starting with these


def _bad(msg: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(code, msg)


def tables(conn: Connection) -> list[str]:
    rows = conn.execute(text("SELECT name FROM sys.tables WHERE LEFT(name, 3) IN ('Mst','Trn','Utl','Rpt') ORDER BY name")).scalars().all()
    return [r for r in rows]


def columns(conn: Connection, table: str) -> list[str]:
    return list(
        conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t ORDER BY ORDINAL_POSITION"), {"t": table}).scalars().all()
    )


def _has_table(conn: Connection, name: str) -> bool:
    return conn.execute(text("SELECT 1 FROM sys.tables WHERE name = :n"), {"n": name}).first() is not None


def _has_column(conn: Connection, table: str, col: str) -> bool:
    return conn.execute(text("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t AND COLUMN_NAME = :c"), {"t": table, "c": col}).first() is not None


# ----------------------------------------------------------------------------------------------------------- Field Captions
def list_captions(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT Code, Caption FROM UtlFldCaptions")).mappings().all()
    return [{"code": (r["Code"] or "").strip(), "caption": (r["Caption"] or "").strip()} for r in rows]


def save_captions(conn: Connection, items: list[dict]) -> None:
    """The grid is saved whole: the table is emptied and refilled, exactly like the legacy Save."""
    clean = [(str(i.get("code") or "").strip(), str(i.get("caption") or "").strip()) for i in items]
    clean = [c for c in clean if c[0] or c[1]]
    if not clean:
        raise _bad("Grid Empty...")
    seen: set[str] = set()
    for code, _ in clean:
        if code.upper() in seen:
            raise _bad("Can not insert duplicate data.. ")
        seen.add(code.upper())
    conn.execute(text("DELETE FROM UtlFldCaptions"))
    for code, caption in clean:
        conn.execute(text("INSERT INTO UtlFldCaptions (Code, Caption) VALUES (:c, :p)"), {"c": code, "p": caption})


def add_caption(conn: Connection, code: str, caption: str) -> None:
    code, caption = (code or "").strip(), (caption or "").strip()
    if not code:
        raise _bad("Field Code is Empty...")
    if not caption:
        raise _bad("Field Caption is Empty...")
    if conn.execute(text("SELECT 1 FROM UtlFldCaptions WHERE Code = :c"), {"c": code}).first():
        raise _bad("Field Code already exists..", status.HTTP_409_CONFLICT)
    conn.execute(text("INSERT INTO UtlFldCaptions (Code, Caption) VALUES (:c, :p)"), {"c": code, "p": caption})


def delete_caption(conn: Connection, code: str) -> None:
    n = conn.execute(text("DELETE FROM UtlFldCaptions WHERE Code = :c"), {"c": code}).rowcount
    if not n:
        raise _bad("Field Caption Removal Failed", status.HTTP_404_NOT_FOUND)


# ------------------------------------------------------------------------------------------------------- Delete Linkage Updation
def list_linkages(conn: Connection) -> list[dict]:
    """One entry per master table (DelTblName) with the tables that refer to it."""
    rows = conn.execute(text("SELECT DelTblName, TblName, FldName, DispFldName, TblCaption, DelDocName, DelDocFld FROM UtlDeletion ORDER BY DelTblName, TblName")).mappings().all()
    out: dict[str, dict] = {}
    for r in rows:
        name = (r["DelTblName"] or "").strip()
        g = out.setdefault(name, {"table": name, "doc_name": (r["DelDocName"] or "").strip(), "field": (r["DelDocFld"] or "").strip(), "refs": []})
        g["refs"].append({"table": (r["TblName"] or "").strip(), "column": (r["FldName"] or "").strip(), "display": (r["DispFldName"] or "").strip(), "doc": (r["TblCaption"] or "").strip()})
    return list(out.values())


def candidate_refs(conn: Connection, table: str, column: str) -> list[dict]:
    """Load: every table that has `column` (except the table itself and views), the legacy LoadFormList."""
    if not table:
        raise _bad("Select Table name")
    if not column:
        raise _bad("Select Field to be Checked for Deletion")
    rows = conn.execute(
        text(
            "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME = :c AND TABLE_NAME <> :t "
            "AND TABLE_NAME NOT LIKE '%vw%' ORDER BY TABLE_NAME"
        ),
        {"c": column, "t": table},
    ).all()
    return [{"table": r[0], "column": r[1], "display": "", "doc": ""} for r in rows]


def save_linkage(conn: Connection, table: str, doc_name: str, field: str, refs: list[dict]) -> None:
    table, doc_name, field = (table or "").strip(), (doc_name or "").strip(), (field or "").strip()
    if not table:
        raise _bad("Table name is Empty...")
    if not doc_name:
        raise _bad("Document name is Empty...")
    if not refs:
        raise _bad("Data is not available")
    if not field:
        raise _bad("Column is Empty....")
    if not _has_table(conn, table):
        raise _bad("Select Table name")
    conn.execute(text("DELETE FROM UtlDeletion WHERE DelTblName = :t"), {"t": table})
    for r in refs:
        rt, rc = str(r.get("table") or "").strip(), str(r.get("column") or "").strip()
        if not rt or not rc:
            continue
        if not _has_column(conn, rt, rc):
            raise _bad(f"Column {rc} does not exist in {rt}")
        conn.execute(
            text(
                "INSERT INTO UtlDeletion (DelTblName, TblName, FldName, DispFldName, TblCaption, DelDocName, DelDocFld) "
                "VALUES (:dt, :t, :f, :d, :c, :dn, :df)"
            ),
            {"dt": table, "t": rt, "f": rc, "d": str(r.get("display") or "").strip(), "c": str(r.get("doc") or "").strip(), "dn": doc_name, "df": field},
        )


def delete_linkage(conn: Connection, table: str) -> None:
    conn.execute(text("DELETE FROM UtlDeletion WHERE DelTblName = :t"), {"t": (table or "").strip()})


# ---------------------------------------------------------------------------------------------------- View Search Display Fields
_FIND_COLS = ("AliasFld1", "AliasFld2", "AliasFld3", "AliasFld4", "AliasFld5")


def list_find_fields(conn: Connection) -> list[dict]:
    rows = conn.execute(
        text("SELECT TableID AS id, TableName AS tbl, StorageFld AS storage, DisplayFld AS display, AliasFld1 AS a1, AliasFld2 AS a2, AliasFld3 AS a3, AliasFld4 AS a4, AliasFld5 AS a5 FROM UtlFindFlds ORDER BY TableID")
    ).mappings().all()
    clean = lambda v: (v or "").strip()  # noqa: E731
    return [
        {"id": r["id"], "table": clean(r["tbl"]), "storage": clean(r["storage"]), "display": clean(r["display"]), **{f"alias{i}": clean(r[f"a{i}"]) for i in range(1, 6)}}
        for r in rows
    ]


def _validate_find(conn: Connection, v: dict, find_id: int | None) -> dict:
    table, storage, display = (v.get("table") or "").strip(), (v.get("storage") or "").strip(), (v.get("display") or "").strip()
    if not table:
        raise _bad("Select Table Name")
    if not storage:
        raise _bad("Select Field Name")
    if not display:
        raise _bad("Enter Display Field Name")
    if find_id is None and conn.execute(text("SELECT TableID FROM UtlFindFlds WHERE TableName = :t"), {"t": table}).first():
        raise _bad("Table Name Already Exist!", status.HTTP_409_CONFLICT)
    if not _has_table(conn, table):
        raise _bad("Selected Table Name Not Found in Transaction List! \r\nCheck Entry...")
    if not _has_column(conn, table, storage):
        raise _bad("Selected Column Name Not Found in Transaction List! \r\nCheck Entry...")
    return {"TableName": table, "StorageFld": storage, "DisplayFld": display, **{c: (v.get(f"alias{i + 1}") or "").strip() for i, c in enumerate(_FIND_COLS)}}


def save_find_field(conn: Connection, v: dict, find_id: int | None = None) -> str:
    row = _validate_find(conn, v, find_id)
    if find_id is None:
        new_id = int(conn.execute(text("SELECT ISNULL(MAX(TableID), 0) + 1 FROM UtlFindFlds")).scalar())
        insert_row(conn, "UtlFindFlds", {"TableID": new_id, **row})
        return "Saved Display Fields successfully"
    sets = ", ".join(f"{k} = :{k}" for k in row)  # keys are the constants above, never user input
    n = conn.execute(text(f"UPDATE UtlFindFlds SET {sets} WHERE TableID = :id"), {**row, "id": find_id}).rowcount
    if not n:
        raise _bad("Record not found", status.HTTP_404_NOT_FOUND)
    return "Display Fields Updated successfully"


def delete_find_field(conn: Connection, find_id: int) -> None:
    conn.execute(text("DELETE FROM UtlFindFlds WHERE TableID = :i"), {"i": find_id})


# ------------------------------------------------------------------------------------------------------------- Login Settings
def _yes(v) -> bool:
    return str(v or "N").strip().upper() == "Y"


def get_login(conn: Connection) -> dict:
    r = conn.execute(text("SELECT TOP 1 * FROM UtlMisc")).mappings().first() or {}
    num = lambda k: int(r.get(k) or 0)  # noqa: E731
    return {
        "login_required": _yes(r.get("LoginReq")),
        "role_based": not _yes(r.get("UserBased")),  # "User Based" rights or "Role Based"
        "ad_auth": _yes(r.get("ADAuth")),
        "ad_auto_login": _yes(r.get("ADAutoLogin")),
        "ad_domain": (r.get("ADDomain") or "").strip(),
        "pwd_policy": _yes(r.get("PwdPolicy")),
        "never_expires": _yes(r.get("NeverExpires")),
        "expiry_days": num("PwdExpiryDays"),
        "pwd_rules": _yes(r.get("PwdRules")),
        "min_special": num("PwdMinSplChrs"),
        "min_numeric": num("PwdMinNumeric"),
        "min_alpha": num("PwdMinAlpha"),
        "min_length": num("PwdMinLen"),
        "min_lower": num("PwdMinLCase"),
        "min_upper": num("PwdMinUCase"),
    }


def save_login(conn: Connection, v: dict) -> None:
    """Port of frmUtlLoginSettings.ValidFields + saveDetails (UtlMisc is a single-row table)."""
    ad = bool(v.get("ad_auth"))
    auto = bool(v.get("ad_auto_login"))
    domain = str(v.get("ad_domain") or "").strip().replace("'", "")
    pol, rules, never = bool(v.get("pwd_policy")), bool(v.get("pwd_rules")), bool(v.get("never_expires"))
    n = lambda k: int(float(v.get(k) or 0))  # noqa: E731
    if ad and not auto and not domain:
        raise _bad("Please enter Domain Name!!!")
    if not ad and pol and rules:
        if not never and n("expiry_days") <= 0:
            raise _bad("Please enter the Password Expiry Days!!")
        if n("min_special") + n("min_numeric") + n("min_alpha") > n("min_length"):
            raise _bad("Min. no of \r\nSpecial Character + Alphabets + Numeric\r\nshould not be less than the Password length!!")
        if n("min_alpha") != n("min_lower") + n("min_upper"):
            raise _bad("Mni. No of \r\nLowerCase + UpperCase\r\nshould be equal to Alphabets Length!!")
    yn = lambda b: "Y" if b else "N"  # noqa: E731
    sets: dict[str, object] = {"LoginReq": yn(v.get("login_required")), "UserBased": yn(not v.get("role_based"))}
    cleared = {"PwdRules": "N", "NeverExpires": "N", "PwdExpiryDays": 0, "PwdMinSplChrs": 0, "PwdMinNumeric": 0, "PwdMinAlpha": 0, "PwdMinLen": 0}
    if ad:
        sets.update({"ADAuth": "Y", "ADAutoLogin": yn(auto), "ADDomain": "" if auto else domain, **cleared})
    else:
        sets.update({"ADAuth": "N", "ADAutoLogin": "N", "ADDomain": ""})
        if pol:
            sets.update({"PwdPolicy": "Y", "NeverExpires": yn(never), "PwdExpiryDays": 0 if never else n("expiry_days")})
            if rules:
                sets.update({"PwdRules": "Y", "PwdMinSplChrs": n("min_special"), "PwdMinNumeric": n("min_numeric"), "PwdMinAlpha": n("min_alpha"),
                             "PwdMinLen": n("min_length"), "PwdMinLCase": n("min_lower"), "PwdMinUCase": n("min_upper")})
            else:
                sets.update({"PwdRules": "N", "PwdMinSplChrs": 0, "PwdMinNumeric": 0, "PwdMinAlpha": 0, "PwdMinLen": 0})
        else:
            sets.update({"PwdPolicy": "N", **cleared})
    cols = {r[0].lower() for r in conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UtlMisc'"))}
    sets = {k: val for k, val in sets.items() if k.lower() in cols}
    conn.execute(text("UPDATE UtlMisc SET " + ", ".join(f"{k} = :{k}" for k in sets)), sets)  # keys are the constants above
    from app.meta import menu as meta_menu

    meta_menu.invalidate()  # UserBased changes how rights are resolved


# ------------------------------------------------------------------------------------------------------ Doc Prefix Settings
_F = [f"F{i}" for i in range(1, 15)]


def get_docno(conn: Connection) -> dict:
    """frmUtlDocNumber: every non-master document with its number format (UtlDocNoFmt F1..F14) and continuation group."""
    from app.core.fy import get_active_fy

    docs = conn.execute(text("SELECT DocID, DocName, ContDocNoGroup FROM UtlTransactions WHERE DocType <> 'Master' ORDER BY DocName")).mappings().all()
    fmt = {int(r["DocID"]): r for r in conn.execute(text("SELECT * FROM UtlDocNoFmt")).mappings().all()}
    out = []
    for d in docs:
        f = fmt.get(int(d["DocID"]))
        out.append(
            {
                "doc_id": int(d["DocID"]),
                "name": (d["DocName"] or "").strip(),
                "cont_group": (d["ContDocNoGroup"] or "").strip(),
                "has_format": f is not None,
                "pfx_reset": f is not None and _yes(f.get("PfxWiseResetNo") if f.get("PfxWiseResetNo") is not None else "Y"),
                "docno_change": f is not None and _yes(f.get("DocNoChange") if f.get("DocNoChange") is not None else "Y"),
                "f": [(f.get(c) or "").strip() if f is not None else "" for c in _F],
            }
        )
    fy = get_active_fy(conn)
    y1, y2 = fy.start_date.year, fy.end_date.year
    # the legacy "Example" grid: what each numbered token (1..10) stands for
    tokens = ["LOC", str(y1), str(y2), str(y1)[-2:], str(y2)[-2:], "00001", "1", "0001", "001", "000001"]
    return {"documents": out, "example_tokens": tokens}


def save_docno(conn: Connection, rows: list[dict]) -> None:
    """Port of btnSave_Click: validate, write every document's format and ContDocNoGroup. Existing UtlDocNoFmt rows are
    updated in place (so columns the form does not show, such as Misc1..3, are kept); missing ones are inserted."""
    for r in rows:
        f = [str(x or "").strip() for x in (r.get("f") or [])] + [""] * 14
        r["f"] = f[:14]
        if r["f"][13] and not any(x in ("7", "8", "9", "10") for x in r["f"]):
            raise _bad("Invalid combinations!")
    known = {int(x) for x in conn.execute(text("SELECT DocID FROM UtlTransactions WHERE DocType <> 'Master'")).scalars().all()}
    for r in rows:
        doc_id = int(r["doc_id"])
        if doc_id not in known:
            raise _bad("Please select a document!")
        vals = {"PfxWiseResetNo": "Y" if r.get("pfx_reset") else "N", "DocNoChange": "Y" if r.get("docno_change") else "N", **{c: r["f"][i] for i, c in enumerate(_F)}}
        if conn.execute(text("SELECT 1 FROM UtlDocNoFmt WHERE DocID = :d"), {"d": doc_id}).first():
            conn.execute(text("UPDATE UtlDocNoFmt SET " + ", ".join(f"{k} = :{k}" for k in vals) + " WHERE DocID = :d"), {**vals, "d": doc_id})
        else:
            conn.execute(text("INSERT INTO UtlDocNoFmt (DocID, " + ", ".join(vals) + ") VALUES (:d, " + ", ".join(f":{k}" for k in vals) + ")"), {**vals, "d": doc_id})
        conn.execute(text("UPDATE UtlTransactions SET ContDocNoGroup = :g WHERE DocID = :d"), {"g": str(r.get("cont_group") or "").strip(), "d": doc_id})
    from app.core import cache

    cache.clear()  # numbering metadata


def get_prefixes(conn: Connection, doc_id: int) -> dict:
    rows = conn.execute(text("SELECT Prefix, CndOperator, CndFldCode, CndFldValue FROM UtlDocNoPrefix WHERE DocID = :d ORDER BY Prefix"), {"d": doc_id}).mappings().all()
    hdr = conn.execute(text("SELECT HdrTblName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).scalar()
    cols = columns(conn, (hdr or "").strip()) if hdr and (hdr or "").strip() else []
    return {
        "rows": [{"prefix": (r["Prefix"] or "").strip(), "operator": (r["CndOperator"] or "").strip(), "field": (r["CndFldCode"] or "").strip(), "value": (r["CndFldValue"] or "").strip()} for r in rows],
        "columns": cols,
    }


def save_prefixes(conn: Connection, doc_id: int, rows: list[dict]) -> str:
    """Port of pfxValid + btnPSave_Click: no duplicate prefix, an operator wherever a field is given."""
    clean = [{k: str(r.get(k) or "").strip() for k in ("prefix", "operator", "field", "value")} for r in rows]
    seen: set[tuple] = set()
    for i, r in enumerate(clean, start=1):
        key = (r["prefix"].upper(), r["operator"], r["field"].upper(), r["value"].upper())
        if key in seen:
            raise _bad(f"Duplicate prefix at row {i}")
        seen.add(key)
    for r in clean:
        if r["field"] and not r["operator"]:
            raise _bad("Please select the operator !!")
        if not r["field"]:
            r["operator"] = ""
            r["value"] = ""
    if not conn.execute(text("SELECT 1 FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).first():
        raise _bad("Please select a document!")
    conn.execute(text("DELETE FROM UtlDocNoPrefix WHERE DocID = :d"), {"d": doc_id})
    for r in clean:
        conn.execute(
            text("INSERT INTO UtlDocNoPrefix (DocID, Prefix, CndOperator, CndFldCode, CndFldValue) VALUES (:d, :p, :o, :f, :v)"),
            {"d": doc_id, "p": r["prefix"], "o": r["operator"], "f": r["field"], "v": r["value"]},
        )
    from app.core import cache

    cache.clear()
    return "Please Fill Details" if len(clean) == 1 and not any(clean[0].values()) else "Saved Successfully!!"


# ------------------------------------------------------------------------------------- Transaction / Voucher Settings
# Port of FrmUtlTrnSettings: the per-document switches the whole app reads from UtlTransactions. (kind: flag = 'Y'/'N',
# text, number, list). `help` is a short note on what the switch does in the web app.
TRN_SECTIONS: list[dict] = [
    {
        "title": "Main",
        "fields": [
            ("AllowCopyFrom", "Allow Copy From", "flag", "Shows Copy From on the entry screen."),
            ("AmmReq", "Ammendment Required", "flag", "Enables Amendment (needs the Ammendment / AmmNo / AmmDate columns)."),
            ("MultiDocGen", "Multi Doc Generation", "flag", "Allows generating several documents in one go."),
            ("AllowImpExp", "Allow Import Export", "flag", "Shows the Excel export / template / import options."),
            ("blnEnvPrint", "Envelope Print", "flag", "Envelope printing from the document."),
            ("AllowEditDocDate", "Allow Edit Doc Date", "flag", "Lets the user change the document date."),
            ("FileAttachReq", "File Attachment Required", "flag", "Shows the Attachment option."),
            ("OffLineCalc", "Offline Calculation", "flag", "Totals are calculated on save, not while typing."),
            ("FldBlnDateRestrictWithInLastTrn", "Doc Date Restrict With in Last Transaction Date", "flag", "The date cannot be earlier than the last saved document."),
            ("ShowFullFinData", "Show Data across Fin Years in Search", "flag", "Search lists documents of every financial year."),
            ("PrintCancelled", "Print Cancelled Document", "flag", "Cancelled documents may be printed."),
            ("GeneratePDF", "Generate PDF", "flag", "A PDF is generated after saving."),
            ("PDFPreview", "PDF Print Preview", "flag", "Show a preview before printing."),
            ("BlnAllowDuplicateItems", "Allow Duplicate Items", "flag", "The same item may be repeated in the lines."),
            ("AllowTenderChange", "Allow Tender Change", "flag", "Tender / change fields on the document."),
            ("TenderChangeFld", "Tender Change Field", "text", "Field that holds the tender change (when Allow Tender Change is on)."),
            ("AttFilePath", "Attachment Path", "text", "A separate folder for this document's attachments ('-' = the common one)."),
        ],
    },
    {
        "title": "Authorization",
        "fields": [
            ("AuthReq", "Authorization Required", "flag", "New documents need authorising before they are final."),
            ("NoOfAuth", "No of Auth", "number", "How many authorisations are needed."),
            ("NoOfAuthQueryCond", "No of Auth Query Condition", "text", "Condition that decides the number of authorisations."),
            ("AllowAdminAuthEdit", "Allow To Edit For Admin After Authorization", "flag", "ADMIN may edit an authorised document."),
            ("AccResLimit", "Credit Limit Restriction Required", "flag", "Stops a document that exceeds the party's credit limit."),
        ],
    },
    {
        "title": "Freeze",
        "fields": [
            ("blnFreezeDoc", "Freeze Document", "flag", "Documents older than the days below cannot be edited or deleted."),
            ("AllowEditDeleteForDays", "Allow Editing/Deleting upto (Days)", "number", "Number of days a document stays editable."),
        ],
    },
    {
        "title": "Party / Item",
        "fields": [
            ("AllowManualPartySel", "Manual Party Selection", "flag", ""),
            ("ShowShipAdd", "Show Shipping Address", "flag", ""),
            ("SavePartyData", "Save Party Data", "flag", ""),
            ("FldBlnEnforcePartyItemLink", "Enforce Party Item Link", "flag", ""),
            ("PartyFilterCond", "Party Filter Condition", "text", ""),
            ("RateFldPartyItem", "Party vs Item Rate", "text", ""),
            ("ItemFilterCond", "Item Filter Condition", "text", ""),
            ("RateFldMstItem", "Rate Mst Item", "text", ""),
            ("FldBlnPCat", "Price Category", "flag", ""),
        ],
    },
    {
        "title": "Stock",
        "fields": [
            ("AffectsStock", "Affects Stock", "list", "Add / Reduce, or blank for no stock effect."),
            ("AllowLoadFromBOM", "Load From BOM", "flag", ""),
            ("ReduceFromBOM", "Reduce From BOM", "flag", ""),
            ("ShowGraceQty", "Show Grace Quantity", "flag", ""),
            ("ShowStkLevelAlert", "Stock Level Alert", "flag", ""),
            ("StkLevelAlertFldName", "Stock Level Field (item Master)", "list", ""),
        ],
    },
    {
        "title": "Pending query",
        "fields": [
            ("LinkedPendingParty", "Linked Pending Party", "flag", ""),
            ("LinkedPendingDocNo", "Linked Pending Doc No", "flag", ""),
            ("LinkedPendingSingleDoc", "Linked Pending Single Doc", "flag", ""),
            ("PendingQryFlds", "Query Fields", "text", ""),
            ("PendingQryTbls", "Query Tables", "text", ""),
            ("PendingQryCond", "Query Condition", "text", ""),
            ("PickFldsFromSrc", "Pick Flds Frm Src", "text", ""),
            ("PickFldsFromSrcDocQry", "Pick Flds Frm Doc Qry", "text", ""),
            ("PendingQryFldSeq", "Pending Query Field Sequence", "text", ""),
            ("PendingQryFldHide", "Pending Query Hidden Fields", "text", ""),
            ("PWAShowQry", "PWA Show Query", "text", ""),
        ],
    },
    {
        "title": "Vouchers",
        "fields": [
            ("BalanceColReq", "Balance Column Required", "flag", ""),
            ("BillWiseFeatureReq", "Bill wise Feature Required", "flag", "Bill-by-bill details on the voucher."),
            ("ChqPrintReq", "Cheque Printing", "flag", ""),
            ("DefFirstRowAmtType", "Default First Row Type", "list", "Dr or Cr for the first line of a new voucher."),
        ],
    },
]
# Master Settings (FrmUtlMstSettings) is the same form for the master documents, plus the special-character restriction
MASTER_EXTRA_SECTION = {
    "title": "Special characters",
    "fields": [
        ("FldBlnRestrictSplCharCode", "Restrict Special Characters in Code", "flag", "The characters listed below are removed from the code when a record is saved."),
        ("FldStrSplCharCode", "Characters not allowed in Code", "text", ""),
        ("FldBlnRestrictSplCharName", "Restrict Special Characters in Name", "flag", "The characters listed below are removed from the name when a record is saved."),
        ("FldStrSplCharName", "Characters not allowed in Name", "text", ""),
    ],
}
_TRN_LISTS = {"AffectsStock": ["", "Add", "Reduce"], "StkLevelAlertFldName": ["", "D", "C"], "DefFirstRowAmtType": ["", "Dr", "Cr"]}
_TRN_FIELDS = {f[0]: f for s in [*TRN_SECTIONS, MASTER_EXTRA_SECTION] for f in s["fields"]}
_DOC_TYPES = {"trn": ("Transaction", "Voucher"), "master": ("Master",)}
# tabs the legacy Master Settings form does not show (it has no vouchers / stock / pending-query pages)
_MASTER_SKIP = {"Vouchers", "Stock", "Pending query"}


def trn_documents(conn: Connection, kind: str = "trn") -> list[dict]:
    types = _DOC_TYPES[kind]
    rows = conn.execute(
        text("SELECT DocID, DocName, DocType FROM UtlTransactions WHERE DocType IN :t ORDER BY DocName").bindparams(bindparam("t", expanding=True)), {"t": list(types)}
    ).mappings().all()
    return [{"doc_id": int(r["DocID"]), "name": (r["DocName"] or "").strip(), "type": (r["DocType"] or "").strip()} for r in rows]


def get_trn_settings(conn: Connection, doc_id: int, kind: str = "trn") -> dict:
    row = conn.execute(
        text("SELECT * FROM UtlTransactions WHERE DocID = :d AND DocType IN :t").bindparams(bindparam("t", expanding=True)), {"d": doc_id, "t": list(_DOC_TYPES[kind])}
    ).mappings().first()
    if row is None:
        raise _bad("Document Not Found", status.HTTP_404_NOT_FOUND)
    have = {k.lower(): k for k in row.keys()}
    sections = []
    values: dict[str, object] = {}
    for s in ([x for x in TRN_SECTIONS if x["title"] not in _MASTER_SKIP] + [MASTER_EXTRA_SECTION]) if kind == "master" else TRN_SECTIONS:
        fields = []
        for key, caption, kind, help_ in s["fields"]:
            if key.lower() not in have:  # the live table wins: a column this database does not have is not offered
                continue
            raw = row[have[key.lower()]]
            if kind == "flag":
                values[key] = _yes(raw)
            elif kind == "number":
                values[key] = int(raw or 0)
            else:
                # the character lists keep their spaces: a space is itself one of the characters
                values[key] = (raw if key.startswith("FldStrSplChar") else (raw or "").strip()) if isinstance(raw, str) else ""
            opts = list(_TRN_LISTS.get(key, []))
            if key in _TRN_LISTS and values[key] and values[key] not in opts:
                opts.append(values[key])  # a value the temple already has (e.g. 'NA') stays selectable
            fields.append({"key": key, "caption": caption, "kind": kind, "help": help_, **({"options": opts} if key in _TRN_LISTS else {})})
        if fields:
            sections.append({"title": s["title"], "fields": fields})
    return {"doc_id": doc_id, "name": (row["DocName"] or "").strip(), "sections": sections, "values": values}


def save_trn_settings(conn: Connection, doc_id: int, values: dict, kind: str = "trn") -> None:
    """Writes only the switches that were sent (the legacy form rewrote all of them from its controls)."""
    cur = get_trn_settings(conn, doc_id, kind)
    allowed = {f["key"] for s in cur["sections"] for f in s["fields"]}
    sets: dict[str, object] = {}
    for key, v in values.items():
        if key not in allowed:
            continue
        kind = _TRN_FIELDS[key][2]
        old = cur["values"].get(key)
        if (kind == "flag" and bool(v) == bool(old)) or (kind == "number" and int(float(v or 0)) == int(old or 0)) or (kind not in ("flag", "number") and (str(v or "") if key.startswith("FldStrSplChar") else str(v or "").strip()) == str(old or "")):
            continue  # unchanged: leave the column exactly as it is
        if kind == "flag":
            sets[key] = "Y" if v else "N"
        elif kind == "number":
            sets[key] = int(float(v or 0))
        else:
            val = str(v or "") if key.startswith("FldStrSplChar") else str(v or "").strip()
            if key in _TRN_LISTS and val not in _TRN_LISTS[key] and val != str(cur["values"].get(key) or ""):
                raise _bad(f"{_TRN_FIELDS[key][1]}: invalid value")
            sets[key] = val
    # dependent switches, as the legacy save wrote them
    merged = {**cur["values"], **{k: (v == "Y") if _TRN_FIELDS[k][2] == "flag" else v for k, v in sets.items()}}
    if "AuthReq" in sets and not merged["AuthReq"]:
        sets.update({k: v for k, v in (("NoOfAuth", 0), ("NoOfAuthQueryCond", "")) if k in allowed})
    if "blnFreezeDoc" in sets and not merged["blnFreezeDoc"] and "AllowEditDeleteForDays" in allowed:
        sets["AllowEditDeleteForDays"] = 0
    if "AllowTenderChange" in sets and not merged["AllowTenderChange"] and "TenderChangeFld" in allowed:
        sets["TenderChangeFld"] = ""
    if merged.get("blnFreezeDoc") and int(merged.get("AllowEditDeleteForDays") or 0) < 0:
        raise _bad("Allow Editing/Deleting upto (Days) cannot be negative")
    if not sets:
        return
    conn.execute(text("UPDATE UtlTransactions SET " + ", ".join(f"{k} = :{k}" for k in sets) + " WHERE DocID = :d"), {**sets, "d": doc_id})  # keys are the constants above
    from app.core import cache

    cache.clear()


def get_misc(conn: Connection) -> dict:
    r = conn.execute(text("SELECT TOP 1 * FROM UtlMisc")).mappings().first() or {}
    return {
        "item_caption": (r.get("ItemCaption") or "").strip(),
        "item_name_caption": (r.get("ItemNameCaption") or "").strip(),
        "item_desc_caption": (r.get("ItemDescCaption") or "").strip(),
        "search_top_n": int(r.get("FldSearchTopN") or 0),
        "show_menu_icons": _yes(r.get("ShowMenuIcons")),
    }


def save_misc(conn: Connection, v: dict) -> None:
    sets = {
        "ItemCaption": str(v.get("item_caption") or "").replace("'", "`").strip(),
        "ItemNameCaption": str(v.get("item_name_caption") or "").replace("'", "`").strip(),
        "ItemDescCaption": str(v.get("item_desc_caption") or "").replace("'", "`").strip(),
        "FldSearchTopN": int(v.get("search_top_n") or 0),
        "ShowMenuIcons": "Y" if v.get("show_menu_icons") else "N",
    }
    conn.execute(text("UPDATE UtlMisc SET " + ", ".join(f"{k} = :{k}" for k in sets)), sets)
    from app.core import cache

    cache.clear()


# ------------------------------------------------------------------------------------------------------- Filter Settings
_STRING_TYPES = ("char", "varchar", "nchar", "nvarchar")


def filter_documents(conn: Connection, kind: str) -> list[dict]:
    """frmUtlFilterSettings: 'Apply Filter On' Masters or Transactions."""
    t = "Master" if kind == "master" else "Transaction"
    rows = conn.execute(text("SELECT DocID, DocName FROM UtlTransactions WHERE DocType = :t ORDER BY DocName"), {"t": t}).mappings().all()
    return [{"doc_id": int(r["DocID"]), "name": (r["DocName"] or "").strip()} for r in rows]


def get_filter(conn: Connection, doc_id: int) -> dict:
    """The text columns of the document's header table (what its search list can be filtered on), each with its designer caption."""
    hdr = conn.execute(text("SELECT HdrTblName, DocName FROM UtlTransactions WHERE DocID = :d"), {"d": doc_id}).mappings().first()
    if hdr is None:
        raise _bad("Document not found!", status.HTTP_404_NOT_FOUND)
    table = (hdr["HdrTblName"] or "").strip()
    cols = conn.execute(
        text("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = :t ORDER BY ORDINAL_POSITION"), {"t": table}
    ).all()
    captions = {(r[0] or "").strip().lower(): (r[1] or "").strip() for r in conn.execute(text("SELECT FldCode, FldCaption FROM UtlDocDsgrFlds WHERE DocID = :d"), {"d": doc_id})}
    chosen = {(r[0] or "").strip().lower(): (r[1] or "").strip() for r in conn.execute(text("SELECT FldCode, FldCaption FROM UtlFilterSettings WHERE DocID = :d"), {"d": doc_id})}
    items = []
    for name, typ in cols:
        if typ.lower() not in _STRING_TYPES:
            continue
        key = name.lower()
        items.append({"code": name, "caption": captions.get(key) or name, "selected": key in chosen})
    return {"doc_id": doc_id, "name": (hdr["DocName"] or "").strip(), "items": items}


def save_filter(conn: Connection, doc_id: int, items: list[dict]) -> None:
    valid = {i["code"] for i in get_filter(conn, doc_id)["items"]}
    conn.execute(text("DELETE FROM UtlFilterSettings WHERE DocID = :d"), {"d": doc_id})
    for it in items:
        if it.get("selected") and it.get("code") in valid:
            conn.execute(text("INSERT INTO UtlFilterSettings (DocID, FldCode, FldCaption) VALUES (:d, :c, :p)"), {"d": doc_id, "c": it["code"], "p": str(it.get("caption") or it["code"]).strip()})


def delete_filter(conn: Connection, doc_id: int) -> None:
    conn.execute(text("DELETE FROM UtlFilterSettings WHERE DocID = :d"), {"d": doc_id})


# -------------------------------------------------------------------------------------------- Form Userwise Settings
_FORM_FLAGS = ("Header", "Detail", "Footer", "Total", "NewMode", "LoadLastTrnNo", "FullScreen")
_AFTER_SAVE = {"-": "-", "N": "New Doc", "S": "Save Doc", "C": "Clear Doc"}


def get_form_settings(conn: Connection, user_id: int) -> list[dict]:
    """frmUtlFormSettings: the signed-in user's own per-document form preferences (header / detail / footer / total grids,
    new mode, load last transaction, full screen, what happens after a save)."""
    docs = conn.execute(text("SELECT DocID, DocName FROM UtlTransactions WHERE DocType = 'Transaction' ORDER BY DocName")).mappings().all()
    saved = {int(r["DocID"]): r for r in conn.execute(text("SELECT * FROM UtlFormSettings WHERE UserID = :u"), {"u": user_id}).mappings().all()}
    out = []
    for d in docs:
        s = saved.get(int(d["DocID"]))
        out.append(
            {
                "doc_id": int(d["DocID"]),
                "name": (d["DocName"] or "").strip(),
                **{k.lower(): bool(s) and _yes(s.get(k)) for k in _FORM_FLAGS},
                "after_save": (s.get("AfterSave") or "-").strip() if s else "-",
            }
        )
    return out


def save_form_settings(conn: Connection, user_id: int, rows: list[dict]) -> None:
    """Port of btnSave_Click: the user's rows are replaced; a document with none of the seven boxes ticked is not stored."""
    known = {int(x) for x in conn.execute(text("SELECT DocID FROM UtlTransactions WHERE DocType = 'Transaction'")).scalars().all()}
    conn.execute(text("DELETE FROM UtlFormSettings WHERE UserID = :u"), {"u": user_id})
    for r in rows:
        if int(r["doc_id"]) not in known or not any(r.get(k.lower()) for k in _FORM_FLAGS):
            continue
        after = str(r.get("after_save") or "-")
        if after not in _AFTER_SAVE:
            after = "-"
        vals = {k: "Y" if r.get(k.lower()) else "N" for k in _FORM_FLAGS}
        conn.execute(
            text("INSERT INTO UtlFormSettings (UserID, DocID, Header, Detail, Footer, Total, NewMode, LoadLastTrnNo, FullScreen, AfterSave) VALUES (:u, :d, :Header, :Detail, :Footer, :Total, :NewMode, :LoadLastTrnNo, :FullScreen, :a)"),
            {"u": user_id, "d": int(r["doc_id"]), "a": after, **vals},
        )


# --------------------------------------------------------------------------------------------------------- Stock Settings
_STK_ACTIONS = {"S": "Save", "A": "Auth", "Q": "QC"}
_STK_COLS = ("AffectsStock", "AffectsStockFld", "StkAffOnSaveOrAuthOrQC", "QtyFldName", "ValuationReq", "RateFldName", "LocFldName", "Loc2FldName", "RejLocName", "RejFldName")


def list_stock_settings(conn: Connection) -> dict:
    """frmUtlStkSettings: how each transaction affects stock (Add / Reduce / Transfer / NA) and which of its fields carry the
    quantity, rate, location(s) and rejection. The field lists come from the document's own Detail-section designer fields."""
    rows = conn.execute(text("SELECT * FROM UtlTransactions WHERE DocType = 'Transaction' ORDER BY DocName")).mappings().all()
    have = {k.lower(): k for k in (rows[0].keys() if rows else [])}
    # the legacy combos: Qty / Rate take the Detail section's numeric fields; the location, rejection and affect fields take
    # every field prefixed "d." (Detail section) or "h." (any other section)
    numeric: dict[int, list[str]] = {}
    prefixed: dict[int, list[str]] = {}
    for r in conn.execute(text("SELECT DocID, FldCode, FldSection, FldDataType FROM UtlDocDsgrFlds ORDER BY FldCode")).all():
        did, code, sec, typ = int(r[0]), (r[1] or "").strip(), (r[2] or "").strip(), (r[3] or "").strip()
        prefixed.setdefault(did, []).append(("d." if sec.lower() == "detail" else "h.") + code)
        if sec.lower() == "detail" and typ.lower() == "numeric":
            numeric.setdefault(did, []).append(code)
    out = []
    g = lambda r, k: (r[have[k.lower()]] or "") if k.lower() in have else ""  # noqa: E731
    for r in rows:
        did = int(r["DocID"])
        action = str(g(r, "StkAffOnSaveOrAuthOrQC")).strip()
        out.append(
            {
                "doc_id": did,
                "name": (r["DocName"] or "").strip(),
                "affects": str(g(r, "AffectsStock")).strip(),
                "affects_fld": str(g(r, "AffectsStockFld")).strip(),
                "action": _STK_ACTIONS.get(action, ""),
                "qty_fld": str(g(r, "QtyFldName")).strip(),
                "valuation": str(g(r, "ValuationReq")).strip(),
                "rate_fld": str(g(r, "RateFldName")).strip(),
                "loc_fld": str(g(r, "LocFldName")).strip(),
                "loc2_fld": str(g(r, "Loc2FldName")).strip(),
                "rej_loc": str(g(r, "RejLocName")).strip(),
                "rej_fld": str(g(r, "RejFldName")).strip(),
                "numeric_fields": sorted(set(numeric.get(did, []))),
                "fields": sorted(set(prefixed.get(did, []))),
            }
        )
    return {"documents": out, "locations": [r[0].strip() for r in conn.execute(text("SELECT LocCode FROM MstLoc WHERE LocID > 0 ORDER BY LocCode")).all()]}


def save_stock_settings(conn: Connection, rows: list[dict]) -> None:
    """Port of validflds + btnSave_Click. Rows that do not affect stock (blank / NA) have their quantity, rate, valuation and
    location fields cleared first; the rest must be complete. Only documents whose values changed are written."""
    current = {d["doc_id"]: d for d in list_stock_settings(conn)["documents"]}
    for r in rows:
        if str(r.get("affects") or "").strip() in ("", "NA"):
            for k in ("qty_fld", "rate_fld", "valuation", "loc_fld", "loc2_fld"):
                r[k] = ""
            continue
        if not str(r.get("qty_fld") or "").strip():
            raise _bad("Qty Field Can't be empty....")
        if not str(r.get("action") or "").strip():
            raise _bad("Stock Affect On Action is empty....")
        rej_loc, rej_fld = str(r.get("rej_loc") or "").strip(), str(r.get("rej_fld") or "").strip()
        if rej_loc:
            if not conn.execute(text("SELECT LocID FROM MstLoc WHERE LocCode = :c"), {"c": rej_loc}).first():
                raise _bad("Reject Location Not Available in Location Master...")
            if not rej_fld:
                raise _bad("Please enter rejection field name or clear rejection location cell value....")
        if not str(r.get("loc_fld") or "").strip():
            raise _bad("Location Field Can't be empty....")
        if not str(r.get("valuation") or "").strip():
            raise _bad("Valuation Field Can't be empty....")
        if str(r.get("valuation")).strip() == "N" and not str(r.get("rate_fld") or "").strip():
            raise _bad("Rate Field Can't be empty....")
        if str(r.get("loc_fld") or "").strip() == str(r.get("loc2_fld") or "").strip():
            raise _bad("From Location and To Location Can't be same....")
    for r in rows:
        cur = current.get(int(r["doc_id"]))
        if cur is None:
            continue
        new = {
            "AffectsStock": str(r.get("affects") or "").strip(),
            "AffectsStockFld": str(r.get("affects_fld") or "").strip(),
            "StkAffOnSaveOrAuthOrQC": str(r.get("action") or "").strip()[:1],
            "RejLocName": str(r.get("rej_loc") or "").strip(),
            "RejFldName": str(r.get("rej_fld") or "").strip(),
            "QtyFldName": str(r.get("qty_fld") or "").strip(),
            "ValuationReq": str(r.get("valuation") or "").strip(),
            "RateFldName": str(r.get("rate_fld") or "").strip(),
            "LocFldName": str(r.get("loc_fld") or "").strip(),
            "Loc2FldName": str(r.get("loc2_fld") or "").strip(),
        }
        old = {
            "AffectsStock": cur["affects"], "AffectsStockFld": cur["affects_fld"], "StkAffOnSaveOrAuthOrQC": {v: k for k, v in _STK_ACTIONS.items()}.get(cur["action"], ""),
            "RejLocName": cur["rej_loc"], "RejFldName": cur["rej_fld"], "QtyFldName": cur["qty_fld"], "ValuationReq": cur["valuation"],
            "RateFldName": cur["rate_fld"], "LocFldName": cur["loc_fld"], "Loc2FldName": cur["loc2_fld"],
        }
        changed = {k: v for k, v in new.items() if v != old[k]}
        if changed:
            conn.execute(text("UPDATE UtlTransactions SET " + ", ".join(f"{k} = :{k}" for k in changed) + " WHERE DocID = :d"), {**changed, "d": int(r["doc_id"])})  # keys are the constants above
    from app.core import cache

    cache.clear()


# ---------------------------------------------------------------------------------------------------------- Post Doc List
def list_post_docs(conn: Connection) -> list[dict]:
    rows = conn.execute(text("SELECT PostDocID, PostDocName, PostDocRmks, CondText, PendCond FROM UtlPDE ORDER BY PostDocID")).mappings().all()
    return [{"id": r["PostDocID"], "name": (r["PostDocName"] or "").strip(), "remarks": (r["PostDocRmks"] or "").strip(), "condition": (r["CondText"] or "").strip(), "pending_condition": (r["PendCond"] or "").strip()} for r in rows]


def get_post_doc(conn: Connection, pid: int) -> dict:
    h = conn.execute(text("SELECT * FROM UtlPDE WHERE PostDocID = :i"), {"i": pid}).mappings().first()
    if h is None:
        raise _bad("Record not found", status.HTTP_404_NOT_FOUND)
    det = conn.execute(text("SELECT Slno, TblName, FldName, FldCaption, DateFilter, ColHide, AllowEdit FROM UtlPDEDtl WHERE PostDocID = :i ORDER BY Slno"), {"i": pid}).mappings().all()
    pk = conn.execute(text("SELECT Slno, TblName, FldName FROM UtlPDEPK WHERE PostDocID = :i ORDER BY Slno"), {"i": pid}).mappings().all()
    return {
        "id": pid,
        "name": (h["PostDocName"] or "").strip(),
        "remarks": (h["PostDocRmks"] or "").strip(),
        "condition": (h["CondText"] or "").strip(),
        "pending_condition": (h["PendCond"] or "").strip(),
        "columns": [{"table": (r["TblName"] or "").strip(), "field": (r["FldName"] or "").strip(), "caption": (r["FldCaption"] or "").strip(), "date_filter": _yes(r["DateFilter"]), "hide": _yes(r["ColHide"]), "allow_edit": _yes(r["AllowEdit"])} for r in det],
        "primary": [{"table": (r["TblName"] or "").strip(), "field": (r["FldName"] or "").strip()} for r in pk],
    }


def save_post_doc(conn: Connection, pid: int | None, v: dict) -> tuple[int, str]:
    """frmUtlPostDocDesign.ValidFields + SaveDoc."""
    name = str(v.get("name") or "").strip()
    cond, pend = str(v.get("condition") or "").strip(), str(v.get("pending_condition") or "").strip()
    if not name:
        raise _bad("Name should not be blank!!")
    if not cond:
        raise _bad("Condition should not be blank!!")
    if not pend:
        raise _bad("Pending Condition should not be blank!!")
    cols = [c for c in (v.get("columns") or []) if str(c.get("table") or "").strip() and str(c.get("field") or "").strip()]
    pks = [c for c in (v.get("primary") or []) if str(c.get("table") or "").strip() and str(c.get("field") or "").strip()]
    if not any(p["table"].strip() == c["table"].strip() and p["field"].strip() == c["field"].strip() for p in pks for c in cols):
        raise _bad("Please enter Report Columns..")
    for c in [*cols, *pks]:
        if not _has_table(conn, c["table"].strip()) or not _has_column(conn, c["table"].strip(), c["field"].strip()):
            raise _bad(f"Column {c['field']} does not exist in {c['table']}")
    rmks = str(v.get("remarks") or "").strip()
    if pid is None:
        conn.execute(text("INSERT INTO UtlPDE (PostDocName, PostDocRmks, CondText, PendCond) VALUES (:n, :r, :c, :p)"), {"n": name, "r": rmks, "c": cond, "p": pend})
        pid = int(conn.execute(text("SELECT MAX(PostDocID) FROM UtlPDE")).scalar())
        msg = "PDE Created Successfully...."
    else:
        n = conn.execute(text("UPDATE UtlPDE SET PostDocRmks = :r, CondText = :c, PendCond = :p WHERE PostDocID = :i"), {"r": rmks, "c": cond, "p": pend, "i": pid}).rowcount
        if not n:
            raise _bad("Record not found", status.HTTP_404_NOT_FOUND)
        conn.execute(text("DELETE FROM UtlPDEDtl WHERE PostDocID = :i"), {"i": pid})
        conn.execute(text("DELETE FROM UtlPDEPK WHERE PostDocID = :i"), {"i": pid})
        msg = "PDE Updated Successfully...."
    for i, c in enumerate(cols, start=1):
        conn.execute(
            text("INSERT INTO UtlPDEDtl (PostDocID, Slno, TblName, FldName, FldCaption, DateFilter, ColHide, AllowEdit) VALUES (:i, :s, :t, :f, :c, :d, :h, :e)"),
            {"i": pid, "s": i, "t": c["table"].strip(), "f": c["field"].strip(), "c": str(c.get("caption") or "").strip(), "d": "Y" if c.get("date_filter") else "N", "h": "Y" if c.get("hide") else "N", "e": "Y" if c.get("allow_edit") else "N"},
        )
    for i, c in enumerate(pks, start=1):
        conn.execute(text("INSERT INTO UtlPDEPK (PostDocID, Slno, TblName, FldName) VALUES (:i, :s, :t, :f)"), {"i": pid, "s": i, "t": c["table"].strip(), "f": c["field"].strip()})
    return pid, msg


def delete_post_doc(conn: Connection, pid: int) -> None:
    # the legacy list only deletes the UtlPDE row; the detail rows are removed with it so nothing is left orphaned
    conn.execute(text("DELETE FROM UtlPDEDtl WHERE PostDocID = :i"), {"i": pid})
    conn.execute(text("DELETE FROM UtlPDEPK WHERE PostDocID = :i"), {"i": pid})
    conn.execute(text("DELETE FROM UtlPDE WHERE PostDocID = :i"), {"i": pid})
