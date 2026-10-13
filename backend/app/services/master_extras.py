"""
Extras around the generic master screen, ported from the legacy forms:

* `frmMstGeneral` Options menu: Approve / revoke (when `UtlTransactions.AuthReq='Y'`) and Attach Seva (Sannidhi, `frmUtlAttachSeva`)
* `svtModule.blnDeleteOK`: the metadata-driven "used elsewhere" check on delete (`UtlDeletion`)
* `frmMstParty` sub-screens: Multi Address, Contact Person, Alert Message, Activities (`MstPartyAddress`,
  `MstPartyContacts`, `MstPartyAlertMessage`, `MstPartyActivity`)
* Item picture (`ItemImage\\<ItemCode>.jpg`) and contact picture (`custfiles\\contactfiles\\<CID>.jpg`), kept in the
  same folders the legacy EXE uses (siblings of the attachments folder).

Every write goes through `insert_row` / `update_row` (real columns only, computed ones skipped) with bound parameters.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.config import get_settings
from app.legacy.tables import insert_row, next_master_id, update_row
from app.services.masters import MasterMeta

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _rpts_dir() -> Path:
    # attachments_path is <Rpts>/TrnDocFiles/ ; the legacy image folders sit next to it.
    return Path(get_settings().attachments_path).expanduser().resolve().parent


def _safe_stem(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.\- ]", "_", name).strip() or "file"


# ---------------------------------------------------------------- options (Approve / Attach Seva)

# Option name -> condition, mirroring frmMstGeneral.initScreen (Approve only when AuthReq; Attach Seva only on Sannidhi).
SANNIDHI_DOC_ID = 1255


def get_options(conn: Connection, meta: MasterMeta) -> list[dict]:
    from app.services import mail

    opts: list[dict] = []
    if meta.auth_req:
        opts.append({"name": "Approve", "label": "Approve / Revoke"})
        if mail.approval_mail_enabled(conn):  # UtlGSettings Company/EmailAuthorised = 'Y'
            opts.append({"name": "Send Mail for Approval", "label": "Send Mail for Approval"})
    if meta.doc_id == SANNIDHI_DOC_ID:
        opts.append({"name": "Attach Seva", "label": "Attach Seva"})
    return opts


def set_approval(conn: Connection, meta: MasterMeta, row_id: int, *, approve: bool, user_code: str) -> dict:
    if not meta.auth_req:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This master does not need approval")
    if approve:
        conn.execute(
            text(f"UPDATE {meta.table} SET Authorised = 'Y', AuthBy = :u, AuthOn = :d WHERE {meta.id_col} = :id"),
            {"u": user_code, "d": datetime.now(), "id": row_id},
        )
    else:
        conn.execute(text(f"UPDATE {meta.table} SET Authorised = 'N', AuthBy = '', AuthOn = NULL WHERE {meta.id_col} = :id"), {"id": row_id})
    audit.record(conn, entity=meta.caption, entity_id=row_id, action="M", user_code=user_code, details="Approved" if approve else "Approval revoked")
    return {"authorised": approve}


# ---------------------------------------------------------------- Attach Seva (frmUtlAttachSeva)


def list_attach_seva(conn: Connection, san_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT s.SVAID AS seva_id, s.SVACODE AS code, s.SVANAME AS name, s.AMT AS amount, "
            "CASE WHEN m.SvaID IS NULL THEN 0 ELSE 1 END AS attached "
            "FROM MstSVA s LEFT JOIN MstSanSeva m ON m.SvaID = s.SVAID AND m.SanID = :san "
            "WHERE s.InActive = 'N' AND s.SVAID > 0 ORDER BY s.SVANAME"
        ),
        {"san": san_id},
    ).mappings().all()
    return [{**dict(r), "attached": bool(r["attached"])} for r in rows]


def save_attach_seva(conn: Connection, san_id: int, seva_ids: list[int]) -> None:
    """Same write-set as the legacy dialog: delete the Sannidhi's rows, then insert one per ticked Seva."""
    conn.execute(text("DELETE FROM MstSanSeva WHERE SanID = :san"), {"san": san_id})
    for sid in dict.fromkeys(int(s) for s in seva_ids):
        insert_row(conn, "MstSanSeva", {"SvaID": sid, "SanID": san_id})


