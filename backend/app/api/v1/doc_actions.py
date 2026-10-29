"""Per-document Options endpoints (Send EMAIL / Send SMS and the option list) — see app/services/doc_messages.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user, require_right_from_path
from app.meta.menu import RIGHT_EDIT, RIGHT_VIEW

from app.services import doc_extras, doc_xl
from app.utils import xls as xls_util
from app.services import doc_messages as svc
from app.services import label_print

router = APIRouter(prefix="/doc-actions", tags=["doc-actions"])


@router.get("/{doc_id}/options")
def options(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.get_options(conn, doc_id)


@router.get("/sms-providers")
def providers(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.sms_providers(conn)


@router.get("/{doc_id}/email-templates")
def email_templates(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.email_templates(conn, doc_id)


class PrepareBody(BaseModel):
    template: str


@router.post("/{doc_id}/{record_id}/email/prepare")
def email_prepare(doc_id: int, record_id: int, body: PrepareBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.email_prepare(conn, doc_id, record_id, body.template)


class EmailBody(BaseModel):
    to: str
    cc: str = ""
    subject: str = ""
    body: str


@router.post("/{doc_id}/{record_id}/email/send")
def email_send(doc_id: int, record_id: int, body: EmailBody, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        n = svc.email_send(conn, to=body.to, cc=body.cc, subject=body.subject, body=body.body)
    return {"message": "Email Sent....", "recipients": n}


@router.get("/{doc_id}/sms-templates")
def sms_templates(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.sms_templates(conn, doc_id)


@router.post("/{doc_id}/{record_id}/sms/prepare")
def sms_prepare(doc_id: int, record_id: int, body: PrepareBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return svc.sms_prepare(conn, doc_id, record_id, body.template)


class SmsBody(BaseModel):
    mobile: str
    text: str
    provider: str = ""


@router.post("/{doc_id}/{record_id}/sms/send")
def sms_send(doc_id: int, record_id: int, body: SmsBody, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        n = svc.sms_send(conn, mobile=body.mobile, message=body.text, provider=body.provider)
    return {"message": "Message Sent.", "sent": n}


# ---- Amendment (dormant unless the document's switch is on and its header table has the columns) -------------------------
@router.get("/{doc_id}/{record_id}/amendment")
def amendment_get(doc_id: int, record_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    return doc_extras.get_amendment(conn, doc_id, record_id)


class AmendmentBody(BaseModel):
    amendment: bool
    amm_date: date | None = None


@router.put("/{doc_id}/{record_id}/amendment")
def amendment_set(doc_id: int, record_id: int, body: AmendmentBody, user: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        out = doc_extras.set_amendment(conn, doc_id, record_id, amendment=body.amendment, amm_date=body.amm_date, user_code=user.user_code)
    return {"message": "Amendment saved", **out}


# ---- Doc XL Export / XL Template / XL Import (documents with UtlTransactions.AllowImpExp = 'Y') --------------------------
def _xls_response(data: bytes, name: str) -> Response:
    return Response(content=data, media_type=xls_util.MIME, headers={"Content-Disposition": f'attachment; filename="{name}.xls"'})


@router.get("/{doc_id}/xl-template")
def xl_template(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    return _xls_response(doc_xl.template(conn, doc_id), f"{doc_xl.doc_name(conn, doc_id)} template")


class XlExportBody(BaseModel):
    rows: list[dict] = []


@router.post("/{doc_id}/xl-export")
def xl_export(doc_id: int, body: XlExportBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    return _xls_response(doc_xl.export_rows(conn, doc_id, body.rows), doc_xl.doc_name(conn, doc_id))


@router.post("/{doc_id}/xl-import")
async def xl_import(doc_id: int, file: UploadFile = File(...), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    return {"rows": doc_xl.import_rows(conn, doc_id, await file.read())}


# -- Label Printing (templates of text with {COLUMN} placeholders, one label per record)
class LabelTemplate(BaseModel):
    name: str = ""
    lines: list[str] = []


class LabelRun(BaseModel):
    template_id: int
    record_ids: list[int] | None = None
    top: int = 500


@router.get("/label-documents")
def label_documents(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return label_print.documents(conn)


@router.get("/{doc_id}/label-columns")
def label_columns(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return label_print.columns(conn, doc_id)


@router.get("/{doc_id}/label-templates")
def label_templates(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return label_print.templates(conn, doc_id)


@router.post("/{doc_id}/label-templates", status_code=201)
def label_template_add(doc_id: int, body: LabelTemplate, _: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        tid = label_print.save_template(conn, doc_id, None, body.name, body.lines)
    return {"id": tid, "message": "Saved Successfully!"}


@router.put("/{doc_id}/label-templates/{template_id}")
def label_template_update(doc_id: int, template_id: int, body: LabelTemplate, _: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        label_print.save_template(conn, doc_id, template_id, body.name, body.lines)
    return {"id": template_id, "message": "Updated successfully."}


@router.delete("/{doc_id}/label-templates/{template_id}")
def label_template_delete(doc_id: int, template_id: int, _: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        label_print.delete_template(conn, doc_id, template_id)
    return {"message": "Deleted Successfully!"}


@router.post("/{doc_id}/labels")
def label_run(doc_id: int, body: LabelRun, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return {"labels": label_print.labels(conn, doc_id, body.template_id, body.record_ids, body.top)}
