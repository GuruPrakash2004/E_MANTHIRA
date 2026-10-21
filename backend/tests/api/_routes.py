"""Route discovery shared by the API tests. Everything is derived from the live
FastAPI app, so a newly added endpoint is covered automatically."""
from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi.routing import APIRoute

from app.core.security import get_current_user
from app.main import app

# Never called blindly: PUT /db-settings repoints the live database.
UNSAFE_TO_CALL = ("/db-settings",)
# Crystal-bridge renders: slow, need the bridge process, no DB-contract value.
HEAVY_GETS = ("/preview", "/pages", "/bulk-pdf")

# Routes that are intentionally reachable without a token.
EXPECTED_PUBLIC = {
    ("GET", "/auth/financial-years"),
    ("POST", "/auth/login"),
    ("POST", "/auth/refresh"),
    ("GET", "/db-settings"),
    ("PUT", "/db-settings"),
    ("POST", "/db-settings/databases"),
    ("POST", "/db-settings/test"),
    ("GET", "/display/today-sevas"),
    ("GET", "/print/agent"),
    ("GET", "/welcome/video"),
    ("GET", "/health"),
}

PATH_VALUES = {
    "doc_id": "1255", "row_id": "1", "kind": "payments", "file_name": "x.png",
    "option_name": "x",
}


@dataclass(frozen=True)
class Ep:
    method: str
    path: str            # path relative to the API prefix, with {params}
    requires_auth: bool
    body_required: bool  # JSON body model with at least one required field

    @property
    def id(self) -> str:
        return f"{self.method} {self.path}"

    def url(self, prefix: str) -> str:
        def fill(m: re.Match) -> str:
            return PATH_VALUES.get(m.group(1), "1")
        return prefix + re.sub(r"\{(\w+)\}", fill, self.path)


def _needs_auth(dependant) -> bool:
    return any(d.call is get_current_user or _needs_auth(d) for d in dependant.dependencies)


def _body_required(route: APIRoute) -> bool:
    """True ONLY for a typed pydantic body with at least one required field, so
    `{}` is guaranteed to fail validation before the handler runs. A free-form
    `dict[str, Any]` body (company, mail-settings, masters PUT, ...) accepts `{}`
    and runs the handler, so those are never treated as safe to call."""
    field = route.body_field
    if field is None:
        return False
    model = getattr(field.field_info, "annotation", None)
    fields = getattr(model, "model_fields", None)
    if not fields:
        return False
    return any(f.is_required() for f in fields.values())


def endpoints(prefix: str) -> list[Ep]:
    out = []
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        rel = r.path[len(prefix):] if r.path.startswith(prefix) else r.path
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            out.append(Ep(m, rel, _needs_auth(r.dependant), _body_required(r)))
    return sorted(out, key=lambda e: (e.path, e.method))
