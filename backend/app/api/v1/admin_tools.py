"""Admin tools: SQL Query Execution, SQL Saved Query, Bulk Update (see app/services/sql_tools.py and bulk_tools.py).
Ad-hoc SQL and Bulk Update are ADMIN only. Saved Query follows the rights of its menu row (found by its legacy form name) and can
only ever run stored SELECTs."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.engine import Connection

from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user, require_right_for_form
from app.meta.menu import RIGHT_ADD, RIGHT_DELETE, RIGHT_VIEW
from app.services import bulk_tools as bulk
from app.services import sql_tools as sql

router = APIRouter(prefix="/admin-tools", tags=["admin-tools"])

SAVED_FORM = "FRMRPTQUERY"


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.user_code.strip().upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can use this tool")
    return user


class SqlBody(BaseModel):
    sql: str


class SavedBody(BaseModel):
    name: str
    group: str
    query: str


class UpdateBody(BaseModel):
    table: str
    keys: list
    field: str
    mode: str
    current: str | None = None
    partial: str = ""
    replace: str = ""


class DeleteBody(BaseModel):
    table: str
    keys: list


# ---- SQL Query Execution (ADMIN)
@router.get("/sql/info")
def sql_info(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_admin)):
    return {**sql.server_info(conn), "max_rows": sql.MAX_ROWS}


@router.get("/sql/tables")
def sql_tables(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_admin)):
    return sql.tables(conn, search)


@router.get("/sql/tables/{name}/columns")
def sql_columns(name: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_admin)):
    return sql.columns(conn, name)


@router.post("/sql/run")
def sql_run(body: SqlBody, user: CurrentUser = Depends(require_admin)):
    return sql.run_select(body.sql, user_code=user.user_code)


# ---- SQL Saved Query (menu rights)
@router.get("/saved")
def saved_list(group: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(SAVED_FORM, RIGHT_VIEW))):
    return sql.saved_list(conn, group)


@router.get("/saved/tables")
def saved_tables(search: str = "", conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(SAVED_FORM, RIGHT_VIEW))):
    return sql.tables(conn, search)


@router.get("/saved/{name}")
def saved_get(name: str, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_right_for_form(SAVED_FORM, RIGHT_VIEW))):
    return sql.saved_get(conn, name)


@router.post("/saved/{name}/run")
def saved_run(name: str, conn: Connection = Depends(get_conn), user: CurrentUser = Depends(require_right_for_form(SAVED_FORM, RIGHT_VIEW))):
    q = sql.saved_get(conn, name)["query"]
    return {**sql.run_select(q, user_code=user.user_code), "name": name}


@router.post("/saved", status_code=201)
def saved_save(body: SavedBody, user: CurrentUser = Depends(require_right_for_form(SAVED_FORM, RIGHT_ADD))):
    with with_transaction() as conn:
        sql.saved_save(conn, name=body.name, group=body.group, query=body.query, user_code=user.user_code)
    return {"message": "Query Saved successfully."}


@router.delete("/saved/{name}")
def saved_delete(name: str, user: CurrentUser = Depends(require_right_for_form(SAVED_FORM, RIGHT_DELETE))):
    with with_transaction() as conn:
        sql.saved_delete(conn, name=name, user_code=user.user_code)
    return {"message": "Deleted Successfully!"}


# ---- Bulk Update (ADMIN)
@router.get("/bulk/tables")
def bulk_tables(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_admin)):
    return bulk.tables(conn)


@router.get("/bulk/tables/{name}")
def bulk_rows(name: str, filters: str = Query("{}"), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_admin)):
    try:
        f = json.loads(filters or "{}")
    except ValueError:
        f = {}
    return bulk.rows(conn, name, f if isinstance(f, dict) else {})


@router.post("/bulk/update")
def bulk_update(body: UpdateBody, user: CurrentUser = Depends(require_admin)):
    with with_transaction() as conn:
        r = bulk.update(conn, table=body.table, keys=body.keys, field=body.field, mode=body.mode, current=body.current, partial=body.partial, replace=body.replace, user_code=user.user_code)
    return {**r, "message": f"{r['updated']} Rows updated Successfully"}


@router.post("/bulk/delete")
def bulk_delete(body: DeleteBody, user: CurrentUser = Depends(require_admin)):
    with with_transaction() as conn:
        r = bulk.delete(conn, table=body.table, keys=body.keys, user_code=user.user_code)
    return {**r, "message": "Deleted Successfully!"}


@router.get("/bulk/hsn/template")
def hsn_template(_: CurrentUser = Depends(require_admin)):
    return Response(bulk.hsn_template(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="HSN Template.xlsx"'})


@router.post("/bulk/hsn/preview")
async def hsn_preview(file: UploadFile = File(...), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(require_admin)):
    return bulk.hsn_preview(conn, await file.read())


@router.post("/bulk/hsn/apply")
async def hsn_apply(file: UploadFile = File(...), user: CurrentUser = Depends(require_admin)):
    data = await file.read()
    with with_transaction() as conn:
        r = bulk.hsn_apply(conn, data, user.user_code)
    return {**r, "message": f"{r['updated']} items updated"}
