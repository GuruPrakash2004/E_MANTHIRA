"""Welcome video (post-login animation): a small library of ADMIN-chosen MP4s plus how one is picked for each sign-in.

No DB tables: the clips live in backend/welcome_media/library/ (git-ignored) next to welcome.json, which holds the on/off
switch, the mode and the list of clips, so nothing touches the legacy schema. GET /welcome/video/{id} is public on purpose:
the browser's <video> tag cannot send the Authorization header, and the clips are branding assets, not data.

Modes (who sees what is decided here, so every user and tab agrees):
  login  - a random clip on every sign-in (the browser says which one it played last, that one is skipped when there is a choice)
  day    - one clip for the whole day, random, changes at midnight
  hours  - a new random clip every N hours (blocks counted from local midnight)
Ticked clips ("active") are the pool; the built-in two-clip welcome is one more tickable entry; an empty pool = built-in.
"""
from __future__ import annotations

import json
import os
import random
import re
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/welcome", tags=["welcome"])

MEDIA_DIR = Path(__file__).resolve().parents[3] / "welcome_media"
LIB_DIR = MEDIA_DIR / "library"
LEGACY_VIDEO = MEDIA_DIR / "welcome.mp4"  # the single upload of the first version; moved into the library on first read
STATE_PATH = MEDIA_DIR / "welcome.json"
# Clips that ship with the frontend: files in frontend/public/welcome/library are served by the web server itself (Vite in development,
# the built dist in production), not streamed through this API, so playback is as smooth as the built-in clips. A library entry points
# at such a file with "static" (fixed folder, never user input).
IMPORT_DIR = MEDIA_DIR.parent.parent / "frontend" / "public" / "welcome" / "library"
STATIC_PREFIX = "/welcome/library/"
MAX_BYTES = 60 * 1024 * 1024  # 60 MB
BUILTIN = "builtin"
MODES = ("login", "day", "hours")
_lock = threading.Lock()


def _require_admin(user: CurrentUser) -> None:
    if user.user_code.upper() != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only ADMIN can change the welcome video")


# ---------------------------------------------------------------------------------------------------------- state
def _default() -> dict:
    return {"enabled": True, "mode": "login", "hours": 3, "builtin_active": False, "videos": []}


def _read() -> dict:
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    st = {**_default(), **(raw if isinstance(raw, dict) else {})}
    st["videos"] = [v for v in st.get("videos", []) if isinstance(v, dict) and v.get("id") and (v.get("file") or v.get("static"))]
    if st.get("mode") not in MODES:
        st["mode"] = "login"
    try:
        st["hours"] = min(24, max(1, int(st.get("hours", 3))))
    except (TypeError, ValueError):
        st["hours"] = 3
    return st


def _write(st: dict) -> None:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def _load() -> dict:
    """The state, with the first version's single upload moved into the library (once)."""
    st = _read()
    if LEGACY_VIDEO.is_file():
        LIB_DIR.mkdir(parents=True, exist_ok=True)
        vid = "legacy"
        if not any(v["id"] == vid for v in st["videos"]):
            os.replace(LEGACY_VIDEO, LIB_DIR / f"{vid}.mp4")
            st["videos"].append({"id": vid, "name": "Custom upload", "file": f"{vid}.mp4", "size": (LIB_DIR / f"{vid}.mp4").stat().st_size, "active": True, "added": datetime.now().isoformat(timespec="seconds")})
            _write(st)
        else:
            LEGACY_VIDEO.unlink()
    return st


def _path(v: dict) -> Path:
    if v.get("static"):  # shipped with the frontend: the file sits in its public folder
        return IMPORT_DIR / Path(v["static"]).name
    return LIB_DIR / v["file"]


def _version(v: dict) -> int:
    try:
        return int(_path(v).stat().st_mtime)
    except OSError:
        return 0


def _find(st: dict, vid: str) -> dict:
    v = next((x for x in st["videos"] if x["id"] == vid), None)
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That video is not in the library")
    return v


