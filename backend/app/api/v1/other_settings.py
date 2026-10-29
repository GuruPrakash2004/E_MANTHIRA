"""Global Settings -> Other Settings... screens (ADMIN only). See app/services/other_settings.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import other_settings as svc

router = APIRouter(prefix="/settings/other", tags=["settings"])


def admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change these settings")
    return user


# -- shared pickers (tables / columns the legacy combos list)
@router.get("/tables")
def tables(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.tables(conn)


@router.get("/tables/{table}/columns")
def columns(table: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.columns(conn, table)


# -- Field Captions
class Caption(BaseModel):
    code: str = ""
    caption: str = ""


@router.get("/field-captions")
def get_captions(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.list_captions(conn)


@router.put("/field-captions")
def put_captions(items: list[Caption], _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_captions(conn, [i.model_dump() for i in items])
    return {"message": "Data saved successfully."}


@router.post("/field-captions", status_code=201)
def post_caption(body: Caption, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.add_caption(conn, body.code, body.caption)
    return {"message": "Data Saved Successfully!"}


@router.delete("/field-captions/{code}")
def del_caption(code: str, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.delete_caption(conn, code)
    return {"message": "Field Caption Removed Successfully"}


# -- Delete Linkage Updation
class Ref(BaseModel):
    table: str = ""
    column: str = ""
    display: str = ""
    doc: str = ""


class Linkage(BaseModel):
    table: str = ""
    doc_name: str = ""
    field: str = ""
    refs: list[Ref] = []


@router.get("/delete-linkage")
def get_linkages(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.list_linkages(conn)


@router.get("/delete-linkage/candidates")
def get_candidates(table: str, column: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.candidate_refs(conn, table, column)


@router.put("/delete-linkage")
def put_linkage(body: Linkage, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_linkage(conn, body.table, body.doc_name, body.field, [r.model_dump() for r in body.refs])
    return {"message": "Saved Successfully!"}


@router.delete("/delete-linkage/{table}")
def del_linkage(table: str, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.delete_linkage(conn, table)
    return {"message": "Deleted Successfully!"}


# -- View Search Display Fields
class FindField(BaseModel):
    table: str = ""
    storage: str = ""
    display: str = ""
    alias1: str = ""
    alias2: str = ""
    alias3: str = ""
    alias4: str = ""
    alias5: str = ""


@router.get("/search-fields")
def get_find_fields(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.list_find_fields(conn)


@router.post("/search-fields", status_code=201)
def post_find_field(body: FindField, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        msg = svc.save_find_field(conn, body.model_dump())
    return {"message": msg}


@router.put("/search-fields/{find_id}")
def put_find_field(find_id: int, body: FindField, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        msg = svc.save_find_field(conn, body.model_dump(), find_id)
    return {"message": msg}


@router.delete("/search-fields/{find_id}")
def del_find_field(find_id: int, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.delete_find_field(conn, find_id)
    return {"message": "Deleted Successfully!"}


# -- Login Settings
class LoginSettings(BaseModel):
    login_required: bool = True
    role_based: bool = False
    ad_auth: bool = False
    ad_auto_login: bool = False
    ad_domain: str = ""
    pwd_policy: bool = False
    never_expires: bool = True
    expiry_days: int = 0
    pwd_rules: bool = False
    min_special: int = 0
    min_numeric: int = 0
    min_alpha: int = 0
    min_length: int = 0
    min_lower: int = 0
    min_upper: int = 0


@router.get("/login")
def get_login(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_login(conn)


@router.put("/login")
def put_login(body: LoginSettings, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_login(conn, body.model_dump())
    return {"message": "Updated  successfully."}


# -- Doc Prefix Settings (document number format + prefix rules)
class DocNoRow(BaseModel):
    doc_id: int
    cont_group: str = ""
    pfx_reset: bool = False
    docno_change: bool = False
    f: list[str] = []


class PrefixRow(BaseModel):
    prefix: str = ""
    operator: str = ""
    field: str = ""
    value: str = ""


@router.get("/doc-numbers")
def get_doc_numbers(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_docno(conn)


@router.put("/doc-numbers")
def put_doc_numbers(rows: list[DocNoRow], _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_docno(conn, [r.model_dump() for r in rows])
    return {"message": "Saved successfully!"}


@router.get("/doc-numbers/{doc_id}/prefixes")
def get_doc_prefixes(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_prefixes(conn, doc_id)


@router.put("/doc-numbers/{doc_id}/prefixes")
def put_doc_prefixes(doc_id: int, rows: list[PrefixRow], _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        msg = svc.save_prefixes(conn, doc_id, [r.model_dump() for r in rows])
    return {"message": msg}


# -- Transaction / Voucher Settings (+ Misc. Settings)
@router.get("/transaction-settings/documents")
def trn_documents(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.trn_documents(conn)


@router.get("/transaction-settings/{doc_id}")
def get_trn_settings(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_trn_settings(conn, doc_id)


@router.put("/transaction-settings/{doc_id}")
def put_trn_settings(doc_id: int, values: dict, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_trn_settings(conn, doc_id, values)
    return {"message": "Updated successfully."}


class MiscSettings(BaseModel):
    item_caption: str = ""
    item_name_caption: str = ""
    item_desc_caption: str = ""
    search_top_n: int = 0
    show_menu_icons: bool = False


@router.get("/misc")
def get_misc(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_misc(conn)


@router.put("/misc")
def put_misc(body: MiscSettings, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_misc(conn, body.model_dump())
    return {"message": "Updated successfully."}


# -- Master Settings (same switches for the master documents)
@router.get("/master-settings/documents")
def master_documents(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.trn_documents(conn, "master")


@router.get("/master-settings/{doc_id}")
def get_master_settings(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_trn_settings(conn, doc_id, "master")


@router.put("/master-settings/{doc_id}")
def put_master_settings(doc_id: int, values: dict, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_trn_settings(conn, doc_id, values, "master")
    return {"message": "Updated successfully."}


# -- Filter Settings
class FilterItem(BaseModel):
    code: str
    caption: str = ""
    selected: bool = False


@router.get("/filter-settings/documents")
def filter_documents(kind: str = "master", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.filter_documents(conn, kind)


@router.get("/filter-settings/{doc_id}")
def get_filter(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_filter(conn, doc_id)


@router.put("/filter-settings/{doc_id}")
def put_filter(doc_id: int, items: list[FilterItem], _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_filter(conn, doc_id, [i.model_dump() for i in items])
    return {"message": "Settings Saved Successfully."}


@router.delete("/filter-settings/{doc_id}")
def del_filter(doc_id: int, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.delete_filter(conn, doc_id)
    return {"message": "This record is deleted!"}


# -- Form Userwise Settings: the signed-in user's own preferences (any user, not only ADMIN)
class FormSettingRow(BaseModel):
    doc_id: int
    header: bool = False
    detail: bool = False
    footer: bool = False
    total: bool = False
    newmode: bool = False
    loadlasttrnno: bool = False
    fullscreen: bool = False
    after_save: str = "-"


@router.get("/form-settings")
def get_form_settings(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    return svc.get_form_settings(conn, user.user_id)


@router.put("/form-settings")
def put_form_settings(rows: list[FormSettingRow], user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        svc.save_form_settings(conn, user.user_id, [r.model_dump() for r in rows])
    return {"message": "User wise Form settings saved!!"}


# -- Stock Settings
class StockRow(BaseModel):
    doc_id: int
    affects: str = ""
    affects_fld: str = ""
    action: str = ""
    qty_fld: str = ""
    valuation: str = ""
    rate_fld: str = ""
    loc_fld: str = ""
    loc2_fld: str = ""
    rej_loc: str = ""
    rej_fld: str = ""


@router.get("/stock-settings")
def get_stock_settings(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.list_stock_settings(conn)


@router.put("/stock-settings")
def put_stock_settings(rows: list[StockRow], _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.save_stock_settings(conn, [r.model_dump() for r in rows])
    return {"message": "Data saved successfully."}


# -- Post Doc List
class PdeColumn(BaseModel):
    table: str = ""
    field: str = ""
    caption: str = ""
    date_filter: bool = False
    hide: bool = False
    allow_edit: bool = False


class PdeKey(BaseModel):
    table: str = ""
    field: str = ""


class PostDoc(BaseModel):
    name: str = ""
    remarks: str = ""
    condition: str = ""
    pending_condition: str = ""
    columns: list[PdeColumn] = []
    primary: list[PdeKey] = []


@router.get("/post-docs")
def get_post_docs(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.list_post_docs(conn)


@router.get("/post-docs/{pid}")
def get_post_doc(pid: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(admin)):
    return svc.get_post_doc(conn, pid)


@router.post("/post-docs", status_code=201)
def post_post_doc(body: PostDoc, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        pid, msg = svc.save_post_doc(conn, None, body.model_dump())
    return {"id": pid, "message": msg}


@router.put("/post-docs/{pid}")
def put_post_doc(pid: int, body: PostDoc, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        pid, msg = svc.save_post_doc(conn, pid, body.model_dump())
    return {"id": pid, "message": msg}


@router.delete("/post-docs/{pid}")
def del_post_doc(pid: int, _: CurrentUser = Depends(admin)):
    with with_transaction() as conn:
        svc.delete_post_doc(conn, pid)
    return {"message": "Deleted Successfully...."}
