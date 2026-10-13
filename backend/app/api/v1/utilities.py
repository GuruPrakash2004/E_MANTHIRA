"""Utilities menu: Authorise Documents and Screen Documents (services/authorisation.py, services/screen_docs.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user
from app.services import authorisation, screen_docs

router = APIRouter(prefix="/utilities", tags=["utilities"])


# ---- Authorise Documents -------------------------------------------------------------------------------------------
@router.get("/authorise/summary")
def authorise_summary(conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    return authorisation.summary(conn, user)


@router.get("/authorise/{doc_id}/pending")
def authorise_pending(doc_id: int, level: int = 1, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    return authorisation.pending(conn, user, doc_id=doc_id, level=level)


class AuthoriseBody(BaseModel):
    level: int = 1
    ids: list[int]


@router.post("/authorise/{doc_id}")
def authorise_docs(doc_id: int, body: AuthoriseBody, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        n = authorisation.authorise(conn, user, doc_id=doc_id, level=body.level, ids=body.ids)
    return {"message": "Selected Document Authorised Successfully!", "authorised": n}


# ---- Screen Documents ----------------------------------------------------------------------------------------------
@router.get("/screen-docs/screens")
def sd_screens(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return screen_docs.screens(conn)


@router.get("/screen-docs")
def sd_list(screen: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return screen_docs.list_docs(conn, screen)


@router.post("/screen-docs", status_code=201)
async def sd_add(
    screen: str = Form(...),
    group: str = Form(...),
    remarks: str = Form(""),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    data = await file.read()
    with with_transaction() as conn:
        new_id = screen_docs.add_doc(conn, screen=screen, group=group, filename=file.filename or "", remarks=remarks, data=data, user_code=user.user_code)
    return {"message": "Details saved Successfully!!!", "doc_id": new_id}


class RemarksBody(BaseModel):
    remarks: str = ""


@router.put("/screen-docs/{doc_id}")
def sd_update(doc_id: int, body: RemarksBody, user: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        screen_docs.update_remarks(conn, doc_id=doc_id, remarks=body.remarks, user_code=user.user_code)
    return {"message": "Details Updated Successfully!!!"}


@router.delete("/screen-docs/{doc_id}")
def sd_delete(doc_id: int, _: CurrentUser = Depends(get_current_user)):
    with with_transaction() as conn:
        screen_docs.delete_doc(conn, doc_id)
    return {"message": "Deleted"}


@router.get("/screen-docs/{doc_id}/download")
def sd_download(doc_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    name = screen_docs.get_file_name(conn, doc_id)
    path = screen_docs.file_path(name)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"This file : {name} does not exist on the server")
    return FileResponse(path, filename=name)


# ---- ShortClose Documents ------------------------------------------------------------------------------------------
@router.get("/shortclose/documents")
def shortclose_documents(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Documents that other documents are linked from (UtlTransactions.LinkedFromDocShForm) — only those can be short-closed."""
    from sqlalchemy import text

    rows = conn.execute(
        text(
            "SELECT DISTINCT s.DocID, s.DocName FROM UtlTransactions s "
            "JOIN UtlTransactions l ON l.LinkedFromDocShForm = s.DocShForm WHERE s.DocShForm IS NOT NULL AND s.DocShForm <> '' ORDER BY s.DocName"
        )
    ).all()
    return [{"doc_id": r[0], "name": r[1]} for r in rows]
