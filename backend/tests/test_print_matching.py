"""Each print option must open the EXACT .rpt it names - no lookalike, no prefix match (real DB for the second test)."""
from pathlib import Path

from sqlalchemy import text

from app.core.db import get_engine
from app.print import rpt_registry
from app.print.rpt_registry import find_rpt, normalize_rpt_name


def test_exact_name_wins_over_lookalikes(tmp_path, monkeypatch):
    for n in ("fmtSeva_3Inc.rpt", "fmtSeva_3Inc (2).rpt", "fmtHB.rpt", "fmtHB - Copy.rpt", "fmtGrpSeva_A4 .rpt", "fmtGrpSeva_A4.rpt"):
        (tmp_path / n).write_bytes(b"x")
    monkeypatch.setattr(rpt_registry, "_rpt_dir", lambda: tmp_path)
    assert Path(find_rpt("fmtSeva_3Inc.rpt")).name == "fmtSeva_3Inc.rpt"
    assert Path(find_rpt("FMTSEVA_3INC")).name == "fmtSeva_3Inc.rpt"  # case-insensitive, extension added when missing
    assert Path(find_rpt("  fmtHB.rpt ")).name == "fmtHB.rpt"  # only the ends are trimmed
    assert Path(find_rpt("fmtGrpSeva_A4 .rpt")).name == "fmtGrpSeva_A4 .rpt"  # the inner space is part of the name
    assert find_rpt("fmtSeva") is None and find_rpt("fmtHB - Copy (3).rpt") is None and find_rpt("") is None


def test_normalize():
    assert normalize_rpt_name(" fmtDon ") == "fmtDon.rpt" and normalize_rpt_name("fmtDon.RPT") == "fmtDon.RPT" and normalize_rpt_name(None) == ""


def test_every_utloption_row_resolves_to_its_own_file():
    with get_engine().connect() as c:
        rows = c.execute(text("SELECT DocID, OptionName, CrptFileName FROM UtlOption WHERE InActive IS NULL OR InActive <> 'Y'")).all()
    assert rows
    missing = []
    for doc_id, option, file in rows:
        found = find_rpt(file)
        if found is None:
            missing.append((doc_id, option, file))
        else:
            assert Path(found).name.lower() == normalize_rpt_name(file).lower(), (doc_id, option, file, found)
    assert not missing, f"print options whose .rpt is not in the RPT folder: {missing}"
