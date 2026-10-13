"""Generic master CRUD endpoints — one route family for every simple master."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, require_right_from_path
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
from app.services import attachments as attachments_service
from app.services import excel_import as excel_import_service
from app.services import masters as masters_service

router = APIRouter(prefix="/masters", tags=["masters"])


@router.get("/{doc_id}")
def list_master(
    doc_id: int,
    search: str = "",
    top: int = Query(200, le=1000),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW)),
):
    meta = masters_service.get_meta(conn, doc_id)
    return {"meta": meta.__dict__, "rows": masters_service.list_rows(conn, meta, search=search, top=top)}


@router.get("/{doc_id}/layout")
def get_master_layout(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    """Built-in fields beyond Code/Name for masters like Item, Supplier and State City Country (served, not hard-coded in the UI)."""
    from app.meta import master_layouts

    from app.services import master_extras

    meta = masters_service.get_meta(conn, doc_id)
    layout = master_layouts.get_layout(conn, doc_id, meta.table)
    if layout["panels"]:  # party masters: DsgrModule.TITLECASE(prefix) + " Code" / " Name" (e.g. "Supp Code")
        layout["code_caption"] = layout["code_caption"] or f"{meta.short_form.title()} Code"
        layout["name_caption"] = layout["name_caption"] or f"{meta.short_form.title()} Name"
    layout["options"] = master_extras.get_options(conn, meta)  # Options menu entries (Approve when AuthReq, Attach Seva on Sannidhi)
    return layout


@router.get("/{doc_id}/core-lookup/{field_code}")
def master_core_lookup(
    doc_id: int, field_code: str, search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))
):
    from app.meta import master_layouts

    return master_layouts.lookup_options(conn, doc_id, field_code, search)


# Fixed-path GETs must come BEFORE /{doc_id}/{row_id}, which would otherwise swallow them (422).
@router.get("/{doc_id}/import-template")
def download_import_template(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_ADD))):
    content = excel_import_service.build_template(conn, doc_id)
    meta = masters_service.get_meta(conn, doc_id)
    return Response(
        content=content,
        media_type="application/vnd.ms-excel",
        headers={"Content-Disposition": f'attachment; filename="{meta.short_form}_import_template.xls"'},
    )


@router.get("/{doc_id}/import-fields")
def import_fields(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_ADD))):
    return excel_import_service.field_info(conn, doc_id)


@router.get("/{doc_id}/{row_id}")
def get_master_row(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    meta = masters_service.get_meta(conn, doc_id)
    return masters_service.get_row(conn, meta, row_id)


@router.post("/{doc_id}", status_code=201)
def create_master_row(doc_id: int, values: dict[str, Any], user: CurrentUser = Depends(require_right_from_path(RIGHT_ADD))):
    with with_transaction() as conn:
        meta = masters_service.get_meta(conn, doc_id)
        return masters_service.create(conn, meta, values=values, user_code=user.user_code)


@router.put("/{doc_id}/{row_id}")
def update_master_row(doc_id: int, row_id: int, values: dict[str, Any], user: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        meta = masters_service.get_meta(conn, doc_id)
        return masters_service.update(conn, meta, row_id, values=values, user_code=user.user_code)


@router.delete("/{doc_id}/{row_id}")
def delete_master_row(doc_id: int, row_id: int, user: CurrentUser = Depends(require_right_from_path(RIGHT_DELETE))):
    with with_transaction() as conn:
        meta = masters_service.get_meta(conn, doc_id)
        masters_service.delete(conn, meta, row_id, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Import from Excel — port of frmUtlImportXL, masters only (see app/services/excel_import.py) ----


@router.post("/{doc_id}/import-preview")
def import_preview(doc_id: int, file: UploadFile = File(...), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_ADD))):
    return excel_import_service.preview(conn, doc_id, file.file.read())


@router.post("/{doc_id}/import")
def import_from_excel(doc_id: int, file: UploadFile = File(...), user: CurrentUser = Depends(require_right_from_path(RIGHT_ADD))):
    content = file.file.read()
    return excel_import_service.import_rows(doc_id, content, user.user_code)


# ---- File attachments (UtlAttachFiles) — masters with FileAttachReq='Y' ----


@router.get("/{doc_id}/{row_id}/attachments")
def list_attachments(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    return attachments_service.list_attachments(conn, doc_id=doc_id, doc_value_id=str(row_id))


@router.post("/{doc_id}/{row_id}/attachments", status_code=201)
async def upload_attachment(
    doc_id: int,
    row_id: int,
    file: UploadFile = File(...),
    description: str = Form(""),
    user: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT)),
):
    content = await file.read()
    with with_transaction() as conn:
        stored_name = attachments_service.save_attachment(
            conn, doc_id=doc_id, doc_value_id=str(row_id), original_name=file.filename, content=content, description=description, user_code=user.user_code
        )
    return {"file_name": stored_name}


@router.get("/{doc_id}/{row_id}/attachments/{file_name}")
def download_attachment(
    doc_id: int, row_id: int, file_name: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))
):
    path = attachments_service.get_attachment_path(conn, doc_id=doc_id, doc_value_id=str(row_id), file_name=file_name)
    return FileResponse(path, filename=file_name)


@router.delete("/{doc_id}/{row_id}/attachments/{file_name}")
def delete_attachment(
    doc_id: int, row_id: int, file_name: str, _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))
):
    with with_transaction() as conn:
        attachments_service.delete_attachment(conn, doc_id=doc_id, doc_value_id=str(row_id), file_name=file_name)
    return {"message": "Deleted"}
