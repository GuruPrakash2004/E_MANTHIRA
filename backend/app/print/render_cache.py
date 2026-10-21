"""
Short-lived cache + single-flight for rendered documents.

The Crystal bridge renders one report at a time (its engine is not thread-safe), so every repeated or duplicate render
queues behind the one before it and eventually times out. One print flow asks for the same document several times
(preview in the dialog, then Print on this PC / on the server, a double-clicked F10 ...). This keeps the finished
render for a few seconds and makes concurrent identical requests share one render instead of piling up.

TTL is deliberately short (PRINT_CACHE_TTL_SECONDS, default 30; 0 turns the cache off): a document edited and printed
again within that window would otherwise show the old content.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Callable, Hashable, TypeVar

from app.core.config import get_settings

T = TypeVar("T")
MAX_ENTRIES = 48
MAX_BYTES = 96 * 1024 * 1024


def _size(value: object) -> int:
    pdf = getattr(value, "pdf", None)
    if isinstance(pdf, (bytes, bytearray)):
        return len(pdf)
    if isinstance(value, (list, tuple, dict)):
        return sum(len(str(p.get("png", ""))) for p in value) if isinstance(value, list) else 1024
    return 1024


class RenderCache:
    def __init__(self) -> None:
        self._data: "OrderedDict[Hashable, tuple[float, int, object]]" = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()
        self._flights: dict[Hashable, list] = {}  # key -> [lock, waiters]

    @staticmethod
    def _ttl() -> float:
        return float(get_settings().print_cache_ttl_seconds or 0)

    def _get(self, key: Hashable):
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return None
            stored, size, value = hit
            if time.monotonic() - stored > self._ttl():
                del self._data[key]
                self._bytes -= size
                return None
            self._data.move_to_end(key)
            return value

    def _put(self, key: Hashable, value: object) -> None:
        size = _size(value)
        with self._lock:
            old = self._data.pop(key, None)
            if old:
                self._bytes -= old[1]
            self._data[key] = (time.monotonic(), size, value)
            self._bytes += size
            while self._data and (len(self._data) > MAX_ENTRIES or self._bytes > MAX_BYTES):
                _, (_, s, _) = self._data.popitem(last=False)
                self._bytes -= s

    def get_or_compute(self, key: Hashable, fn: Callable[[], T]) -> T:
        if self._ttl() <= 0:
            return fn()
        hit = self._get(key)
        if hit is not None:
            return hit  # type: ignore[return-value]
        with self._lock:
            flight = self._flights.setdefault(key, [threading.Lock(), 0])
            flight[1] += 1
        try:
            with flight[0]:
                hit = self._get(key)  # another request may have finished it while this one waited
                if hit is not None:
                    return hit  # type: ignore[return-value]
                value = fn()
                self._put(key, value)
                return value
        finally:
            with self._lock:
                flight[1] -= 1
                if flight[1] == 0:
                    self._flights.pop(key, None)


cache = RenderCache()
