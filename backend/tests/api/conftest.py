from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine
from app.core.fy import get_active_fy
from app.core.security import create_token
from app.main import app

from ._routes import endpoints

PREFIX = get_settings().api_prefix


@pytest.fixture(scope="session")
def prefix() -> str:
    return PREFIX


@pytest.fixture(scope="session")
def all_endpoints():
    return endpoints(PREFIX)


@pytest.fixture(scope="session")
def client():
    # No `with`: skips the lifespan (it would start the Crystal bridge and run
    # schema DDL). Requests still go through every middleware and dependency.
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="session")
def db_ready():
    try:
        with get_engine().connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"database not reachable: {exc}")


@pytest.fixture(scope="session")
def admin_headers(db_ready):
    """Bearer token for the ADMIN user, minted directly so tests need no login
    password. Read-only: nothing here writes to the database."""
    with get_engine().connect() as c:
        uid = c.execute(text("SELECT UserID FROM MstUser WHERE UserCode='ADMIN' AND Inactive<>'Y'")).scalar()
        if uid is None:
            pytest.skip("no active ADMIN user in MstUser")
        fy = get_active_fy(c)
    tok = create_token(subject=str(uid), extra={"type": "access", "fy": fy.id})
    return {"Authorization": f"Bearer {tok}"}
