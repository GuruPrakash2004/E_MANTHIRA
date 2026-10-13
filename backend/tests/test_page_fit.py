"""page_fit: a custom roll page is cut at the end of its content, a named paper size is left alone (no DB needed)."""
import fitz

from app.print.page_fit import fit_pdf


def _pdf(width: float, height: float) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    page.insert_text((10, 30), "RECEIPT", fontsize=14)
    page.draw_line((10, 120), (width - 10, 120))  # last thing printed, 120 pt from the top
    data = doc.tobytes()
    doc.close()
    return data


def test_custom_roll_is_cut_below_the_content_with_the_report_margin():
    out, page = fit_pdf(_pdf(204, 842), paper_kind="Custom", bottom_margin_pt=10)
    assert page.cropped and page.width_pt == 204
    assert 125 <= page.height_pt <= 135  # 120 + hairline + 10 margin
    with fitz.open(stream=out, filetype="pdf") as doc:
        assert round(doc[0].rect.height) == round(page.height_pt)
        # the content is still on the page: a non-white pixel exists and the text is still there
        assert "RECEIPT" in doc[0].get_text()


def test_named_paper_is_returned_unchanged():
    src = _pdf(595, 842)
    out, page = fit_pdf(src, paper_kind="Named", bottom_margin_pt=10)
    assert out == src and not page.cropped and (page.width_pt, page.height_pt) == (595, 842)


def test_custom_page_already_tight_is_not_touched():
    src = _pdf(204, 130)
    out, page = fit_pdf(src, paper_kind="Custom", bottom_margin_pt=40)
    assert out == src and not page.cropped


def test_only_the_last_page_of_a_roll_is_cut():
    doc = fitz.open()
    doc.new_page(width=204, height=842).insert_text((10, 800), "page one", fontsize=12)
    doc.new_page(width=204, height=842).insert_text((10, 40), "page two", fontsize=12)
    out, page = fit_pdf(doc.tobytes(), paper_kind="Custom", bottom_margin_pt=5)
    with fitz.open(stream=out, filetype="pdf") as d:
        assert round(d[0].rect.height) == 842 and d[1].rect.height < 100
