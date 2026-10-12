"""
Golden test: our amount_in_words() must match (or be the documented cleaned
version of) every distinct (amount, words) pair actually stored in the
legacy database. See app/utils/amount_in_words.py's module docstring for
why two forms are both acceptable, and doc 09 for the one known pre-existing
data bug we deliberately do not try to reproduce.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.utils.amount_in_words import amount_in_words

QUERIES = [
    ("TrnHdrSEVA", "TotalAmt", "AMTINWRDS"),
    ("TrnHdrHB", "NETPAY", "AMTINWORDS"),
    ("TrnHdrDONREC", "TOTAMT", "AMTINWORDS"),
    ("TrnHdrRCPTVCH", "TOTCR", "AMTINWORDS"),
    ("TrnHdrPMTVCH", "TOTDR", "AMTINWORDS"),
]

# The one confirmed pre-existing data-integrity bug in the sample DB (a
# receipt whose amount was edited after its words were cached) — see doc 09.
KNOWN_DATA_BUGS = {("TrnHdrRCPTVCH", 8000.0, "Rupees Five Hundred Only")}


def test_amount_in_words_matches_real_data(conn):
    total = 0
    failures = []
    for table, amt_col, words_col in QUERIES:
        rows = conn.execute(
            text(f"SELECT DISTINCT {amt_col} amt, {words_col} words FROM {table} WHERE {words_col} IS NOT NULL AND {words_col} <> ''")
        ).mappings().all()
        for r in rows:
            total += 1
            amt = float(r["amt"])
            expected = r["words"]
            if (table, amt, expected) in KNOWN_DATA_BUGS:
                continue
            got = amount_in_words(amt, "Rupees", "Paise")
            if got != expected and got != expected.replace("  ", " "):
                failures.append(f"{table} amt={amt} expected={expected!r} got={got!r}")

    if total < 20:
        pytest.skip(
            f"only {total} distinct (amount, words) rows in this database — this golden test needs "
            "the legacy SQL Server dataset (~215 rows); on the fresh MySQL sample DB there isn't "
            "enough real data to be a meaningful check, so it's skipped rather than failing on a "
            "false negative."
        )
    assert not failures, "\n" + "\n".join(failures)
