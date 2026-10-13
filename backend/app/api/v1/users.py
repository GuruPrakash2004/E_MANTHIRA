"""
One bespoke endpoint for the User Master (DocID 18): password reset. Every
other field (UserCode, UserName, RoleID, Mobileno, EmailID, Designation,
Inactive, ...) already flows through the generic `/masters/18` CRUD
(masters.py) — `LoginPwd` is the one column that can't, since it must be
written in the legacy 3DES format (CLAUDE.md §8), never as plaintext.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import legacy_crypto
from app.core.db import get_conn, with_transaction
from app.core.security import CurrentUser, get_current_user, require_right
from app.legacy.tables import update_row
from app.meta.menu import RIGHT_EDIT

USER_MASTER_DOC_ID = 18

router = APIRouter(prefix="/users", tags=["users"])


class SetPasswordRequest(BaseModel):
    new_password: str


@router.put("/{user_id}/password")
def set_password(
    user_id: int, body: SetPasswordRequest, _: CurrentUser = Depends(require_right(USER_MASTER_DOC_ID, RIGHT_EDIT))
):
    if len(body.new_password) < 4:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password must be at least 4 characters")
    with with_transaction() as conn:
        _check_password_rules(conn, body.new_password)
        exists = conn.execute(text("SELECT 1 FROM MstUser WHERE UserID = :id"), {"id": user_id}).first()
        if not exists:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        update_row(
            conn,
            "MstUser",
            "UserID",
            user_id,
            {"LoginPwd": legacy_crypto.encrypt(body.new_password), "PwdResetDt": datetime.now()},
        )
    return {"message": "Password updated"}


# ---------------------------------------------------------------- User Master form settings / password rules / photo
# Legacy frmMstUSer: the Role box is hidden when the client is "user based"; the password boxes are hidden with AD
# authentication; password rules (UtlMisc.PwdMin*) apply when PwdPolicy and PwdRules are both 'Y'.


def _misc(conn: Connection) -> dict:
    return dict(conn.execute(text("SELECT TOP 1 * FROM UtlMisc")).mappings().first() or {})


def _yes(v) -> bool:
    return (v or "N").strip().upper() == "Y"


def _rules(m: dict) -> dict:
    g = lambda k: int(m.get(k) or 0)  # noqa: E731
    return {"min_len": g("PwdMinLen"), "min_alpha": g("PwdMinAlpha"), "min_numeric": g("PwdMinNumeric"), "min_spl": g("PwdMinSplChrs"), "min_lower": g("PwdMinLCase"), "min_upper": g("PwdMinUCase")}


def _check_password_rules(conn: Connection, pwd: str) -> None:
    m = _misc(conn)
    if not (_yes(m.get("PwdPolicy")) and _yes(m.get("PwdRules"))):
        return
    r = _rules(m)
    p = pwd.strip()
    digits = sum(c.isdigit() for c in p)
    lower = sum(c.islower() for c in p)
    upper = sum(c.isupper() for c in p)
    alpha = lower + upper
    spl = len(p) - digits - alpha
    if len(p) < r["min_len"] or alpha < r["min_alpha"] or digits < r["min_numeric"] or spl < r["min_spl"] or lower < r["min_lower"] or upper < r["min_upper"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password doesn't match the Rules!")


@router.get("/form-settings")
def form_settings(conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    m = _misc(conn)
    return {
        "user_based": _yes(m.get("UserBased")),
        "ad_auth": _yes(m.get("ADAuth")),
        "pwd_policy": _yes(m.get("PwdPolicy")),
        "pwd_rules": _yes(m.get("PwdPolicy")) and _yes(m.get("PwdRules")),
        "rules": _rules(m),
    }


def _jpeg(raw: bytes) -> bytes:
    """Photos saved by the legacy program may carry an OLE header; return the image bytes from the JPEG/PNG start."""
    for sig in (bytes([0xFF, 0xD8, 0xFF]), bytes([0x89]) + b"PNG", b"GIF8", b"BM"):
        i = raw[:400].find(sig)
        if i >= 0:
            return raw[i:]
    return raw


@router.get("/{user_id}/image")
def get_image(user_id: int, conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    raw = conn.execute(text("SELECT UserImg FROM MstUser WHERE UserID = :i"), {"i": user_id}).scalar()
    if not raw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No photo")
    data = _jpeg(bytes(raw))
    return Response(content=data, media_type="image/png" if data[:4] == bytes([0x89]) + b"PNG" else "image/jpeg")


@router.put("/{user_id}/image")
async def put_image(user_id: int, file: UploadFile = File(...), _: CurrentUser = Depends(require_right(USER_MASTER_DOC_ID, RIGHT_EDIT))):
    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Please select an image less than THREE MB. Currently it is {len(data) / 1048576:.2f} MB")
    if data[:3] != bytes([0xFF, 0xD8, 0xFF]):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please enter only jpg/jpeg images!")
    with with_transaction() as conn:
        conn.execute(text("UPDATE MstUser SET UserImg = :b WHERE UserID = :i"), {"b": data, "i": user_id})
    return {"message": "Image updated"}


@router.delete("/{user_id}/image")
def delete_image(user_id: int, _: CurrentUser = Depends(require_right(USER_MASTER_DOC_ID, RIGHT_EDIT))):
    with with_transaction() as conn:
        conn.execute(text("UPDATE MstUser SET UserImg = NULL WHERE UserID = :i"), {"i": user_id})
    return {"message": "Image removed"}
