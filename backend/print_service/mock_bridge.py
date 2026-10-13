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

try:  # WeasyPrint gives the best fidelity but needs the GTK/Pango runtime (awkward on Windows)
    from weasyprint import HTML as _WeasyHTML
except Exception:  # noqa: BLE001 - OSError when the native libraries are missing
    _WeasyHTML = None

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
    base = Path(rpt_path).stem.strip()  # "fmtSeva_3Inc.rpt" -> "fmtSeva_3Inc"; "fmtGrpSeva_A4 .rpt" -> "fmtGrpSeva_A4"
    # Copies / dated / per-client variants of a layout share its template ("fmtVCH - Copy", "fmtVCH_13062026", "fmtVCH - PMTVSLV")
    for candidate in (base, base.split(" - ")[0].strip(), base.split(" (")[0].strip(), base.rsplit("_", 1)[0] if base.rsplit("_", 1)[-1].isdigit() else base):
        if (TEMPLATES_DIR / f"{candidate}.html.j2").exists():
            base = candidate
            break
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


# A Unicode font with Kannada AND Latin glyphs for the PyMuPDF renderer (its built-in fonts are Latin only).
# (Baraha Kan in SQL_EXE is a legacy ASCII-mapped font, so it must not be used for Unicode text.)
_FONT_CANDIDATES = ["C:/Windows/Fonts/Nirmala.ttc", "C:/Windows/Fonts/Nirmala.ttf", "/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf"]


def _page_box(html: str):
    """Paper size + margin (points) from the template's own `@page { size: ...; margin: ... }`, which PyMuPDF's
    Story ignores. Supports named sizes (A4, A5, ...) and `<w>mm <h>mm`. Default A4 / 14mm."""
    import re

    import fitz

    mm = 72 / 25.4
    size = re.search(r"@page\s*\{[^}]*?size:\s*([^;}]+)", html)
    margin = re.search(r"@page\s*\{[^}]*?margin:\s*([\d.]+)mm", html)
    rect = fitz.paper_rect("a4")
    if size:
        spec = size.group(1).strip().lower()
        dims = re.findall(r"([\d.]+)mm", spec)
        if len(dims) == 2:
            rect = fitz.Rect(0, 0, float(dims[0]) * mm, float(dims[1]) * mm)
        else:
            rect = fitz.paper_rect(spec.split()[0]) if fitz.paper_size(spec.split()[0]) != (-1, -1) else rect
    return rect, (float(margin.group(1)) * mm if margin else 14 * mm)


def _html_to_pdf_pymupdf(html: str) -> bytes:
    """No-GTK fallback: PyMuPDF's HTML 'Story' layout (tables and basic CSS; no flex/grid)."""
    import io
    import tempfile

    import fitz  # PyMuPDF, already a backend dependency

    tmp = Path(tempfile.mkdtemp(prefix="vt-fonts-"))
    css = ""
    for f in [f for f in _FONT_CANDIDATES if Path(f).exists()][:1]:
        if f.lower().endswith(".ttc"):  # extract the first face (Nirmala UI) into a plain .ttf
            from fontTools.ttLib import TTCollection

            TTCollection(f).fonts[0].save(str(tmp / "kn.ttf"))
        else:
            (tmp / "kn.ttf").write_bytes(Path(f).read_bytes())
        css = '@font-face { font-family: "KN"; src: url(kn.ttf); } body, td, div, span, h1 { font-family: "KN", sans-serif; }'
    story = fitz.Story(html=html, user_css=css, archive=fitz.Archive(str(tmp)))
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    mediabox, margin = _page_box(html)
    where = mediabox + (margin, margin, -margin, -margin)
    more = 1
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    return buf.getvalue()


def html_to_pdf(html: str) -> bytes:
    if _WeasyHTML is not None:
        return _WeasyHTML(string=html).write_pdf()
    return _html_to_pdf_pymupdf(html)


@app.get("/health")
def health():
    return {"ok": True, "renderer": "weasyprint" if _WeasyHTML is not None else "pymupdf"}


@app.post("/render")
def render(req: RenderRequest):
    html = _render_html(req)
    pdf_bytes = html_to_pdf(html)
    return Response(content=pdf_bytes, media_type="application/pdf")


@app.post("/print")
def print_direct(req: PrintRequest):
    # No cross-platform way to reach a Windows printer driver from this mock;
    # just prove the pipeline renders correctly and report success.
    _render_html(req)
    return {"message": f"(mock) would have sent {req.copies} copy/copies to '{req.printer_name}'"}
