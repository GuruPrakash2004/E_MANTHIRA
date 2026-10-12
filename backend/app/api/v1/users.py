"""
One bespoke endpoint for the User Master (DocID 18): password reset. Every
other field (UserCode, UserName, RoleID, Mobileno, EmailID, Designation,
Inactive, ...) already flows through the generic `/masters/18` CRUD
(masters.py) — `LoginPwd` is the one column that can't, since it must be
written in the legacy 3DES format (CLAUDE.md §8), never as plaintext.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app.core import legacy_crypto
from app.core.db import with_transaction
from app.core.security import CurrentUser, require_right
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
