"""Generic grid export: the browser posts the rows it is showing and gets an Excel 97-2003 (.xls) file back."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user
from app.utils.xls import MIME, build_listing_xls

router = APIRouter(prefix="/export", tags=["export"])


class XlsBody(BaseModel):
    filename: str = "export"
    sheet: str = "Sheet1"
    title: str | None = None  # page name for the "Listing of ..." line; defaults to the file name
    headers: list[str]
    rows: list[list]


def _company_name(conn: Connection) -> str:
    try:
        from app.services import company as company_service

        return str(company_service.get_company(conn).get("CompName") or "").strip()
    except Exception:  # noqa: BLE001 - an export must never fail because the company row is missing
        return ""


@router.post("/xls")
def export_xls(body: XlsBody, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    name = re.sub(r"[\/:*?\"<>|]", "", body.filename).strip() or "export"
    name = re.sub(r"\.(xls|xlsx|csv)$", "", name, flags=re.I) or "export"
    content = build_listing_xls(body.sheet or name, _company_name(conn), (body.title or name).strip(), body.headers, body.rows)
    return Response(content=content, media_type=MIME, headers={"Content-Disposition": f'attachment; filename="{name}.xls"'})
