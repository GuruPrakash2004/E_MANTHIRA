"""Generic grid export: the browser posts the rows it is showing and gets an Excel 97-2003 (.xls) file back."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from app.core.security import CurrentUser, get_current_user
from app.utils.xls import MIME, build_xls

router = APIRouter(prefix="/export", tags=["export"])


class XlsBody(BaseModel):
    filename: str = "export"
    sheet: str = "Sheet1"
    headers: list[str]
    rows: list[list]


@router.post("/xls")
def export_xls(body: XlsBody, _: CurrentUser = Depends(get_current_user)):
    name = re.sub(r"[\/:*?\"<>|]", "", body.filename).strip() or "export"
    name = re.sub(r"\.(xls|xlsx|csv)$", "", name, flags=re.I) or "export"
    content = build_xls(body.sheet or name, [body.headers, *body.rows])
    return Response(content=content, media_type=MIME, headers={"Content-Disposition": f'attachment; filename="{name}.xls"'})
