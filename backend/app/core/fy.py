"""
Financial-year context — port of `svtModule.gSettings.gCompStDt/gCompEndDt`
and `MstCompFinYear` / `UserCurFinYr`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user


@dataclass
class FinancialYear:
    id: int
    start_date: date
    end_date: date
    is_active: bool

    @property
    def start_year(self) -> int:
        return self.start_date.year

    @property
    def end_year(self) -> int:
        return self.end_date.year

    def contains(self, d: date) -> bool:
        # MstCompFinYear.yrFdate/yrTdate are SQL `datetime` columns, so they come
        # back as datetime — normalise everything to plain dates before comparing.
        d_ = d.date() if isinstance(d, datetime) else d
        start = self.start_date.date() if isinstance(self.start_date, datetime) else self.start_date
        end = self.end_date.date() if isinstance(self.end_date, datetime) else self.end_date
        return start <= d_ <= end



# NOTE: MstCompFinYear.RowID is a column that exists in the legacy schema but
# is NULL on every row in this database (verified — the legacy app never
# actually uses it as a key; it just reads the single Active='Y' row). Since
# financial years never overlap, the start year is a safe, stable synthetic
# id — we never write to this table's RowID or otherwise touch the schema.
def _to_fy(row) -> FinancialYear:
    start = row["yrFdate"]
    return FinancialYear(id=start.year, start_date=start, end_date=row["yrTdate"], is_active=(row["Active"] or "N").upper() == "Y")


def get_active_fy(conn: Connection) -> FinancialYear:
    row = conn.execute(text("SELECT yrFdate, yrTdate, Active FROM MstCompFinYear WHERE Active = 'Y'")).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "No active financial year configured (MstCompFinYear)")
    return _to_fy(row)


def get_fy_by_id(conn: Connection, fy_id: int) -> FinancialYear:
    row = conn.execute(
        text("SELECT yrFdate, yrTdate, Active FROM MstCompFinYear WHERE YEAR(yrFdate) = :year"), {"year": fy_id}
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Financial year not found")
    return _to_fy(row)


def list_fys(conn: Connection) -> list[FinancialYear]:
    rows = conn.execute(text("SELECT yrFdate, yrTdate, Active FROM MstCompFinYear ORDER BY yrFdate")).mappings().all()
    return [_to_fy(r) for r in rows]


def get_user_fy(user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)) -> FinancialYear:
    """
    Dependency: the FY the user is currently working in. Prefers the JWT's
    `fy` claim (set at login / switched via PUT /financial-years/{id}/select);
    falls back to the active company FY.
    """
    if user.fin_year_id:
        return get_fy_by_id(conn, user.fin_year_id)
    return get_active_fy(conn)


def assert_date_in_fy(d: date, fy: FinancialYear) -> None:
    if not fy.contains(d):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Doc Date Should be within the financial year ({fy.start_date:%d/%m/%Y} - {fy.end_date:%d/%m/%Y})",
        )