# ---------------------------------------------------------------------------------------------------------- picking
def _pool(st: dict) -> list[str]:
    ids = sorted(v["id"] for v in st["videos"] if v.get("active") and _path(v).is_file())
    if st.get("builtin_active"):
        ids.append(BUILTIN)
    return ids


def _pick(st: dict, now: datetime, exclude: str | None = None) -> tuple[str | None, datetime | None]:
    """(clip id or None for the built-in clips, when the pick changes). A clip id of 'builtin' also means the built-in clips."""
    pool = _pool(st)
    if not pool:
        return None, None
    mode = st["mode"]
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if mode == "day":
        return random.Random(now.date().isoformat()).choice(pool), midnight + timedelta(days=1)
    if mode == "hours":
        n = st["hours"]
        slot = int((now - midnight).total_seconds() // (n * 3600))
        changes = min(midnight + timedelta(hours=(slot + 1) * n), midnight + timedelta(days=1))
        return random.Random(f"{now.date().isoformat()}-{n}-{slot}").choice(pool), changes
    choices = [i for i in pool if i != exclude] or pool  # every sign-in: random, not the one just seen
    return random.choice(choices), None


def _status(st: dict, exclude: str | None = None) -> dict:
    now = datetime.now()
    pick, changes = _pick(st, now, exclude) if st["enabled"] else (None, None)
    play = None
    if pick == BUILTIN:
        play = {"id": BUILTIN, "name": "Built-in temple clips", "version": 0}
    elif pick:
        v = _find(st, pick)
        play = {"id": v["id"], "name": v["name"], "version": _version(v), "static": v.get("static") or None}
    videos = [{"id": v["id"], "name": v["name"], "size": v.get("size", 0), "active": bool(v.get("active")), "version": _version(v), "static": v.get("static") or None, "missing": not _path(v).is_file()} for v in st["videos"]]
    return {
        "enabled": st["enabled"],
        "mode": st["mode"],
        "hours": st["hours"],
        "builtin_active": bool(st["builtin_active"]),
        "videos": videos,
        "play": play,  # null = the built-in two-clip welcome
        "next_change": changes.isoformat(timespec="minutes") if changes else None,
        # kept for the cached copy the splash reads: true when a library clip (not the built-in clips) is the pick
        "custom": bool(play and play["id"] != BUILTIN),
    }


# ---------------------------------------------------------------------------------------------------------- helpers
def _check_mp4(path: Path) -> None:
    with open(path, "rb") as f:
        head = f.read(12)
    if len(head) < 12 or head[4:8] != b"ftyp":  # every MP4 starts with an 'ftyp' box
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file is not a valid MP4 video")


def _clean_name(filename: str) -> str:
    stem = Path(filename or "video").stem.replace("_", " ").strip()
    return re.sub(r"\s+", " ", stem)[:80] or "Video"


def _new_entry(file_id: str, name: str, size: int, source: str = "") -> dict:
    return {"id": file_id, "name": name, "file": f"{file_id}.mp4", "size": size, "active": True, "added": datetime.now().isoformat(timespec="seconds"), "source": source}


def _stream(path: Path, request: Request) -> StreamingResponse | Response:
    """The clip with HTTP Range support (Safari/iPad refuse to play video without 206 responses)."""
    total = path.stat().st_size
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
        with open(path, "rb") as f:
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


# ---------------------------------------------------------------------------------------------------------- routes
@router.get("")
def get_welcome(exclude: str | None = Query(None, max_length=40), _: CurrentUser = Depends(get_current_user)):
    """Settings + the pick for this sign-in. `exclude` = the clip this browser played last (random-each-sign-in mode)."""
    with _lock:
        return _status(_load(), exclude)


@router.get("/video/{vid}")
def get_welcome_video(vid: str, request: Request):
    with _lock:
        st = _load()
        v = next((x for x in st["videos"] if x["id"] == vid), None)
    if v is None or not _path(v).is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such welcome video")
    return _stream(_path(v), request)


@router.post("/videos")
async def add_video(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    if not (file.filename or "").lower().endswith(".mp4"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .mp4 files are accepted")
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    file_id = uuid.uuid4().hex[:12]
    tmp = LIB_DIR / f"{file_id}.upload.tmp"
    size = 0
    try:
        with open(tmp, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Video is larger than 60 MB")
                out.write(chunk)
        _check_mp4(tmp)
        os.replace(tmp, LIB_DIR / f"{file_id}.mp4")  # atomic: a half-uploaded file never joins the library
    finally:
        if tmp.exists():
            tmp.unlink()
    with _lock:
        st = _load()
        st["videos"].append(_new_entry(file_id, _clean_name(file.filename), size, file.filename or ""))
        _write(st)
        return _status(st)


class VideoPatch(BaseModel):
    name: str | None = Field(None, max_length=80)
    active: bool | None = None


@router.put("/videos/{vid}")
def patch_video(vid: str, body: VideoPatch, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with _lock:
        st = _load()
        v = _find(st, vid)
        if body.name is not None:
            if not body.name.strip():
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Give the video a name")
            v["name"] = re.sub(r"\s+", " ", body.name).strip()
        if body.active is not None:
            v["active"] = body.active
        _write(st)
        return _status(st)


@router.delete("/videos/{vid}")
def delete_video(vid: str, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with _lock:
        st = _load()
        v = _find(st, vid)
        if not v.get("static"):  # a clip that ships with the frontend is only taken off the list; "Import" brings it back
            _path(v).unlink(missing_ok=True)
        st["videos"] = [x for x in st["videos"] if x["id"] != vid]
        _write(st)
        return _status(st)


@router.post("/import-folder")
def import_folder(user: CurrentUser = Depends(get_current_user)):
    """Adds the clips that ship with the frontend (frontend/public/welcome/library/*.mp4) that the library does not list yet.

    They are registered by reference ("static"): the web server serves the file, nothing is copied. A clip that an earlier version
    copied into welcome_media (same file name) is switched to the shipped file, keeping its name and tick, and the copy is deleted.
    """
    _require_admin(user)
    if not IMPORT_DIR.is_dir():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The frontend/public/welcome/library folder was not found next to the application")
    added, converted, skipped = 0, 0, []
    with _lock:
        st = _load()
        by_source = {v.get("source", ""): v for v in st["videos"] if v.get("source")}
        for src in sorted(IMPORT_DIR.glob("*.mp4")):
            size = src.stat().st_size
            if size > MAX_BYTES:
                skipped.append(f"{src.name} (over 60 MB)")
                continue
            try:
                _check_mp4(src)
            except HTTPException:
                skipped.append(f"{src.name} (not a valid MP4)")
                continue
            have = by_source.get(src.name)
            if have is not None and have.get("static"):
                have["size"] = size
                continue
            if have is not None:  # an earlier copy in welcome_media: point it at the shipped file instead
                (LIB_DIR / have["file"]).unlink(missing_ok=True)
                have["file"] = ""
                have["static"] = STATIC_PREFIX + src.name
                have["size"] = size
                converted += 1
                continue
            entry = _new_entry(uuid.uuid4().hex[:12], _clean_name(src.name), size, src.name)
            entry["file"] = ""
            entry["static"] = STATIC_PREFIX + src.name
            st["videos"].append(entry)
            added += 1
        _write(st)
        return {**_status(st), "imported": added + converted, "added": added, "converted": converted, "skipped": skipped}


class SettingsBody(BaseModel):
    mode: str | None = None
    hours: int | None = Field(None, ge=1, le=24)
    builtin_active: bool | None = None


@router.put("/settings")
def set_settings(body: SettingsBody, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    if body.mode is not None and body.mode not in MODES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mode must be login, day or hours")
    with _lock:
        st = _load()
        if body.mode is not None:
            st["mode"] = body.mode
        if body.hours is not None:
            st["hours"] = body.hours
        if body.builtin_active is not None:
            st["builtin_active"] = body.builtin_active
        _write(st)
        return _status(st)


class EnabledRequest(BaseModel):
    enabled: bool


@router.put("/enabled")
def set_enabled(body: EnabledRequest, user: CurrentUser = Depends(get_current_user)):
    _require_admin(user)
    with _lock:
        st = _load()
        st["enabled"] = body.enabled
        _write(st)
        return _status(st)
