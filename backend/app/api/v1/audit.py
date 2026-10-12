"""
Audit Trail — the legacy `frmRptAuditLog` read a dedicated `UtlAuditLog`
table (LogID, LogEntity, LogAction, LogParticulars, LogUserName,
LogDateTime) that lives in the client's separate AuditLog database (see
`app/core/audit.py`'s docstring — that database wasn't in the sample
backup, confirmed absent in this DB too). This app writes its own
`WebAuditLog` instead, on every create/edit/delete `audit.record(...)`
call already scattered through the services layer — this router is simply
the first screen that *reads* it back, mirroring the legacy form's
filters (Entity / Action / User / date range) and columns.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn, limit_clause
from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/audit-log", tags=["audit-log"])


@router.get("/filters")
def get_filter_options(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Distinct Entity/Action/User values actually present — same idea as
    the legacy form's three count-then-populate combo boxes."""
    entities = [r[0] for r in conn.execute(text("SELECT DISTINCT Entity FROM WebAuditLog ORDER BY Entity")).fetchall()]
    actions = [r[0] for r in conn.execute(text("SELECT DISTINCT Action FROM WebAuditLog ORDER BY Action")).fetchall()]
    users = [r[0] for r in conn.execute(text("SELECT DISTINCT UserCode FROM WebAuditLog WHERE UserCode IS NOT NULL ORDER BY UserCode")).fetchall()]
    return {"entities": entities, "actions": actions, "users": users}


ACTION_LABELS = {"A": "Added", "M": "Modified", "D": "Deleted", "C": "Cancelled"}


@router.get("")
def list_audit_log(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    entity: str | None = Query(None),
    action: str | None = Query(None),
    user_code: str | None = Query(None),
    top: int = Query(500, le=5000),
    conn: Connection = Depends(get_conn),
    _: CurrentUser = Depends(get_current_user),
):
    if from_date is None:
        from_date = date.today() - timedelta(days=30)
    if to_date is None:
        to_date = date.today()
    to_exclusive = datetime.combine(to_date, datetime.min.time()) + timedelta(days=1)

    where = ["AtUtc >= :from_dt", "AtUtc < :to_dt"]
    params: dict = {"from_dt": from_date, "to_dt": to_exclusive}
    if entity:
        where.append("Entity = :entity")
        params["entity"] = entity
    if action:
        where.append("Action = :action")
        params["action"] = action
    if user_code:
        where.append("UserCode = :user_code")
        params["user_code"] = user_code

    sql = (
        f"SELECT ID, AtUtc, UserCode, Entity, EntityID, Action, Details "
        f"FROM WebAuditLog WHERE {' AND '.join(where)} ORDER BY ID DESC {limit_clause(top)}"
    )
    rows = conn.execute(text(sql), params).mappings().all()
    return [
        {
            "id": r["ID"],
            "at": r["AtUtc"],
            "user_code": r["UserCode"],
            "entity": r["Entity"],
            "entity_id": r["EntityID"],
            "action": r["Action"],
            "action_label": ACTION_LABELS.get(r["Action"], r["Action"]),
            "details": r["Details"],
        }
        for r in rows
    ]


@router.delete("")
def purge_audit_log(
    before: date = Query(..., description="Deletes every row strictly before this date (keep-everything-after)"),
    conn: Connection = Depends(get_conn),
    user: CurrentUser = Depends(get_current_user),
):
    """Same "delete the displayed log data" housekeeping button the legacy
    form has — ADMIN only (frontend-enforced, same convention as the rest
    of Admin Master; see users.py)."""
    if user.user_code.strip().upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can purge the audit log")
    result = conn.execute(text("DELETE FROM WebAuditLog WHERE AtUtc < :before"), {"before": before})
    conn.commit()
    return {"deleted": result.rowcount}
