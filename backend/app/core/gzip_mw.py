"""GZip for JSON API responses only.

Starlette's GZipMiddleware would also compress the welcome-video Range
responses (corrupting 206 + Content-Range) and already-compressed downloads
(PDF/ZIP/XLSX). This wrapper hands those straight through and gzips the rest.
"""
from __future__ import annotations

from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

_SKIP_PATH_PARTS = ("/welcome", "/print", "/attachments", "/export", "/template")


class SelectiveGZipMiddleware:
    def __init__(self, app: ASGIApp, minimum_size: int = 1024) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            path = scope.get("path", "")
            has_range = any(k == b"range" for k, _ in scope.get("headers", []))
            if has_range or any(p in path for p in _SKIP_PATH_PARTS):
                await self.app(scope, receive, send)
                return
        await self.gzip(scope, receive, send)
