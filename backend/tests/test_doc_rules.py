"""Pure tests (no database) for app/meta/doc_rules.py — the server-side Doc Designer rule engine. The rows below are
copied from real UtlDocDsgrFlds rows (vTempleNimishamba / vTempleThimmaraya)."""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.meta import doc_rules as dr


def row(**kw):
    base = {"FldCode": "X", "FldCaption": "X", "FldSection": "Header", "FldDataType": "Text", "FldDataWidth": 50,
            "FldBlnReadOnly": "N", "FLdBlnHide": "N", "FldBlnMandatory": "N", "FldUseDefault": "N", "FldDefStdDefault": "",
            "FldBlnComboData": "N", "FldCmbTblName": "", "FldNumStringListContent": "", "FldFormula": ""}
    base.update(kw)
    return base


# Seva CHQNO: hidden unless Payment = Cheque
CHQNO = row(FldCode="CHQNO", FLdBlnHide="Y", FldHideCompareVal="#PAYMENT#", FldHideOperator="<>", FldHideWithVal="Cheque")
# Donation CONTACTNO: mandatory when #PAYMNETMODE# (the Designer's typo) <> CASH
CONTACT = row(FldCode="CONTACTNO", FldCaption="Contact Number", FldBlnMandatory="Y", FldMndtryCompareVal="#PAYMNETMODE#", FldMndtryOperator="<>", FldMndtryWithVal="CASH")
PAYMODE = row(FldCode="PAYMNTMODE", FldCaption="Payment Mode", FldBlnMandatory="Y", FldDataType="List String",
              FldNumStringListContent="CASH|CARD|CHEQUE|UPI", FldUseDefault="Y", FldDefStdDefault="Cash")


def test_hide_condition():
    assert dr.is_hidden(CHQNO, {"PAYMENT": "CASH"}) is True
    assert dr.is_hidden(CHQNO, {"PAYMENT": "Cheque"}) is False
    assert dr.is_hidden(row(FLdBlnHide="Y"), {}) is True  # no condition = always hidden
    assert dr.is_hidden(row(), {}) is False


def test_mandatory_condition_and_typo_alias():
    assert dr.is_mandatory(CONTACT, {"PAYMNTMODE": "CASH"}) is False
    assert dr.is_mandatory(CONTACT, {"PAYMNTMODE": "UPI"}) is True
    assert dr.is_mandatory(row(FldBlnMandatory="Y"), {}) is True


def test_defaults_and_hidden_fields():
    rows = [PAYMODE, CHQNO, row(FldCode="PRASADA", FLdBlnHide="Y", FldUseDefault="Y", FldDefStdDefault="No")]
    out = dr.effective_values(rows, {"CHQNO": "123"})
    assert out["PAYMNTMODE"] == "Cash"            # static default fills a blank
    assert "CHQNO" not in out                      # hidden (payment is not Cheque) -> dropped
    assert out["PRASADA"] == "No"                  # hidden with a default still stores the default


def test_combo_default_left_to_the_screen():
    combo = row(FldCode="SANNIDHIID", FldBlnComboData="Y", FldCmbTblName="MstSANNIDHI", FldUseDefault="Y", FldDefStdDefault="Shri Nimishamba Sannidhi")
    assert "SANNIDHIID" not in dr.effective_values([combo], {})  # display text is not an id


def test_validate_messages():
    with pytest.raises(HTTPException) as e:
        dr.validate([PAYMODE], {})
    assert e.value.status_code == 422 and "Payment Mode is mandatory" in e.value.detail
    with pytest.raises(HTTPException) as e:
        dr.validate([PAYMODE], {"PAYMNTMODE": "BITCOIN"})
    assert "not one of" in e.value.detail
    dr.validate([PAYMODE], {"PAYMNTMODE": "upi"})  # case-insensitive list match
    with pytest.raises(HTTPException) as e:
        dr.validate([row(FldCode="REFNO", FldDataWidth=10)], {"REFNO": "x" * 11})
    assert "at most 10" in e.value.detail


