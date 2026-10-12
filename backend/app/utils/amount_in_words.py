"""
Line-by-line port of `svtModule.getAmtInWordsLakhs` / `GetTens` /
`GetHundreds` / `GetDigit` (vTemple7.exe, decompiled VB.NET), PLUS the
`removeSpaces()` clean-up that `svtModule.fnAmtInWords` applies.

Why both matter (verified against every distinct (amount, words) pair in
the real database — see tests/test_amount_in_words.py):

  - The raw algorithm has a genuine spacing bug: round tens/hundreds words
    ("Twenty ", "Five Hundred ") carry a trailing space that group
    separators (" Thousand ", " Lakhs ") or the final " Only" then double up
    on (e.g. "Rupees Five Hundred  Only").
  - The legacy app calls the raw function TWO different ways:
      1. Designer "Formula=SVTAMTINWORDS(...)" fields (Hall Booking,
         Donation, Payment/Receipt Voucher AMTINWORDS) go through
         `fnAmtInWords`, which pipes the result through `removeSpaces()`
         (collapses "  " -> " ") — these are clean in the real data.
      2. A few hard-coded INSERTs (`TrnHdrSEVA.AMTINWRDS`, and the
         auto-created `TrnHdrRCPTVCH.AmtInWords` written directly by the
         Seva/Donation/Hall save code) call `getAmtInWordsLakhs` directly,
         WITHOUT the clean-up — these keep the double-space bug in the DB
         today (confirmed, e.g. `TrnHdrSEVA.AMTINWRDS` for 350.00 is
         literally "Rupees Three Hundred Fifty  Only").

  This module always returns the CLEANED result (`removeSpaces` applied),
  i.e. it matches path (1) exactly and intentionally fixes the cosmetic
  double-space bug from path (2) rather than reproducing it. AMTINWRDS is a
  display-only column (never joined, filtered or summed), so this is a
  deliberate, documented, low-risk cosmetic deviation — not a parity break.
"""
from __future__ import annotations

_TEN_TO_NINETEEN = {
    10: "Ten", 11: "Eleven", 12: "Twelve", 13: "Thirteen", 14: "Fourteen",
    15: "Fifteen", 16: "Sixteen", 17: "Seventeen", 18: "Eighteen", 19: "Nineteen",
}
_TENS_WORD = {
    2: "Twenty ", 3: "Thirty ", 4: "Forty ", 5: "Fifty ",
    6: "Sixty ", 7: "Seventy ", 8: "Eighty ", 9: "Ninety ",
}
_DIGIT_WORD = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
    6: "Six", 7: "Seven", 8: "Eight", 9: "Nine",
}

_GROUP_SEPARATOR = {1: "", 2: " Thousand ", 3: " Lakhs ", 4: " Crores "}


def _get_digit(s: str) -> str:
    """Port of GetDigit: single character '1'-'9' -> word, else ''."""
    s = (s or "").strip()
    if not s.isdigit():
        return ""
    n = int(s)
    return _DIGIT_WORD.get(n, "")


def _get_tens(s: str) -> str:
    """Port of GetTens: a 1-2 char numeric string 1-99 -> words."""
    s = str(s)
    first_char = s[0] if s else "0"
    if first_char == "1" and len(s) >= 2:
        n = int(s)
        if n in _TEN_TO_NINETEEN:
            return _TEN_TO_NINETEEN[n]
        return ""
    tens_digit = int(first_char) if first_char.isdigit() else 0
    word = _TENS_WORD.get(tens_digit, "")
    ones_char = s[-1] if s else "0"
    return word + _get_digit(ones_char)


def _get_hundreds(my_number: str, loop_state: list[int]) -> str:
    """
    Port of GetHundreds. `loop_state` is a 1-item mutable box standing in for
    the legacy module-level `iLoop` static — only ever used within a single
    top-level call, reset at the start of each `amount_in_words()` call.
    """
    n = int(my_number) if str(my_number).strip() else 0
    if n == 0:
        return ""
    padded = str(n).rjust(3, "0")[-3:]
    left = ""
    if padded[0] != "0":
        if loop_state[0] > 0:
            left = _get_digit(padded[0]) + " Lac "
            loop_state[0] = 0
        else:
            left = _get_digit(padded[0]) + " Hundred "
            loop_state[0] += 1
    if padded[1] == "0":
        left += _get_digit(padded[2])
    else:
        left += _get_tens(padded[1:3])
    return left


def amount_in_words(amount: float, currency: str = "Rupees", sub_currency: str = "Paise") -> str:
    """Same call shape/behaviour as legacy `getAmtInWordsLakhs(amount, currency, sub_currency)`."""
    if amount is None:
        amount = 0.0
    negative = amount < 0
    value = abs(float(amount))
    if value > 999_999_999.99:
        return "Digit excced Maximum limit"

    # legacy formats the number with VB's `Str()` then trims — for our purposes
    # this is just "%f" trimmed of trailing zeros, matching how VB renders doubles.
    s = f"{value:.2f}"
    paise_words = ""
    if "." in s:
        int_part, frac_part = s.split(".")
        paise_words = _get_tens((frac_part + "00")[:2])
    else:
        int_part = s

    int_part = int_part.lstrip("0") or ""  # legacy: Strings.Trim after removing the decimal tail

    text = ""
    loop_state = [0]
    group = 1
    obj = int_part
    while obj != "":
        if group >= 2:
            num_str = obj[-2:]
        elif len(obj) == 2:
            num_str = obj[-2:]
        else:
            num_str = obj[-3:] if len(obj) != 1 else obj[-1:]
        num = int(num_str) if num_str.isdigit() and num_str != "" else 0

        if num > 99:
            num_str3 = obj[-3:]
            group_words = _get_hundreds(num_str3, loop_state)
        elif 9 < num <= 99:
            num_str2 = obj[-2:]
            group_words = _get_tens(num_str2)
        else:
            num_str2 = obj[-2:]
            group_words = _get_digit(num_str2[-1] if num_str2 else "")

        if group_words != "":
            text = group_words + _GROUP_SEPARATOR.get(group, "") + text

        if group == 2:
            obj = obj[:-2] if len(obj) != 1 else ""
        elif group == 3:
            obj = "" if len(obj) < 3 else obj[:-2]
        elif group == 4:
            obj = ""
        else:
            obj = obj[:-3] if len(obj) > 2 else ""
        group += 1

    if text == "":
        text = "-"
    elif text == "One":
        text = f"One {currency}"
    else:
        text = f"{currency} {text}"

    if paise_words == "":
        text2 = ""
    elif paise_words == "One":
        text2 = f" and One {sub_currency}"
    else:
        text2 = f" and {paise_words} {sub_currency}"

    prefix = "Minus " if negative else ""
    result = f"{prefix}{text}{text2} Only"
    return _remove_spaces(result)


def _remove_spaces(words: str) -> str:
    """Port of `svtModule.removeSpaces`: one global pass collapsing '  ' -> ' '."""
    return words.replace("  ", " ")