# ---------------------------------------------------------------- delete check (svtModule.blnDeleteOK)


def check_delete_ok(conn: Connection, meta: MasterMeta, row_id: int) -> None:
    """Every `UtlDeletion` row for this table names another table/column that may still reference the record."""
    rows = conn.execute(
        text("SELECT TblName, FldName, DispFldName, TblCaption FROM UtlDeletion WHERE UPPER(DelTblName) = UPPER(:t)"), {"t": meta.table}
    ).mappings().all()
    for r in rows:
        tbl, fld = (r["TblName"] or "").strip(), (r["FldName"] or "").strip()
        if not (_IDENT.match(tbl) and _IDENT.match(fld)) or tbl.upper() == meta.table.upper():
            continue
        if conn.execute(text(f"SELECT TOP 1 1 FROM {tbl} WHERE {fld} = :v"), {"v": row_id}).first():
            caption = (r["TblCaption"] or "").strip() or tbl
            code = (r["DispFldName"] or "").strip() or fld
            raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot Delete!!! Data : {code} of {meta.table} exists in {caption}")


# ---------------------------------------------------------------- shared helpers


def voucher_present(conn: Connection) -> bool:
    return conn.execute(text("SELECT TOP 1 DocID FROM UtlTransactions WHERE DocType = 'Voucher'")).first() is not None


def ledger_display_code_name(conn: Connection) -> bool:
    row = conn.execute(text("SELECT TOP 1 AcLedDispCodeName FROM UtlMisc")).first()
    return bool(row and (row[0] or "N").strip().upper() == "Y")


def ac_led_name(conn: Connection, code: str, name: str) -> str:
    """MstAcLed.AcLedName: the code, or `name(code)` when UtlMisc.AcLedDispCodeName='Y' (frmMain / updateLed)."""
    return f"{name.strip()}({code.strip()})" if ledger_display_code_name(conn) else code.strip()


def sync_party_acled(conn: Connection, meta: MasterMeta, party_id: int, code: str, name: str) -> None:
    """Port of frmMstParty.updateLedger: keep the MstAcLed posting mirror of a Supplier/Customer in step (LedType = S / C)."""
    if not voucher_present(conn):
        return
    led_group = conn.execute(text(f"SELECT LedGroupID FROM {meta.table} WHERE {meta.id_col} = :id"), {"id": party_id}).scalar() or 0
    led_type = meta.id_col.upper().replace("ID", "")[:1]
    ac_name = ac_led_name(conn, code, name)
    ac_id = conn.execute(text("SELECT AcLedID FROM MstAcLed WHERE MstDocID = :d AND LedMstID = :l"), {"d": meta.doc_id, "l": party_id}).scalar()
    if ac_id is None:
        insert_row(
            conn,
            "MstAcLed",
            {"AcLedID": next_master_id(conn, "MstAcLed", "AcLedID"), "AcLedName": ac_name, "LedType": led_type, "LedMstID": party_id, "LedGroupId": led_group, "MstDocID": meta.doc_id},
        )
    else:
        update_row(conn, "MstAcLed", "AcLedID", ac_id, {"AcLedName": ac_name, "LedGroupId": led_group})


