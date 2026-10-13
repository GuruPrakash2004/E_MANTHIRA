"""
Endpoints behind the generic master screen's Options menu and the Supplier sub-screens — see
app/services/master_extras.py for the legacy forms they port.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, require_right_from_path
from app.meta import master_layouts
from app.meta.menu import RIGHT_AUTH, RIGHT_EDIT, RIGHT_OPT1, RIGHT_VIEW
from app.services import master_extras as svc
from app.services import masters as masters_service

router = APIRouter(prefix="/masters", tags=["masters"])


def _party_meta(conn: Connection, doc_id: int, row_id: int):
    """Sub-screens exist only for masters whose layout declares panels (Supplier); the party row must exist."""
    meta = masters_service.get_meta(conn, doc_id)
    spec = master_layouts.LAYOUTS.get(doc_id) or {}
    if not spec.get("panels"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This master has no sub-screens")
    masters_service.get_row(conn, meta, row_id)
    return meta


# ---- Approve / revoke (Options > Approve)


class ApproveBody(BaseModel):
    approve: bool = True


@router.post("/{doc_id}/{row_id}/approve")
def approve_row(doc_id: int, row_id: int, body: ApproveBody, user: CurrentUser = Depends(require_right_from_path(RIGHT_AUTH))):
    with with_transaction() as conn:
        meta = masters_service.get_meta(conn, doc_id)
        masters_service.get_row(conn, meta, row_id)
        return svc.set_approval(conn, meta, row_id, approve=body.approve, user_code=user.user_code)


@router.post("/{doc_id}/{row_id}/send-approval")
def send_approval(doc_id: int, row_id: int, user: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        meta = masters_service.get_meta(conn, doc_id)
        if not meta.auth_req:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "This master does not need approval")
        sent = svc.send_approval_mail(conn, meta, row_id, sender_id=user.user_id, sender_code=user.user_code)
    return {"message": "e-Mail Sent Successfully", "sent": sent}


# ---- Attach Seva (Options > Attach Seva, Sannidhi only)


@router.get("/{doc_id}/{row_id}/attach-seva")
def get_attach_seva(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    if doc_id != svc.SANNIDHI_DOC_ID:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not available for this master")
    return svc.list_attach_seva(conn, row_id)


class AttachSevaBody(BaseModel):
    seva_ids: list[int]


@router.put("/{doc_id}/{row_id}/attach-seva")
def put_attach_seva(doc_id: int, row_id: int, body: AttachSevaBody, user: CurrentUser = Depends(require_right_from_path(RIGHT_OPT1))):
    if doc_id != svc.SANNIDHI_DOC_ID:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not available for this master")
    with with_transaction() as conn:
        svc.save_attach_seva(conn, row_id, body.seva_ids)
    return {"message": "Sevas attached successfully!"}


# ---- Supplier sub-screens

@router.get("/{doc_id}/{row_id}/party/counts")
def party_counts(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    _party_meta(conn, doc_id, row_id)
    return svc.party_counts(conn, doc_id, row_id)


@router.get("/{doc_id}/{row_id}/party/addresses")
def list_addresses(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    _party_meta(conn, doc_id, row_id)
    return svc.list_addresses(conn, doc_id, row_id)


@router.post("/{doc_id}/{row_id}/party/addresses", status_code=201)
def add_address(doc_id: int, row_id: int, values: dict[str, Any], _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        return {"id": svc.save_address(conn, doc_id, row_id, values)}


@router.put("/{doc_id}/{row_id}/party/addresses/{addr_id}")
def edit_address(doc_id: int, row_id: int, addr_id: int, values: dict[str, Any], _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        return {"id": svc.save_address(conn, doc_id, row_id, values, addr_id)}


@router.delete("/{doc_id}/{row_id}/party/addresses/{addr_id}")
def remove_address(doc_id: int, row_id: int, addr_id: int, _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        svc.delete_address(conn, doc_id, row_id, addr_id)
    return {"message": "Deleted Successfully!"}


@router.get("/{doc_id}/{row_id}/party/contacts")
def list_contacts(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    _party_meta(conn, doc_id, row_id)
    return svc.list_contacts(conn, doc_id, row_id)


@router.post("/{doc_id}/{row_id}/party/contacts", status_code=201)
def add_contact(doc_id: int, row_id: int, values: dict[str, Any], _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        return {"id": svc.save_contact(conn, doc_id, row_id, values)}


@router.put("/{doc_id}/{row_id}/party/contacts/{cid}")
def edit_contact(doc_id: int, row_id: int, cid: int, values: dict[str, Any], _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        return {"id": svc.save_contact(conn, doc_id, row_id, values, cid)}


@router.delete("/{doc_id}/{row_id}/party/contacts/{cid}")
def remove_contact(doc_id: int, row_id: int, cid: int, _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        svc.delete_contact(conn, doc_id, row_id, cid)
    return {"message": "Deleted Successfully!"}


@router.get("/{doc_id}/{row_id}/party/contacts/{cid}/image")
def contact_image(doc_id: int, row_id: int, cid: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    _party_meta(conn, doc_id, row_id)
    path = svc.get_contact_image(cid)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No image")
    return FileResponse(path, media_type="image/jpeg")


@router.put("/{doc_id}/{row_id}/party/contacts/{cid}/image")
async def put_contact_image(
    doc_id: int, row_id: int, cid: int, file: UploadFile = File(...), _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))
):
    content = await file.read()
    if not content or len(content) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose an image up to 5 MB")
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        svc.set_contact_image(conn, doc_id, row_id, cid, filename=file.filename or "image.jpg", content=content)
    return {"message": "Image updated"}


@router.get("/{doc_id}/{row_id}/party/alerts")
def list_alerts(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    _party_meta(conn, doc_id, row_id)
    return svc.list_alerts(conn, doc_id, row_id)


class AlertsBody(BaseModel):
    messages: list[dict[str, Any]]


@router.put("/{doc_id}/{row_id}/party/alerts")
def save_alerts(doc_id: int, row_id: int, body: AlertsBody, _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        svc.save_alerts(conn, doc_id, row_id, body.messages)
    return {"message": "Message Saved Successfully"}


@router.get("/{doc_id}/{row_id}/party/activities")
def list_activities(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    _party_meta(conn, doc_id, row_id)
    return svc.list_activities(conn, doc_id, row_id)


class NoteBody(BaseModel):
    notes: str


@router.post("/{doc_id}/{row_id}/party/activities", status_code=201)
def add_activity(doc_id: int, row_id: int, body: NoteBody, user: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        svc.add_activity(conn, doc_id, row_id, body.notes, user.user_id)
    return {"message": "Note Saved Successfully"}


@router.delete("/{doc_id}/{row_id}/party/activities/{act_id}")
def remove_activity(doc_id: int, row_id: int, act_id: int, _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    with with_transaction() as conn:
        _party_meta(conn, doc_id, row_id)
        svc.delete_activity(conn, doc_id, row_id, act_id)
    return {"message": "Deleted Successfully!"}


# ---- Item picture


def _item_code(conn: Connection, doc_id: int, row_id: int) -> str:
    if not (master_layouts.LAYOUTS.get(doc_id) or {}).get("image"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This master has no picture")
    meta = masters_service.get_meta(conn, doc_id)
    return str(masters_service.get_row(conn, meta, row_id)[meta.code_col])


@router.get("/{doc_id}/{row_id}/image")
def get_image(doc_id: int, row_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_from_path(RIGHT_VIEW))):
    path = svc.get_item_image(_item_code(conn, doc_id, row_id))
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No image")
    return FileResponse(path, media_type="image/jpeg")


@router.put("/{doc_id}/{row_id}/image")
async def put_image(doc_id: int, row_id: int, file: UploadFile = File(...), _: CurrentUser = Depends(require_right_from_path(RIGHT_EDIT))):
    content = await file.read()
    if not content or len(content) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose an image up to 5 MB")
    with with_transaction() as conn:
        code = _item_code(conn, doc_id, row_id)
    svc.set_item_image(code, content)
    return {"message": "Image updated"}