def test_input_rules():
    digits = row(FldCode="MOB", FldTxtStringType="NUMBERS")
    with pytest.raises(HTTPException):
        dr.validate([digits], {"MOB": "98a"})
    dr.validate([digits], {"MOB": "98765"})
    amt = row(FldCode="AMT", FldDataType="Numeric", FldNumBlnAllowNegative="N")
    with pytest.raises(HTTPException) as e:
        dr.validate([amt], {"AMT": "-1"})
    assert "negative" in e.value.detail
    ranged = row(FldCode="PCT", FldDataType="Numeric", FldNumBlnAllowNegative="N", FldNumBlnRange="Y",
                 FldNumBlnRangeFromChk="Y", FldNumRangeFromOperator=">=", FldNumRangeFromValue="0",
                 FldNumBlnRangeToChk="Y", FldNumRangeToOperator="<=", FldNumRangeToValue="100")
    dr.validate([ranged], {"PCT": "50"})
    with pytest.raises(HTTPException):
        dr.validate([ranged], {"PCT": "150"})


def test_formulas_with_real_designer_rows():
    # HBE (DocID 1280) Total / Footer formulas
    rows = [
        row(FldCode="TOTAMT", FldSection="Total", FldBlnReadOnly="Y", FldFormula="SVTCOLSUM(#AMOUNT#)"),
        row(FldCode="CGST", FldSection="Total", FldFormula="#TOTAMT# * #CGSTPER# / 100"),
        row(FldCode="SGST", FldSection="Total", FldFormula="#TOTAMT# * #SGSTPER# / 100"),
        row(FldCode="TOTGSTAMT", FldSection="Total", FldBlnReadOnly="Y", FldFormula="#CGSTAMT#+#SGSTAMT#"),
        row(FldCode="AMTAFTTAX", FldSection="Total", FldBlnReadOnly="Y", FldFormula="#TOTAMT#  + #CGSTAMT#  + #SGSTAMT#"),
        row(FldCode="NETPAY", FldSection="Total", FldBlnReadOnly="Y", FldFormula="#AMTAFTTAX#"),
        row(FldCode="AMTINWORDS", FldSection="Footer", FldBlnReadOnly="Y", FldFormula="SVTAMTINWORDS(#NETPAY#)"),
        row(FldCode="ISSUEDBY", FldSection="Footer", FldBlnReadOnly="Y", FldFormula="#SVTUSERCODE#"),
        row(FldCode="CARDNO", FldSection="Footer", FldFormula="\\"),  # the Designer's "no formula" marker
    ]
    cols = dr.columns_from_lines([{"AMOUNT": "1000"}, {"AMOUNT": "500"}])
    names = {"CGSTAMT": "CGST", "SGSTAMT": "SGST"}
    out = dr.compute_formulas(rows, {"CGST": "9", "SGST": "9"}, cols, user_code="ADMIN", aliases=names)
    assert out["TOTAMT"] == Decimal(1500)
    assert out["TOTGSTAMT"] == Decimal(18) and out["NETPAY"] == Decimal(1518)  # typed CGST/SGST are kept
    assert out["AMTINWORDS"] == "Rupees One Thousand Five Hundred Eighteen Only"
    assert out["ISSUEDBY"] == "ADMIN" and "CARDNO" not in out
    # nothing typed: the editable GST fields fall back to their (zero) formula
    out2 = dr.compute_formulas(rows, {}, cols, user_code="ADMIN", aliases=names)
    assert out2["CGST"] == Decimal(0) and out2["NETPAY"] == Decimal(1500)
    merged = dr.apply_computed(rows, {"CGST": "9"}, out)
    assert merged["CGST"] == "9" and merged["NETPAY"] == Decimal(1518)  # read-only takes the formula, editable keeps typed


def test_voucher_total_formulas():
    rows = [
        row(FldCode="TOTDR", FldSection="Total", FldBlnReadOnly="Y", FldFormula="SVTCOLSUM(#DRAMT#)"),
        row(FldCode="TOTCR", FldSection="Total", FldBlnReadOnly="Y", FldFormula="SVTCOLSUM(5)"),
        row(FldCode="AMTINWORDS", FldSection="Footer", FldBlnReadOnly="Y", FldFormula="SVTAMTINWORDS(#TOTDR#)"),
    ]
    cols = {"DRAMT": ["100", "0"], "5": ["0", "100"]}
    out = dr.compute_formulas(rows, {}, cols)
    assert out["TOTDR"] == Decimal(100) and out["TOTCR"] == Decimal(100)
    assert out["AMTINWORDS"] == "Rupees One Hundred Only"
