"""Welcome video (post-login animation) — an optional ADMIN-uploaded replacement for the built-in clips.

No DB tables: the file lives in backend/welcome_media/ (git-ignored) next to a tiny welcome.json holding the
on/off switch, so nothing touches the legacy schema. GET /welcome/video is public on purpose: the browser's
<video> tag cannot send the Authorization header, and the clip is a branding asset, not data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/welcome", tags=["welcome"])

MEDIA_DIR = Path(__file__).resolve().parents[3] / "welcome_media"
VIDEO_PATH = MEDIA_DIR / "welcome.mp4"
STATE_PATH = MEDIA_DIR / "welcome.json"
MAX_BYTES = 60 * 1024 * 1024  # 60 MB


def _require_admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change the welcome video")


def _enabled() -> bool:
    try:
        return bool(json.loads(STATE_PATH.read_text(encoding="utf-8")).get("enabled", True))
    except (OSError, ValueError):
        return True


def _write_enabled(value: bool) -> None:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps({"enabled": value}), encoding="utf-8")


def _status() -> dict:
    has = VIDEO_PATH.is_file()
    st = VIDEO_PATH.stat() if has else None
    return {
        "enabled": _enabled(),
        "custom": has,
        "size": st.st_size if st else 0,
        "version": int(st.st_mtime) if st else 0,  # cache-buster for the <video> URL
    }


@router.get("")
def get_welcome(_: CurrentUser = Depends(get_current_user)):
    return _status()


@router.get("/video")
def get_welcome_video(request: Request):
    """Serves the clip with HTTP Range support (Safari/iPad refuse to play video without 206 responses)."""
    if not VIDEO_PATH.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No custom welcome video")
    total = VIDEO_PATH.stat().st_size
    start, end = 0, total - 1
    rng = request.headers.get("range", "")
    partial = False
    if rng.startswith("bytes="):
        a, _, b = rng[6:].split(",")[0].strip().partition("-")
        try:
            if a == "":  # suffix range: last N bytes
                start = max(0, total - int(b))
            else:
                start = int(a)
                end = min(int(b), total - 1) if b else total - 1
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        if start > end or start >= total:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        partial = True
    length = end - start + 1

    def body():
        with open(VIDEO_PATH, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1024 * 1024, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(length), "Cache-Control": "public, max-age=31536000, immutable"}  # URL carries ?v=<mtime>, so a new upload is a new URL
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return StreamingResponse(body(), status_code=206 if partial else 200, media_type="video/mp4", headers=headers)


@router.post("")
async def upload_welcome(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    if not (file.filename or "").lower().endswith(".mp4"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .mp4 files are accepted")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MEDIA_DIR / "welcome.upload.tmp"
    size = 0
    try:
        with open(tmp, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Video is larger than 60 MB")
                out.write(chunk)
        with open(tmp, "rb") as f:
            head = f.read(12)
        if len(head) < 12 or head[4:8] != b"ftyp":  # every MP4 starts with an 'ftyp' box
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file is not a valid MP4 video")
        os.replace(tmp, VIDEO_PATH)  # atomic: a half-uploaded file never becomes the welcome video
    finally:
        if tmp.exists():
            tmp.unlink()
    return _status()


class EnabledRequest(BaseModel):
    enabled: bool


@router.put("/enabled")
def set_enabled(body: EnabledRequest, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    _write_enabled(body.enabled)
    return _status()


@router.delete("")
def remove_welcome(user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    if VIDEO_PATH.is_file():
        VIDEO_PATH.unlink()
    return _status()
