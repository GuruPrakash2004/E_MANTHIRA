import json
import shutil
import subprocess
from decimal import Decimal
from pathlib import Path

import pytest

from app.utils.formulas import FormulaError, evaluate

VEC = Path(__file__).parent / "formula_vectors.json"
VECTORS = json.loads(VEC.read_text(encoding="utf-8"))


@pytest.mark.parametrize("v", VECTORS, ids=[v["f"] or "empty" for v in VECTORS])
def test_vector(v):
    if v.get("error"):
        with pytest.raises(FormulaError):
            evaluate(v["f"])
        return
    r = evaluate(v["f"], v["fields"], v["cols"])
    if isinstance(r, Decimal):
        assert r == Decimal(v["out"])
    else:
        assert r == v["out"]


def test_js_matches_vectors():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    root = Path(__file__).resolve().parents[2]
    js = root / "frontend" / "src" / "utils" / "formulas.js"
    runner = Path(__file__).parent / "formula_vectors_check.mjs"
    p = subprocess.run([node, str(runner), str(js), str(VEC)], capture_output=True, text=True)
    assert p.returncode == 0, p.stdout + p.stderr
