"""Login / session — port of `frmLogin` (doc 07 §5.1)."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import audit
from app.core.db import get_conn, with_transaction
from app.core.fy import get_active_fy, list_fys
from app.core.legacy_crypto import decrypt, encrypt
from app.core.security import CurrentUser, create_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_code: str
    user_name: str
    role_id: int
    financial_year_id: int
    financial_year_label: str
    password_expired: bool = False


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
    confirm_password: str


def _password_ok_against_policy(conn: Connection, new_password: str) -> str | None:
    row = conn.execute(
        text("SELECT PwdMinSplChrs, PwdMinNumeric, PwdMinAlpha, PwdMinLen, PwdMinLCase, PwdMinUCase, PwdPolicy FROM UtlMisc")
    ).mappings().first()
    if row is None or (row["PwdPolicy"] or "N").strip().upper() != "Y":
        return None
    import re

    checks = [
        (int(row["PwdMinLen"] or 0), len(new_password), "characters"),
        (int(row["PwdMinAlpha"] or 0), sum(c.isalpha() for c in new_password), "letters"),
        (int(row["PwdMinNumeric"] or 0), sum(c.isdigit() for c in new_password), "digits"),
        (int(row["PwdMinUCase"] or 0), sum(c.isupper() for c in new_password), "upper-case letters"),
        (int(row["PwdMinLCase"] or 0), sum(c.islower() for c in new_password), "lower-case letters"),
        (int(row["PwdMinSplChrs"] or 0), len(re.findall(r"[^A-Za-z0-9]", new_password)), "special characters"),
    ]
    for minimum, actual, label in checks:
        if actual < minimum:
            return f"Password needs at least {minimum} {label}"
    return None


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, conn: Connection = Depends(get_conn)):
    row = conn.execute(
        text("SELECT UserID, UserCode, UserName, LoginPwd, RoleID, Inactive, PwdResetDt FROM MstUser WHERE UserCode = :u"), {"u": body.username}
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Login Name !!")
    if (row["Inactive"] or "N").strip().upper() == "Y":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not a valid User!")

    stored = row["LoginPwd"] or ""
    try:
        plain = decrypt(stored)
    except Exception:  # noqa: BLE001 - legacy ciphertext can be malformed; treat as no match
        plain = None
    if plain != body.password:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password Incorrect")

    fy = get_active_fy(conn)

    password_expired = False
    row_misc = conn.execute(text("SELECT PwdExpiryDays FROM UtlMisc")).mappings().first()
    expiry_days = int((row_misc or {}).get("PwdExpiryDays") or 0)
    if expiry_days > 0 and row["PwdResetDt"]:
        reset_dt = row["PwdResetDt"]
        if isinstance(reset_dt, datetime):
            reset_dt = reset_dt.date()
        if (date.today() - reset_dt).days >= expiry_days:
            password_expired = True

    access = create_token(subject=str(row["UserID"]), extra={"type": "access", "fy": fy.id})
    refresh = create_token(subject=str(row["UserID"]), extra={"type": "refresh"}, days=7)

    with with_transaction() as tconn:
        audit.record(tconn, entity="Login", entity_id=row["UserID"], action="A", user_code=row["UserCode"])

    return LoginResponse(
        access_token=access,
        refresh_token=refresh,
        user_code=row["UserCode"],
        user_name=row["UserName"] or row["UserCode"],
        role_id=row["RoleID"] or 0,
        financial_year_id=fy.id,
        financial_year_label=f"{fy.start_date:%d/%m/%Y} - {fy.end_date:%d/%m/%Y}",
        password_expired=password_expired,
    )


@router.post("/refresh", response_model=LoginResponse)
def refresh(refresh_token: str, conn: Connection = Depends(get_conn)):
    from app.core.security import decode_token

    payload = decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    user_id = int(payload["sub"])
    row = conn.execute(text("SELECT UserCode, UserName, RoleID, Inactive FROM MstUser WHERE UserID = :id"), {"id": user_id}).mappings().first()
    if row is None or (row["Inactive"] or "N").strip().upper() == "Y":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    fy = get_active_fy(conn)
    access = create_token(subject=str(user_id), extra={"type": "access", "fy": fy.id})
    new_refresh = create_token(subject=str(user_id), extra={"type": "refresh"}, days=7)
    return LoginResponse(
        access_token=access,
        refresh_token=new_refresh,
        user_code=row["UserCode"],
        user_name=row["UserName"] or row["UserCode"],
        role_id=row["RoleID"] or 0,
        financial_year_id=fy.id,
        financial_year_label=f"{fy.start_date:%d/%m/%Y} - {fy.end_date:%d/%m/%Y}",
    )


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)):
    row = conn.execute(text("SELECT LoginPwd FROM MstUser WHERE UserID = :id"), {"id": user.user_id}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if decrypt(row["LoginPwd"] or "") != body.old_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Old password is incorrect!")
    if body.old_password == body.new_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Old password cannot be used as new password!")
    if body.new_password != body.confirm_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password and confirm password does not match!")
    policy_error = _password_ok_against_policy(conn, body.new_password)
    if policy_error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, policy_error)

    with with_transaction() as tconn:
        tconn.execute(
            text("UPDATE MstUser SET LoginPwd = :pwd, PwdResetDt = :today WHERE UserID = :id"),
            {"pwd": encrypt(body.new_password), "today": date.today(), "id": user.user_id},
        )
    return {"message": "Password changed successfully!"}


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user), conn: Connection = Depends(get_conn)):
    row = conn.execute(text("SELECT * FROM MstUser WHERE UserID = :id"), {"id": user.user_id}).mappings().first()
    return {"user_id": user.user_id, "user_code": user.user_code, "role_id": user.role_id, "user_name": row["UserName"] if row else user.user_code}


@router.get("/financial-years")
def financial_years(conn: Connection = Depends(get_conn)):
    return [{"id": f.id, "start_date": f.start_date, "end_date": f.end_date, "is_active": f.is_active} for f in list_fys(conn)]
