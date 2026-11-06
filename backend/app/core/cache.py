"""
Tiny in-process TTL cache for read-mostly metadata (rights, menu lookups,
financial years, document field designs).

Safe-by-design limits: only ever used for tables the app itself rarely writes;
every in-app writer calls `clear(prefix)` so changes show at once, and the TTL
bounds staleness for edits made by the legacy EXE (which bypass this process).
Never use it for numbering, MAX()+1 ids or Trn* data. Per-process (each uvicorn
worker has its own copy), so the TTL is the cross-worker upper bound.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

_lock = threading.Lock()
_store: dict[tuple, tuple[float, Any]] = {}


# Tables the Doc Designer / Admin screens own. A change to any of them (row count or content checksum) drops every
# cached copy, so an edit made in the Designer shows on the next request / page refresh instead of after the TTL.
_WATCHED = ("UtlDocDsgrFlds", "UtlTransactions", "MstMenu", "UtlOption", "UtlDocNoPrefix", "UtlDocNoFmt", "MstRoleRights", "MstUserRights", "MstCompFinYear")
_CHECK_EVERY = 2.0  # seconds between fingerprint checks
_fp: dict[str, Any] = {"value": None, "at": 0.0}


def _fingerprint() -> str | None:
    try:
        from sqlalchemy import text

        from app.core.db import get_engine

        parts = []
        with get_engine().connect() as c:
            # NOLOCK + a short lock timeout: this read runs on a SECOND pool connection, often while the request's own
            # transaction has just written one of these tables (e.g. UPDATE MstMenu, then the audit row). A normal read would
            # wait for that uncommitted write forever while the writer waits for this read: a self-deadlock that hung saves
            # and filled the connection pool. A dirty read is harmless here: it only decides whether to drop the cache.
            c.execute(text("SET LOCK_TIMEOUT 2000"))
            for t in _WATCHED:
                try:
                    r = c.execute(text(f"SELECT COUNT_BIG(*), CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM {t} WITH (NOLOCK)")).first()
                    parts.append(f"{t}:{r[0]}:{r[1]}")
                except Exception:  # a table missing in this database is simply not watched
                    pass
        return "|".join(parts)
    except Exception:
        return None  # DB unreachable: leave the cache alone, the TTL still applies


def _revalidate() -> None:
    now = time.monotonic()
    with _lock:
        if now - _fp["at"] < _CHECK_EVERY:
            return
        _fp["at"] = now
    value = _fingerprint()
    if value is None:
        return
    with _lock:
        if _fp["value"] is not None and value != _fp["value"]:
            _store.clear()
        _fp["value"] = value


def get_or_set(key: tuple, ttl: float, loader: Callable[[], Any]) -> Any:
    _revalidate()
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = loader()  # outside the lock: a slow DB call never blocks other keys
    with _lock:
        _store[key] = (now + ttl, value)
    return value


def clear(prefix: str | None = None) -> None:
    """Drop every entry whose key starts with `prefix` (all entries if None)."""
    with _lock:
        if prefix is None:
            _store.clear()
        else:
            for k in [k for k in _store if k and k[0] == prefix]:
                del _store[k]
