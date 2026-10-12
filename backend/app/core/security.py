from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_settings
from app.core.db import get_conn
from app.meta import menu as meta_menu

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


@dataclass
class CurrentUser:
    user_id: int
    user_code: str
    role_id: int
    fin_year_id: int | None


def create_token(*, subject: str, extra: dict, minutes: int | None = None, days: int | None = None) -> str:
    settings = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    if days is not None:
        expire = now + dt.timedelta(days=days)
    else:
        expire = now + dt.timedelta(minutes=minutes or settings.jwt_access_minutes)
    payload = {"sub": subject, "exp": expire, "iat": now, **extra}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    conn: Connection = Depends(get_conn),
) -> CurrentUser:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    user_id = int(payload["sub"])
    row = conn.execute(
        text("SELECT UserID, UserCode, RoleID, Inactive FROM MstUser WHERE UserID = :id"),
        {"id": user_id},
    ).mappings().first()
    if row is None or (row["Inactive"] or "N").strip().upper() == "Y":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return CurrentUser(
        user_id=row["UserID"],
        user_code=row["UserCode"],
        role_id=row["RoleID"] or 0,
        fin_year_id=payload.get("fy"),
    )


def _check_right(conn: Connection, user: CurrentUser, doc_id: int, position: int) -> CurrentUser:
    menu_item_id = meta_menu.resolve_menu_item_id(conn, doc_id)
    if menu_item_id is None:
        # No menu entry (e.g. an internal doc) — allow, rights are enforced
        # at the owning screen's menu item instead.
        return user
    rights = meta_menu.get_rights_string(
        conn, user_id=user.user_id, role_id=user.role_id, user_code=user.user_code, menu_item_id=menu_item_id
    )
    if not meta_menu.has_right(rights, position):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access Denied")
    return user


def require_right(doc_id: int, position: int):
    """
    Dependency factory for screens with a FIXED DocID (Seva=1263, Hall=1281,
    Payment Voucher=1224, ...): 403s unless the current user's rights string
    has '1' at `position` for the menu item that owns `doc_id` (see
    meta/menu.py for the 12 legacy positions — RIGHT_ADD, RIGHT_EDIT, ...
    RIGHT_OPT5). `doc_id` is a plain int baked in at route-registration time.
    """

    def _dep(user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)) -> CurrentUser:
        return _check_right(conn, user, doc_id, position)

    return _dep


def require_right_from_path(position: int):
    """
    Same check as `require_right`, but for routes where the DocID is itself a
    path parameter (the generic masters endpoints, `/masters/{doc_id}/...`).
    FastAPI fills `doc_id` here from the enclosing route's path parameter of
    the same name — this dependency must only be used on routes that declare
    `doc_id` in their path.
    """

    def _dep(doc_id: int, user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)) -> CurrentUser:
        return _check_right(conn, user, doc_id, position)

    return _dep
