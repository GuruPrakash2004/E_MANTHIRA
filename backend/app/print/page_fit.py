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


def _content_span_pt(page: "fitz.Page") -> tuple[float, float] | None:
    """(top, bottom) in points of the printed content on `page`, or None for a blank page."""
    pix = page.get_pixmap(matrix=fitz.Matrix(_ZOOM, _ZOOM), colorspace=fitz.csGRAY, alpha=False)
    w, h, samples = pix.width, pix.height, pix.samples
    rows = [y for y in range(h) if min(samples[y * w : (y + 1) * w]) < _WHITE]
    if not rows:
        return None
    return rows[0] / _ZOOM, (rows[-1] + 1) / _ZOOM


def _join_roll_pages(doc: "fitz.Document", bottom_margin_pt: float) -> tuple[bytes, Page]:
    """A roll receipt is one continuous strip. When the bridge PC's default printer is shorter than the receipt, Crystal splits
    it over several short pages; stack them back into one page (vector content, nothing redrawn), dropping each page's blank
    margins where the break fell."""
    slices: list[tuple["fitz.Page", float, float]] = []
    for i, page in enumerate(doc):
        span = _content_span_pt(page)
        if span is None:
            continue
        top = 0.0 if not slices else span[0]
        bottom = span[1] + (max(0.0, bottom_margin_pt) if i == len(doc) - 1 else 0.0)
        slices.append((page, top, min(page.rect.height, bottom)))
    if not slices:
        last = doc[-1]
        return doc.tobytes(), Page(round(last.rect.width, 2), round(last.rect.height, 2), False)
    width = slices[0][0].rect.width
    total = max(_MIN_HEIGHT_PT, sum(b - t for _, t, b in slices))
    out = fitz.open()
    target = out.new_page(width=width, height=total)
    y = 0.0
    for page, top, bottom in slices:
        h = bottom - top
        if h <= 0:
            continue
        target.show_pdf_page(fitz.Rect(0, y, width, y + h), doc, page.number, clip=fitz.Rect(0, top, width, bottom))
        y += h
    data = out.tobytes(garbage=3, deflate=True)
    out.close()
    return data, Page(round(width, 2), round(total, 2), True)


def _trim_width(pdf: bytes, right_pt: float) -> tuple[bytes, Page]:
    """The bridge gave a roll receipt a wider page so its right-most objects are not clipped; cut that page back to those
    objects (plus a hair of margin). Only the page box changes."""
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        for page in doc:
            mb = page.mediabox
            width = min(mb.width, right_pt + 2.0)
            box = f"[{mb.x0:g} {mb.y0:g} {mb.x0 + width:g} {mb.y1:g}]"
            doc.xref_set_key(page.xref, "MediaBox", box)
            doc.xref_set_key(page.xref, "CropBox", box)
        data = doc.tobytes(garbage=3, deflate=True)
    with fitz.open(stream=data, filetype="pdf") as out:
        return data, Page(round(out[-1].rect.width, 2), round(out[-1].rect.height, 2), True)


def fit_pdf(pdf: bytes, *, paper_kind: str, bottom_margin_pt: float = 0.0, widened_right_pt: float = 0.0) -> tuple[bytes, Page]:
    """(pdf, page) - `page` is the size of the LAST page after fitting. Named paper sizes come back byte-for-byte."""
    fitted, page = _fit_height(pdf, paper_kind=paper_kind, bottom_margin_pt=bottom_margin_pt)
    if widened_right_pt > 0 and paper_kind.strip().lower() == "custom":
        return _trim_width(fitted, widened_right_pt)
    return fitted, page


def _fit_height(pdf: bytes, *, paper_kind: str, bottom_margin_pt: float = 0.0) -> tuple[bytes, Page]:
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        last = doc[-1]
        if paper_kind.strip().lower() != "custom":
            return pdf, Page(round(last.rect.width, 2), round(last.rect.height, 2), False)
        if len(doc) > 1:
            return _join_roll_pages(doc, bottom_margin_pt)
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
