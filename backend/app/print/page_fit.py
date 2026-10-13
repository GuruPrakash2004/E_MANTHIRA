"""
Page fitting for previews — the PDF the bridge exports is NEVER redrawn; only the page box can change.

A report saved on a Windows paper size that has a name (A4, Letter ...) is returned untouched: it keeps the paper and
orientation the .rpt itself declares. A report saved on a custom roll size (the 3-inch receipts) has a width but no real
height, so Crystal gives it the height of whatever printer the bridge PC happens to have (842 pt) and the preview ends
with a blank sheet under the receipt. For those the last page is cut at the end of the printed content, plus the
report's own bottom margin. The width and the top are never touched.
"""
from __future__ import annotations

from dataclasses import dataclass

import fitz  # PyMuPDF

_WHITE = 250  # grey level at or above which a pixel counts as paper
_ZOOM = 2  # 144 dpi scan for the content edge: a hairline rule is still found
_MIN_HEIGHT_PT = 36.0


@dataclass(frozen=True)
class Page:
    width_pt: float
    height_pt: float
    cropped: bool


def _content_bottom_pt(page: "fitz.Page") -> float | None:
    """Y (points from the top) of the lowest non-white pixel, or None for a blank page."""
    pix = page.get_pixmap(matrix=fitz.Matrix(_ZOOM, _ZOOM), colorspace=fitz.csGRAY, alpha=False)
    w, h, samples = pix.width, pix.height, pix.samples
    for y in range(h - 1, -1, -1):
        if min(samples[y * w : (y + 1) * w]) < _WHITE:
            return (y + 1) / _ZOOM
    return None


def fit_pdf(pdf: bytes, *, paper_kind: str, bottom_margin_pt: float = 0.0) -> tuple[bytes, Page]:
    """(pdf, page) - `page` is the size of the LAST page after fitting. Named paper sizes come back byte-for-byte."""
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        last = doc[-1]
        if paper_kind.strip().lower() != "custom":
            return pdf, Page(round(last.rect.width, 2), round(last.rect.height, 2), False)
        bottom = _content_bottom_pt(last)
        if bottom is None:
            return pdf, Page(round(last.rect.width, 2), round(last.rect.height, 2), False)
        height = min(last.rect.height, max(_MIN_HEIGHT_PT, bottom + max(0.0, bottom_margin_pt)))
        if height >= last.rect.height - 0.5:
            return pdf, Page(round(last.rect.width, 2), round(last.rect.height, 2), False)
        # PDF coordinates (origin bottom-left): keep the TOP of the page, drop the blank bottom. Both boxes are written on the
        # page itself, so a CropBox / MediaBox inherited from the page tree cannot override them.
        mb = last.mediabox
        top = mb.y1  # PyMuPDF reports the media box in PDF coordinates here
        pdf_box = f"[{mb.x0:g} {top - height:g} {mb.x1:g} {top:g}]"
        doc.xref_set_key(last.xref, "MediaBox", pdf_box)
        doc.xref_set_key(last.xref, "CropBox", pdf_box)
        last = doc.reload_page(last)
        box = last.rect
        return doc.tobytes(garbage=3, deflate=True), Page(round(box.width, 2), round(box.height, 2), True)