def delete_party_children(conn: Connection, meta: MasterMeta, party_id: int) -> None:
    """Rows frmMstParty.deleteDocument removes along with the party itself (after the accounting-transaction check)."""
    ac_id = conn.execute(text("SELECT AcLedID FROM MstAcLed WHERE MstDocID = :d AND LedMstID = :l"), {"d": meta.doc_id, "l": party_id}).scalar()
    if ac_id and conn.execute(text("SELECT TOP 1 AccID FROM TrnDtlAcc WHERE AcLedID = :id"), {"id": ac_id}).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Accounting Transaction is available.. Cannot Delete..")
    for sql in (
        "DELETE FROM MstPartyAddress WHERE MstDocID = :d AND PartyID = :p",
        "DELETE FROM MstPartyContacts WHERE MstDocID = :d AND PartyID = :p",
        "DELETE FROM MstPartyActivity WHERE PartyDocID = :d AND PartyID = :p",
        "DELETE FROM MstPartyAlertMessage WHERE PartyDocID = :d AND PartyID = :p",
        "DELETE FROM MstPContacts WHERE PartyID = :p",
        "DELETE FROM MstAcLed WHERE MstDocID = :d AND LedMstID = :p",
    ):
        conn.execute(text(sql), {"d": meta.doc_id, "p": party_id})


# ---------------------------------------------------------------- party sub-screens


def party_counts(conn: Connection, doc_id: int, party_id: int) -> dict:
    def n(sql: str) -> int:
        return int(conn.execute(text(sql), {"d": doc_id, "p": party_id}).scalar() or 0)

    return {
        "addresses": n("SELECT COUNT(*) FROM MstPartyAddress WHERE MstDocID = :d AND PartyID = :p"),
        "contacts": n("SELECT COUNT(*) FROM MstPartyContacts WHERE MstDocID = :d AND PartyID = :p"),
        "alerts": n("SELECT COUNT(*) FROM MstPartyAlertMessage WHERE PartyDocID = :d AND PartyID = :p"),
        "activities": n("SELECT COUNT(*) FROM MstPartyActivity WHERE PartyDocID = :d AND PartyID = :p"),
    }


def _scc_exists(conn: Connection, col: str, value: str) -> bool:
    return conn.execute(text(f"SELECT TOP 1 1 FROM MstSCC WHERE {col} = :v"), {"v": value}).first() is not None


def _clean(v: object) -> str:
    return ("" if v is None else str(v)).strip()


# --- Multi Address (frmMstPartyAddress)

_ADDR_COLS = ["PartyAddID", "AddCat", "Add1", "Add2", "Add3", "Add4", "SHPGSTNO", "City", "State", "PinCode", "Country", "DefShipAdd"]


def list_addresses(conn: Connection, doc_id: int, party_id: int) -> list[dict]:
    rows = conn.execute(
        text(f"SELECT {', '.join(_ADDR_COLS)} FROM MstPartyAddress WHERE PartyID = :p AND MstDocID = :d ORDER BY AddCat"), {"p": party_id, "d": doc_id}
    ).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["address"] = "\n".join(x for x in (d["Add1"], d["Add2"], d["Add3"], d["Add4"], d["SHPGSTNO"], d["City"], d["PinCode"], d["State"], d["Country"]) if _clean(x))
        out.append(d)
    return out


