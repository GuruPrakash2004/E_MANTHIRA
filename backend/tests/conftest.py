"""
Shared pytest fixtures. Tests run against the SAME restored SQL Server
database used for manual verification during this build (see
vTemple_Analysis/README.md for how to restore it) — never against a mock,
because the whole point of these tests is proving parity with real legacy
data (CLAUDE.md rule 1/2).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import get_engine  # noqa: E402


@pytest.fixture(scope="session")
def engine():
    return get_engine()


@pytest.fixture()
def conn(engine):
    with engine.connect() as c:
        yield c
