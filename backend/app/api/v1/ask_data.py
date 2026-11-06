"""Ask the Data - thin router over app.services.ask_data."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user
from app.services import ask_data as svc
from app.services.ask_sql_guard import UnsafeSql

router = APIRouter(prefix="/ask-data", tags=["ask-data"])


def _is_admin(u: CurrentUser) -> bool:
    return u.user_code.strip().upper() == "ADMIN"


def _need_table() -> None:
    if not svc.available():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ask the Data is not available in this database (run backend/tools/create_ask_history.sql)")


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    lang: str = "en"


class FeedbackIn(BaseModel):
    rating: int = Field(ge=0, le=1)
    corrected_sql: str | None = None


@router.get("/meta")
def meta(_: CurrentUser = Depends(get_current_user)):
    """Everything the page shows that is not data: languages, availability, active model."""
    from app.core.config import get_settings

    return {"available": svc.available(), "languages": svc.LANGUAGES, "captions": svc.CAPTIONS, "suggestions": svc.ask_templates.SUGGEST, "model": get_settings().ask_hf_model if get_settings().ask_llm_fallback else ""}


@router.post("")
def ask(body: AskIn, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _need_table()
    return svc.ask(conn, question=body.question, lang=body.lang, user=user.user_code, fy=svc.user_fy(conn, user.fin_year_id))


@router.get("/history")
def history(q: str | None = Query(None), conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _need_table()
    return svc.history(conn, user=user.user_code, is_admin=_is_admin(user), q=q)


def _own(conn: Connection, hid: int, user: CurrentUser) -> dict:
    row = svc.get_history_row(conn, hid)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "History entry not found")
    if not _is_admin(user) and (row["UserCode"] or "").strip().upper() != user.user_code.strip().upper():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your history entry")
    return row


@router.post("/history/{hid}/rerun")
def rerun(hid: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _need_table()
    _own(conn, hid, user)
    try:
        return svc.rerun(conn, hid)
    except UnsafeSql as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.delete("/history/{hid}")
def delete(hid: int, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _need_table()
    _own(conn, hid, user)
    svc.delete(conn, hid)
    return {"deleted": hid}


@router.post("/history/{hid}/feedback")
def feedback(hid: int, body: FeedbackIn, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(get_current_user)):
    _need_table()
    _own(conn, hid, user)
    try:
        svc.feedback(conn, hid, body.rating, body.corrected_sql)
    except UnsafeSql as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return {"ok": True}


@router.post("/retrain")
def retrain(user: CurrentUser = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can retrain")
    return {"tables": svc.retrain()}
