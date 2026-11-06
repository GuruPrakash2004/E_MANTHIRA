"""Seva Entry: the Seva list follows the chosen Sannidhi (legacy frmTrnSeva.FillSevaCombo + MstSanSeva), on the real database."""
import pytest
from sqlalchemy import text

from app.core.db import get_engine
from app.meta import lookups

SEVA_DOC = 1263


@pytest.fixture()
def conn():
    with get_engine().connect() as c:
        yield c
        c.rollback()


def ids(conn, ctx):
    return {r["value"] for r in lookups.resolve_lookup(conn, doc_id=SEVA_DOC, field_code="SVAID", ctx=ctx, top=1000)}


def active(conn):
    return {int(r[0]) for r in conn.execute(text("SELECT SVAID FROM MstSVA WHERE InActive = 'N' AND SVAID <> 0")).all()}


def test_a_sannidhi_with_mapped_sevas_gets_only_those(conn):
    mapped = {int(r[0]): int(r[1]) for r in conn.execute(text("SELECT SanID, COUNT(*) FROM MstSanSeva GROUP BY SanID")).all()}
    assert mapped, "this database has no Sannidhi to Seva mapping"
    for san, n in mapped.items():
        want = {int(r[0]) for r in conn.execute(text("SELECT b.SvaID FROM MstSanSeva b JOIN MstSVA a ON a.SVAID = b.SvaID WHERE b.SanID = :s AND a.InActive = 'N'"), {"s": san}).all()}
        got = ids(conn, {"SANNIDHIID": san})
        assert got == want and 0 < len(got) <= n, (san, len(got), n)


def test_different_sannidhis_get_different_lists(conn):
    sans = [int(r[0]) for r in conn.execute(text("SELECT TOP 2 SanID FROM MstSanSeva GROUP BY SanID ORDER BY SanID")).all()]
    assert len(sans) == 2 and ids(conn, {"SANNIDHIID": sans[0]}) != ids(conn, {"SANNIDHIID": sans[1]})


def test_no_sannidhi_or_an_unmapped_one_offers_every_active_seva(conn):
    every = active(conn)
    assert ids(conn, {"SANNIDHIID": ""}) == every
    assert ids(conn, {"SANNIDHIID": 0}) == every
    unmapped = conn.execute(text("SELECT TOP 1 SANNIDHIID FROM MstSANNIDHI WHERE SANNIDHIID NOT IN (SELECT SanID FROM MstSanSeva)")).scalar()
    assert ids(conn, {"SANNIDHIID": unmapped}) == every


def test_inactive_sevas_are_never_offered(conn):
    inactive = {int(r[0]) for r in conn.execute(text("SELECT SVAID FROM MstSVA WHERE InActive <> 'N'")).all()}
    for ctx in ({"SANNIDHIID": ""}, {"SANNIDHIID": 1}, {"SANNIDHIID": 3}):
        assert not (ids(conn, ctx) & inactive)


def test_search_still_narrows_within_the_sannidhi(conn):
    got = lookups.resolve_lookup(conn, doc_id=SEVA_DOC, field_code="SVAID", ctx={"SANNIDHIID": 1}, search="DEEPA")
    assert got and all("DEEPA" in r["label"].upper() for r in got)
    assert {r["value"] for r in got} <= ids(conn, {"SANNIDHIID": 1})


def test_without_a_sannidhi_context_the_list_is_unchanged(conn):
    # other documents that pick a seva without a Sannidhi keep the designer's own list
    assert ids(conn, None) >= ids(conn, {"SANNIDHIID": 1})
