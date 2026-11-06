"""
Date understanding for "Ask the Data" (no model): turns the time words in a question into a [from, to) range.

Handles: last/previous week, "last 7 days / 3 months", this/last quarter and Q1-Q4 (Indian financial-year quarters),
months ("in October", "march 2027"), single dates ("5 nov", "20/10/2026", "2026-10-20"), ranges ("1 oct to 15 oct",
"between 5/10 and 12/10"), and "since April". Dates are day-first (India). A month with no year is placed inside the
user's financial year (October -> Oct of the FY's first year, March -> March of its second year).
English, Tamil, Kannada, Malayalam, Telugu keywords. Everything returned is used only as BOUND parameters.
"""
from __future__ import annotations

import datetime as dt
import re

_INDIC = "஀-௿ఀ-౿ಀ-೿ഀ-ൿ"
_NOT_L = rf"(?<![A-Za-z{_INDIC}])"
_NOT_R = rf"(?![A-Za-z{_INDIC}])"

MONTHS: dict[int, list[str]] = {
    1: ["january", "jan", "ஜனவரி", "ಜನವರಿ", "ജനുവരി", "జనవరి"],
    2: ["february", "feb", "பிப்ரவரி", "ಫೆಬ್ರವರಿ", "ഫെബ്രുവരി", "ఫిబ్రవరి"],
    3: ["march", "mar", "மார்ச்", "ಮಾರ್ಚ್", "മാർച്ച്", "మార్చి"],
    4: ["april", "apr", "ஏப்ரல்", "ಏಪ್ರಿಲ್", "ഏപ്രിൽ", "ఏప్రిల్"],
    5: ["may", "மே", "ಮೇ", "മേയ്", "మే"],
    6: ["june", "jun", "ஜூன்", "ಜೂನ್", "ജൂൺ", "జూన్"],
    7: ["july", "jul", "ஜூலை", "ಜುಲೈ", "ಜೂಲೈ", "ജൂലൈ", "జూలై"],
    8: ["august", "aug", "ஆகஸ்ட்", "ಆಗಸ್ಟ್", "ഓഗസ്റ്റ്", "ఆగస్టు"],
    9: ["september", "sept", "sep", "செப்டம்பர்", "ಸೆಪ್ಟೆಂಬರ್", "സെപ്റ്റംബർ", "సెప్టెంబర్"],
    10: ["october", "oct", "அக்டோபர்", "ಅಕ್ಟೋಬರ್", "ഒക്ടോബർ", "అక్టోబర్"],
    11: ["november", "nov", "நவம்பர்", "ನವೆಂಬರ್", "നവംബർ", "నవంబర్"],
    12: ["december", "dec", "டிசம்பர்", "ಡಿಸೆಂಬರ್", "ഡിസംബർ", "డిసెంబర్"],
}
_MON_RE = re.compile(
    "(" + "|".join(sorted((f for fs in MONTHS.values() for f in fs), key=len, reverse=True)) + ")", re.I
)
_MON_NUM = {f: m for m, fs in MONTHS.items() for f in fs}

_LAST = r"(?:last|past|previous|in the last|within the last|கடந்த|போன|ಕಳೆದ|ಹೋದ|കഴിഞ്ഞ|പോയ|గత|పోయిన)"
_UNIT_DAY = r"(?:days?|நாட்கள்|நாள்|ದಿನಗಳ|ದಿನ|ദിവസങ്ങളിൽ|ദിവസ|రోజుల|రోజులు)"
_UNIT_WEEK = r"(?:weeks?|வாரங்கள்|வாரம்|ವಾರಗಳ|ವಾರ|ആഴ്ചകളിൽ|ആഴ്ച|వారాల|వారం)"
_UNIT_MONTH = r"(?:months?|மாதங்கள்|மாதம்|ತಿಂಗಳುಗಳ|ತಿಂಗಳು|മാസങ്ങളിൽ|മാസം|నెలల|నెల)"
RE_ROLL = re.compile(rf"{_LAST}\s*(\d{{1,3}})\s*({_UNIT_DAY}|{_UNIT_WEEK}|{_UNIT_MONTH})", re.I)
# "last week" = the previous calendar week (Mon-Sun); "past week" = the last 7 days
RE_LAST_WEEK = re.compile(
    r"\b(?:last|previous)\s+week\b|கடந்த வார|போன வார|ಕಳೆದ ವಾರ|ಹೋದ ವಾರ|കഴിഞ്ഞ ആഴ്ച|പോയ ആഴ്ച|గత వారం|పోయిన వారం|"
    r"kadantha vaaram|pona vaaram|kalede vara|kazhinja azhcha|gata vaaram", re.I)
