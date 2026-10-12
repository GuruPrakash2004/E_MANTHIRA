"""
Dev-only stand-in for the real Crystal Reports print service — implements
the contract in README.md using Jinja2 + WeasyPrint instead of the genuine
Crystal runtime. See README.md for why this exists and what's missing.

Run: uvicorn mock_bridge:app --port 8100
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel
from weasyprint import HTML

app = FastAPI(title="vTemple mock print bridge (dev only)")

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "print_templates"
env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=select_autoescape())


class RenderRequest(BaseModel):
    rpt_path: str
    selection_formula: str = ""
    formula_values: dict[str, str] = {}
    record_data: dict = {}
    record_id: str
    format: str = "pdf"


class PrintRequest(RenderRequest):
    printer_name: str
    copies: float = 1


def _template_name_for(rpt_path: str) -> str:
    base = Path(rpt_path).stem  # "fmtSeva_3Inc.rpt" -> "fmtSeva_3Inc"
    name = f"{base}.html.j2"
    if not (TEMPLATES_DIR / name).exists():
        raise HTTPException(404, f"No HTML template for '{base}' yet — see print_service/README.md checklist")
    return name


def _render_html(req: RenderRequest) -> str:
    template = env.get_template(_template_name_for(req.rpt_path))
    # record_data (the actual saved row) wins over formula_values (company
    # letterhead fields) if a key ever collides — the record is more specific.
    context = {"record_id": req.record_id, "selection_formula": req.selection_formula, **req.formula_values, **req.record_data}
    return template.render(**context)


@app.post("/render")
def render(req: RenderRequest):
    html = _render_html(req)
    pdf_bytes = HTML(string=html).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf")


@app.post("/print")
def print_direct(req: PrintRequest):
    # No cross-platform way to reach a Windows printer driver from this mock;
    # just prove the pipeline renders correctly and report success.
    _render_html(req)
    return {"message": f"(mock) would have sent {req.copies} copy/copies to '{req.printer_name}'"}
