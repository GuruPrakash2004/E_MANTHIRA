"""Split payment helpers for the Seva / Donation screens (see app/services/split_payment.py)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection

from app.core.db import get_conn
from app.core.security import CurrentUser, get_current_user
from app.services import split_payment as svc

router = APIRouter(prefix="/split-payments", tags=["split-payments"])


class SplitPartIn(BaseModel):
    mode: str = Field(min_length=1, max_length=20)
    amount: float
    led_id: int
    ref_no: str = Field("", max_length=60)
    chq_date: date | None = None
    bank_name: str = Field("", max_length=60)


def to_parts(items: list[SplitPartIn] | None) -> list[svc.SplitPart] | None:
    if not items:
        return None
    return [svc.SplitPart(mode=i.mode, amount=i.amount, led_id=i.led_id, ref_no=i.ref_no, chq_date=i.chq_date, bank_name=i.bank_name) for i in items]


@router.get("/meta")
def meta(doc_type: str = Query(..., pattern="^(SEVA|DONREC)$"), conn: Connection = Depends(get_conn), _: CurrentUser = Depends(get_current_user)):
    """Whether split payment can be used here, the document's own payment modes, and the cash / bank account usually used with each."""
    if not svc.available():
        return {"available": False, "modes": [], "defaults": {}}
    return {"available": True, "modes": svc.designer_modes(conn, doc_type), "defaults": svc.defaults(conn, doc_type), "min_parts": svc.MIN_PARTS}


def ensure_ok(parts, extra: bool = False) -> None:
    if parts and extra:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A split payment cannot be combined with extra sevas on one entry")