RE_PAST_WEEK = re.compile(r"\bpast week\b", re.I)
RE_DAY_BEFORE = re.compile(r"day before yesterday|முந்தாநாள்|ಮೊನ್ನೆ|മിനിഞ്ഞാന്ന്|ఎల్లుండి నిన్న|మొన్న", re.I)
RE_QUARTER = re.compile(rf"\b(this|current|last|previous)\s+quarter\b|\bq([1-4])\b(?:\s*(20\d{{2}}))?", re.I)
RE_SINCE = re.compile(r"\b(?:since|from)\b|முதல்|ಇಂದ|മുതൽ|నుండి", re.I)
RE_RANGE_WORD = re.compile(r"\b(?:to|till|until|through|and)\b|[-–]|வரை|ವರೆಗೆ|വരെ|వరకు", re.I)

RE_ISO = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
RE_DMY = re.compile(r"(?<![\d/.\-])(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?![\d/])")
RE_DM = re.compile(r"(?<![\d/.\-])(\d{1,2})/(\d{1,2})(?![\d/])")
RE_YEAR = re.compile(r"^[\s,]*(20\d{2})\b")
RE_DAY_AFTER = re.compile(r"^[\s,]*(\d{1,2})(?:st|nd|rd|th)?(?!\d)")
RE_DAY_BEFORE_MON = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?$")


def _fy_start(today: dt.date, fy) -> dt.date:
    if fy:
        return fy[0]
    return dt.date(today.year if today.month >= 4 else today.year - 1, 4, 1)


def _month_start(y: int, m: int) -> dt.date:
    return dt.date(y, m, 1)


def _next_month(d: dt.date) -> dt.date:
    return dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def _add_months(d: dt.date, n: int) -> dt.date:
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return dt.date(y, m + 1, 1)


def _year_for(month: int, explicit: int | None, fy_start: dt.date) -> int:
    if explicit:
        return explicit
    return fy_start.year if month >= 4 else fy_start.year + 1


def _valid(y: int, m: int, d: int) -> dt.date | None:
    try:
        return dt.date(y, m, d)
    except ValueError:
        return None


def _items(q: str, fy_start: dt.date) -> list[tuple[int, int, dt.date, dt.date]]:
    """Dates and months mentioned in `q`: (span_start, span_end, from, to_exclusive), left to right, non-overlapping."""
    found: list[tuple[int, int, dt.date, dt.date]] = []
    taken: list[tuple[int, int]] = []

    def free(a: int, b: int) -> bool:
        return all(b <= x or a >= y for x, y in taken)

    def add(a: int, b: int, lo: dt.date, hi: dt.date) -> None:
        if free(a, b):
            taken.append((a, b))
            found.append((a, b, lo, hi))

    for m in RE_ISO.finditer(q):
        d = _valid(int(m[1]), int(m[2]), int(m[3]))
        if d:
            add(m.start(), m.end(), d, d + dt.timedelta(days=1))
    for m in RE_DMY.finditer(q):
        y = int(m[3]) + (2000 if int(m[3]) < 100 else 0)
        d = _valid(y, int(m[2]), int(m[1]))
        if d:
            add(m.start(), m.end(), d, d + dt.timedelta(days=1))
    for m in RE_DM.finditer(q):
        mo, dd = int(m[2]), int(m[1])
        d = _valid(_year_for(mo, None, fy_start), mo, dd) if 1 <= mo <= 12 else None
        if d:
            add(m.start(), m.end(), d, d + dt.timedelta(days=1))
    for m in _MON_RE.finditer(q):
        name = m[1].lower()
        a, b = m.start(), m.end()
        if not (not q[a - 1:a].isalpha() or a == 0) and name.isascii():
            continue
        if name.isascii() and (b < len(q) and q[b:b + 1].isalpha()):
            continue
        if not name.isascii() and (re.match(rf"[{_INDIC}]", q[b:b + 1] or " ") and name in ("மே", "ಮೇ", "మే")):
            continue  # a bare "May" must not be a prefix of a longer word
        if name == "may" and not re.search(r"(?:\b(?:in|of|for|during|since|from|till|until|to|on)\s+|\d\s*)$", q[:a]) and not re.match(r"\s*\d", q[b:]):
            continue  # the English verb "may"
        mo = _MON_NUM[name]
        y_m = RE_YEAR.match(q[b:])
        d_after = RE_DAY_AFTER.match(q[b:]) if not y_m else None
        d_before = RE_DAY_BEFORE_MON.search(q[:a])
        if d_before and 1 <= int(d_before[1]) <= 31:
            day = _valid(_year_for(mo, int(y_m[1]) if y_m else None, fy_start), mo, int(d_before[1]))
            if day:
                add(a - len(d_before[0]), b + (y_m.end() if y_m else 0), day, day + dt.timedelta(days=1))
                continue
        if d_after and 1 <= int(d_after[1]) <= 31:
            day = _valid(_year_for(mo, None, fy_start), mo, int(d_after[1]))
            if day:
                add(a, b + d_after.end(), day, day + dt.timedelta(days=1))
                continue
        first = _month_start(_year_for(mo, int(y_m[1]) if y_m else None, fy_start), mo)
        add(a, b + (y_m.end() if y_m else 0), first, _next_month(first))
    return sorted(found)


