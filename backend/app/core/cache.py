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


def get_or_set(key: tuple, ttl: float, loader: Callable[[], Any]) -> Any:
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