def _validate_address(conn: Connection, doc_id: int, party_id: int, v: dict, addr_id: int | None) -> dict:
    v = {k: _clean(v.get(k)) for k in ("AddCat", "Add1", "Add2", "Add3", "Add4", "SHPGSTNO", "City", "State", "PinCode", "Country")} | {"DefShipAdd": "Y" if v.get("DefShipAdd") in (True, "Y") else "N"}
    if v["Country"].upper() == "INDIA":
        if not _scc_exists(conn, "City", v["City"]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "City Not found in Master!")
        if not _scc_exists(conn, "Country", v["Country"]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Country Not found in Master!")
        if not _scc_exists(conn, "State", v["State"]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "State Not found in Master!")
    else:
        v["State"] = "-"
    if not v["AddCat"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter Address Category...")
    if not v["Add1"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter Address...")
    if not v["City"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter City...")
    if addr_id is None and conn.execute(
        text("SELECT 1 FROM MstPartyAddress WHERE AddCat = :c AND MstDocID = :d AND PartyID = :p"), {"c": v["AddCat"], "d": doc_id, "p": party_id}
    ).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Category already exists..")
    return v


def save_address(conn: Connection, doc_id: int, party_id: int, values: dict, addr_id: int | None = None) -> int:
    v = _validate_address(conn, doc_id, party_id, values, addr_id)
    if v["DefShipAdd"] == "Y":
        conn.execute(text("UPDATE MstPartyAddress SET DefShipAdd = 'N' WHERE MstDocID = :d AND PartyID = :p"), {"d": doc_id, "p": party_id})
    if addr_id is None:
        addr_id = next_master_id(conn, "MstPartyAddress", "PartyAddID")
        insert_row(conn, "MstPartyAddress", {**v, "PartyAddID": addr_id, "MstDocID": doc_id, "PartyID": party_id})
    else:
        if not conn.execute(text("SELECT 1 FROM MstPartyAddress WHERE PartyAddID = :a AND MstDocID = :d AND PartyID = :p"), {"a": addr_id, "d": doc_id, "p": party_id}).first():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Address not found")
        update_row(conn, "MstPartyAddress", "PartyAddID", addr_id, v)
    return addr_id


def delete_address(conn: Connection, doc_id: int, party_id: int, addr_id: int) -> None:
    conn.execute(text("DELETE FROM MstPartyAddress WHERE PartyAddID = :a AND MstDocID = :d AND PartyID = :p"), {"a": addr_id, "d": doc_id, "p": party_id})


# --- Contact Person (frmMstPartyContactPerson)

_CONTACT_COLS = ["PartyCID", "CName", "CDepartment", "CDesig", "CMobNo", "CPhone", "Fax", "Email", "CRemarks", "SetDefault", "ImgFileName"]


def list_contacts(conn: Connection, doc_id: int, party_id: int) -> list[dict]:
    rows = conn.execute(
        text(f"SELECT {', '.join(_CONTACT_COLS)} FROM MstPartyContacts WHERE MstDocID = :d AND PartyID = :p ORDER BY CName"), {"d": doc_id, "p": party_id}
    ).mappings().all()
    return [dict(r) for r in rows]


def save_contact(conn: Connection, doc_id: int, party_id: int, values: dict, cid: int | None = None) -> int:
    v = {k: _clean(values.get(k)) for k in ("CName", "CDepartment", "CDesig", "CMobNo", "CPhone", "Fax", "Email", "CRemarks")}
    v["SetDefault"] = "Y" if values.get("SetDefault") in (True, "Y") else "N"
    if not v["CName"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Contact Person Name is Empty...")
    dup = conn.execute(
        text("SELECT 1 FROM MstPartyContacts WHERE PartyID = :p AND MstDocID = :d AND CName = :n AND (:c IS NULL OR PartyCID <> :c)"),
        {"p": party_id, "d": doc_id, "n": v["CName"], "c": cid},
    ).first()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT, "Contact person Name already exists..")
    if v["SetDefault"] == "Y":
        conn.execute(text("UPDATE MstPartyContacts SET SetDefault = 'N' WHERE MstDocID = :d AND PartyID = :p"), {"d": doc_id, "p": party_id})
    if cid is None:
        cid = next_master_id(conn, "MstPartyContacts", "PartyCID")
        insert_row(conn, "MstPartyContacts", {**v, "PartyCID": cid, "PartyID": party_id, "MstDocID": doc_id, "ImgFileName": "-"})
    else:
        if not conn.execute(text("SELECT 1 FROM MstPartyContacts WHERE PartyCID = :c AND MstDocID = :d AND PartyID = :p"), {"c": cid, "d": doc_id, "p": party_id}).first():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
        update_row(conn, "MstPartyContacts", "PartyCID", cid, v)
    return cid


def _contact_image_path(cid: int) -> Path:
    d = _rpts_dir() / "custfiles" / "contactfiles"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{int(cid)}.jpg"


def set_contact_image(conn: Connection, doc_id: int, party_id: int, cid: int, *, filename: str, content: bytes) -> None:
    if not conn.execute(text("SELECT 1 FROM MstPartyContacts WHERE PartyCID = :c AND MstDocID = :d AND PartyID = :p"), {"c": cid, "d": doc_id, "p": party_id}).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    _contact_image_path(cid).write_bytes(content)
    update_row(conn, "MstPartyContacts", "PartyCID", cid, {"ImgFileName": f"{party_id}_{_safe_stem(filename)}"})


def get_contact_image(cid: int) -> Path | None:
    p = _contact_image_path(cid)
    return p if p.exists() else None


def delete_contact(conn: Connection, doc_id: int, party_id: int, cid: int) -> None:
    conn.execute(text("DELETE FROM MstPartyContacts WHERE PartyCID = :c AND MstDocID = :d AND PartyID = :p"), {"c": cid, "d": doc_id, "p": party_id})
    p = _contact_image_path(cid)
    if p.exists():
        p.unlink()


# --- Alert Message (frmMstPartyAlert): one message per transaction document linked to this party master


def list_alerts(conn: Connection, doc_id: int, party_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT u.DocID AS doc_id, u.DocName AS doc_name, ISNULL(m.Message, '') AS message "
            "FROM UtlTransactions u LEFT JOIN MstPartyAlertMessage m ON u.DocID = m.MstDocID AND m.PartyID = :p "
            "WHERE u.MstDocIDParty = :d ORDER BY u.DocName"
        ),
        {"p": party_id, "d": doc_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def save_alerts(conn: Connection, doc_id: int, party_id: int, messages: list[dict]) -> None:
    allowed = {a["doc_id"] for a in list_alerts(conn, doc_id, party_id)}
    conn.execute(text("DELETE FROM MstPartyAlertMessage WHERE PartyId = :p AND PartyDocId = :d"), {"p": party_id, "d": doc_id})
    for m in messages:
        msg = _clean(m.get("message"))
        if msg and int(m.get("doc_id", 0)) in allowed:
            insert_row(conn, "MstPartyAlertMessage", {"MstDocID": int(m["doc_id"]), "Message": msg, "PartyID": party_id, "PartyDocID": doc_id})


# --- Activities (frmMstPartyActivities)


def list_activities(conn: Connection, doc_id: int, party_id: int) -> list[dict]:
    rows = conn.execute(
        text(
            "SELECT a.ActID AS act_id, a.ActDate AS act_date, a.Notes AS notes, ISNULL(u.UserCode, '') AS user_code "
            "FROM MstPartyActivity a LEFT JOIN MstUser u ON u.UserID = a.UserId "
            "WHERE a.PartyDocID = :d AND a.PartyID = :p ORDER BY a.ActDate DESC"
        ),
        {"d": doc_id, "p": party_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def add_activity(conn: Connection, doc_id: int, party_id: int, notes: str, user_id: int) -> None:
    notes = _clean(notes)
    if not notes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Note should not be blank")
    insert_row(conn, "MstPartyActivity", {"PartyID": party_id, "PartyDocID": doc_id, "UserID": user_id, "Notes": notes, "ActDate": datetime.now()})


def delete_activity(conn: Connection, doc_id: int, party_id: int, act_id: int) -> None:
    conn.execute(text("DELETE FROM MstPartyActivity WHERE ActID = :a AND PartyDocID = :d AND PartyID = :p"), {"a": act_id, "d": doc_id, "p": party_id})


# ---------------------------------------------------------------- Item picture (frmMstItem.btnAddImg)


def _item_image_path(code: str) -> Path:
    d = _rpts_dir() / "ItemImage"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{_safe_stem(code)}.jpg"


def get_item_image(code: str) -> Path | None:
    p = _item_image_path(code)
    return p if p.exists() else None


def set_item_image(code: str, content: bytes) -> None:
    _item_image_path(code).write_bytes(content)


# ---------------------------------------------------------------- per-master validation (frmMstSCC / frmMstParty)


def validate_master(conn: Connection, meta: MasterMeta, merged: dict, row_id: int | None) -> bool:
    """
    Extra rules the legacy forms apply beyond blank code/name. Returns True when the rule set already covered the
    "code already exists" check (State City Country is unique on City + State + Country, not City alone).
    """
    if meta.doc_id == 1106:  # State City Country
        for k in ("City", "State", "Country"):
            if k in merged and merged[k] is not None:
                merged[k] = str(merged[k]).replace("'", "`").strip()
        if not merged.get("City"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "City should not be blank!!")
        if not merged.get("State"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "State should not be blank!!")
        if not conn.execute(text("SELECT 1 FROM MstSTATE WHERE STATENAME = :s"), {"s": merged["State"]}).first():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "State Not found in Master!")
        dup = conn.execute(
            text("SELECT 1 FROM MstSCC WHERE City = :c AND State = :s AND Country = :k AND SCCID <> :id"),
            {"c": merged["City"], "s": merged["State"], "k": merged.get("Country") or "", "id": row_id or -1},
        ).first()
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT, f"{meta.caption} already exists..")
        return True
    if meta.doc_id == 1121:  # Supplier (frmMstParty.ValidFields)
        if not _clean(merged.get("BAdd1")):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter atleast first line address!")
        for col, label in (("City", "City"), ("Country", "Country"), ("State", "State")):
            if not _clean(merged.get(col)):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Please Enter The {label}!")
        for col, label in (("City", "City"), ("Country", "Country"), ("State", "State")):
            if not _scc_exists(conn, col, _clean(merged[col])):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{label} Not found in Master!")
    return False


# ---------------------------------------------------------------- Send Mail for Approval (frmMstParty / frmMstItem)


def send_approval_mail(conn: Connection, meta: MasterMeta, row_id: int, *, sender_id: int, sender_code: str) -> list[str]:
    """Mail every user holding the authorise right (rights position 6) on this master's menu item, like the legacy form."""
    from app.meta.menu import resolve_menu_item_id
    from app.services import mail

    row = masters_get_row(conn, meta, row_id)
    menu_id = resolve_menu_item_id(conn, meta.doc_id)
    approvers = conn.execute(
        text(
            "SELECT UserID, UserCode, EmailID FROM MstUser WHERE UserID IN "
            "(SELECT UserID FROM MstUserRights WHERE SUBSTRING(UserRights, 6, 1) = '1' AND MenuItemID = :m)"
        ),
        {"m": menu_id},
    ).mappings().all()
    if not approvers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Their is no Authorised Person For this Document...")
    code, name = row[meta.code_col], row[meta.name_col]
    sent: list[str] = []
    for a in approvers:
        to = (a["EmailID"] or "").strip()
        if not to:
            continue
        link = mail.approval_link(conn, meta.doc_id, row_id, int(a["UserID"]), sender_id)
        lines = [" Dear Sir/Madam,", " PFA, document for your approval. ", f" Document Name. {meta.caption}", f" Code. {code}", f" Name. {name}"]
        if link:
            lines += [" Please click on the below link to approve the document", link]
        else:
            lines.append(" Please open e-Mandira and approve it from Options > Approve.")
        body = chr(10).join(lines)
        mail.send_mail(conn, [to], f"Approval of <<{meta.caption}>> Code: {code}  and Name: {name}", body)
        sent.append(f"Authorised Person: {a['UserCode']} and EmailID: {to}")
    if not sent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "None of the authorised persons has an e-mail ID")
    return sent


def masters_get_row(conn: Connection, meta: MasterMeta, row_id: int) -> dict:
    from app.services import masters

    return masters.get_row(conn, meta, row_id)