def _quarter_start(today: dt.date, fy_start: dt.date) -> dt.date:
    months_in = (today.year - fy_start.year) * 12 + today.month - fy_start.month
    return _add_months(fy_start, (months_in // 3) * 3)


def parse(question: str, today: dt.date | None = None, fy: tuple[dt.date, dt.date] | None = None) -> dict | None:
    """-> {'range': (from, to_exclusive), 'stripped': question without the date words} or None if no date words."""
    t = today or dt.date.today()
    fy0 = _fy_start(t, fy)
    q = question.lower()
    d1 = dt.timedelta(days=1)

    m = RE_ROLL.search(q)
    if m:
        n = int(m[1])
        unit = m[2].lower()
        if re.fullmatch(_UNIT_DAY, unit, re.I):
            lo = t - dt.timedelta(days=n - 1)
        elif re.fullmatch(_UNIT_WEEK, unit, re.I):
            lo = t - dt.timedelta(days=7 * n - 1)
        else:
            lo = _add_months(t.replace(day=1), -n).replace(day=min(t.day, 28))
        return {"range": (lo, t + d1), "stripped": (q[:m.start()] + " " + q[m.end():])}
    m = RE_LAST_WEEK.search(q)
    if m:
        mon = t - dt.timedelta(days=t.weekday()) - dt.timedelta(days=7)
        return {"range": (mon, mon + dt.timedelta(days=7)), "stripped": q[:m.start()] + " " + q[m.end():]}
    m = RE_PAST_WEEK.search(q)
    if m:
        return {"range": (t - dt.timedelta(days=6), t + d1), "stripped": q[:m.start()] + " " + q[m.end():]}
    m = RE_DAY_BEFORE.search(q)
    if m:
        return {"range": (t - 2 * d1, t - d1), "stripped": q[:m.start()] + " " + q[m.end():]}
    m = RE_QUARTER.search(q)
    if m:
        qs = _quarter_start(t, fy0)
        if m[2]:  # Q1..Q4 of the user's financial year (or the one starting in the given year)
            base = dt.date(int(m[3]), 4, 1) if m[3] else fy0
            lo = _add_months(base, (int(m[2]) - 1) * 3)
        elif m[1].lower() in ("last", "previous"):
            lo = _add_months(qs, -3)
        else:
            lo = qs
        return {"range": (lo, _add_months(lo, 3)), "stripped": q[:m.start()] + " " + q[m.end():]}

    items = _items(q, fy0)
    if not items:
        return None
    cut = [(a, b) for a, b, _, _ in items]
    between = lambda i: q[cut[i][1]:cut[i + 1][0]] if i + 1 < len(cut) else ""  # noqa: E731
    lo, hi = items[0][2], items[0][3]
    spans = [cut[0]]
    if len(items) >= 2 and RE_RANGE_WORD.search(between(0)):
        lo, hi = min(items[0][2], items[1][2]), max(items[0][3], items[1][3])
        spans.append(cut[1])
    elif RE_SINCE.search(q[:cut[0][0]][-12:]):
        hi = t + d1  # "since April": from then until today
    stripped, pos = [], 0
    for a, b in sorted(spans):
        stripped.append(q[pos:a])
        pos = b
    stripped.append(q[pos:])
    return {"range": (lo, hi), "stripped": " ".join(stripped)}
