"""Panchanga calendar endpoints — see app/services/panchanga.py."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import require_right_for_form,  CurrentUser, get_current_user
from app.services import panchanga as panchanga_service
from app.utils import xls as xls_util

from app.meta.menu import RIGHT_DELETE, RIGHT_EDIT, RIGHT_VIEW
_FORM = 'FRMUTLPANCHANGA'
router = APIRouter(prefix="/panchanga", tags=["panchanga"])


@router.get("")
def list_panchanga(from_date: date, to_date: date, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return panchanga_service.list_range(conn, from_date=from_date, to_date=to_date)


@router.get("/events")
def list_events(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """The Event master: what a day's details are chosen from, with each event's calendar colour."""
    return panchanga_service.events(conn)


class SetDayRequest(BaseModel):
    date: date
    names: list[str] = []  # the day's details, each from the Event master (empty = clear the day)
    name: str = ""  # one detail (older callers)


@router.put("")
def set_panchanga_day(body: SetDayRequest, _: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_EDIT))):
    names = body.names or ([body.name] if body.name.strip() else [])
    with with_transaction() as conn:
        panchanga_service.set_day(conn, day=body.date, names=names)
    return {"message": "Updated Successfully"}


class BulkSetRequest(BaseModel):
    dates: list[date]
    name: str


@router.put("/bulk")
def set_panchanga_bulk(body: BulkSetRequest, _: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_EDIT))):
    """The same event name on many days at once (e.g. every Monday of a range); one transaction, all or nothing."""
    if not body.dates:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose at least one date")
    if len(body.dates) > 400:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Too many dates at once (limit 400)")
    with with_transaction() as conn:
        for day in sorted(set(body.dates)):
            panchanga_service.set_day(conn, day=day, names=[body.name] if body.name.strip() else [])
    return {"message": "Updated", "count": len(set(body.dates))}


@router.delete("/{day}")
def delete_panchanga_day(day: date, _: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_DELETE))):
    with with_transaction() as conn:
        panchanga_service.delete_day(conn, day=day)
    return {"message": "Deleted"}


# -- Import from Excel (.xls, like every import in the app) and the Rathothsava date
@router.get("/import/template")
def import_template(_: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_EDIT))):
    data = xls_util.build_xls("Panchanga", [panchanga_service.TEMPLATE_HEADER])
    return Response(content=data, media_type=xls_util.MIME, headers={"Content-Disposition": 'attachment; filename="Panchanga Template.xls"'})


@router.post("/import/preview")
async def import_preview(file: UploadFile = File(...), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_EDIT))):
    rows = xls_util.read_xls(await file.read())
    return {"rows": panchanga_service.import_preview(conn, rows)}


class ImportRow(BaseModel):
    date: str
    name: str


@router.post("/import")
def import_rows(rows: list[ImportRow], _: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_EDIT))):
    with with_transaction() as conn:
        n = panchanga_service.import_save(conn, [r.model_dump() for r in rows])
    return {"message": "Data saved sucessfully.", "count": n}


@router.get("/rathothsava")
def get_rathothsava(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    return panchanga_service.get_rath(conn)


class RathBody(BaseModel):
    day: date | None = None
    enabled: bool = False


@router.put("/rathothsava")
def put_rathothsava(body: RathBody, _: CurrentUser = Depends(require_right_for_form(_FORM, RIGHT_EDIT))):
    with with_transaction() as conn:
        panchanga_service.save_rath(conn, day=body.day, enabled=body.enabled)
    return {"message": "Updated Successfully!"}
