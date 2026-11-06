"""
Filters for "Ask the Data": the parts of a question that narrow an answer without changing its kind.

  "UPI sevas this month"            -> payment mode
  "donations above 10,000"          -> amount threshold ("above / over / more than / below / under", k / lakh / crore)
  "how many Archana sevas"          -> a seva / hall / sannidhi named in the question (looked up live in the DB)
  "sevas done by Ramesh Kumar"      -> a devotee / donor / contact name

Every value reaches the database only as a BOUND parameter. A filter is applied only to templates that declare which
column it maps to (TEMPLATE_FILTERS); the labels returned are shown to the user so a wrong guess is visible.
"""
from __future__ import annotations

import re

from app.services import ask_nlu

MODES: dict[str, list[str]] = {
    "CASH": ["cash", "ரொக்க", "ரொக்கம்", "கேஷ்", "ನಗದು", "ಕ್ಯಾಶ್", "ക്യാഷ്", "നാണയ", "నగదు", "క్యాష్"],
    "UPI": ["upi", "gpay", "google pay", "phonepe", "phone pe", "paytm", "யூபிஐ", "ಯುಪಿಐ", "യുപിഐ", "యూపీఐ"],
    "CARD": ["card", "debit", "credit", "கார்டு", "ಕಾರ್ಡ್", "കാർഡ്", "కార్డ్"],
    "CHEQUE": ["cheque", "check ", "dd ", "காசோலை", "ಚೆಕ್", "ചെക്ക്", "చెక్కు"],
    "BANK": ["bank", "neft", "rtgs", "வங்கி", "ಬ್ಯಾಂಕ್", "ബാങ്ക്", "బ్యాంక్"],
}
_MODE_RE = [(m, re.compile("|".join((r"\b" if f[:1].isascii() else "") + re.escape(f) for f in forms), re.I)) for m, forms in MODES.items()]

# column map per template: mode / amt (amount) / sva / san / hall / name
_SEVA = {"mode": "PAYMENT", "amt": "TotalAmt", "sva": "SVAID", "san": "SANNIDHIID", "name": "KNAME"}
_DON = {"mode": "PAYMNTMODE", "amt": "TOTAMT", "name": "DONOR"}
_HALL = {"mode": "PAYMNTMODE", "amt": "TOTAMT", "hall": "HALLID", "name": "CONPRS"}
_PMT = {"mode": "VCHTYP", "amt": "TOTDR"}
_RCPT = {"mode": "VCHTYP", "amt": "TOTCR"}
TEMPLATE_FILTERS: dict[str, dict[str, str]] = {
    **{i: _SEVA for i in ("seva_count", "seva_amount", "seva_avg", "seva_top1", "seva_top10", "seva_devotees", "seva_monthly", "seva_daily",
                          "seva_by_payment", "seva_latest", "seva_largest", "seva_payment_count", "seva_cancelled", "seva_unauth")},
    **{i: _DON for i in ("donation_total", "donation_count", "donation_avg", "donation_top", "donation_largest", "donation_monthly", "donation_daily",
                         "donation_by_payment", "donation_latest", "donation_cancelled")},
    **{i: _HALL for i in ("hall_count", "hall_amount", "hall_advance", "hall_balance", "hall_monthly", "hall_latest", "hall_functions", "hall_by_paymode")},
    **{i: _PMT for i in ("payment_vch_total", "payment_vch_count", "payment_vch_latest")},
    **{i: _RCPT for i in ("receipt_vch_total", "receipt_vch_count")},
    "collection_by_mode": {"mode": "m"},
}
MODE_ALIAS = {"payment_vch_total": {"CHEQUE": "BANK"}, "payment_vch_count": {"CHEQUE": "BANK"}, "payment_vch_latest": {"CHEQUE": "BANK"},
              "receipt_vch_total": {"CHEQUE": "BANK"}, "receipt_vch_count": {"CHEQUE": "BANK"}}
# with a person named, the master list of sevas is not what was meant: show that person's entries instead
MODE_REDIRECT = {"total_collection": "collection_by_mode"}  # "UPI collection today" = the UPI row of the split
NAME_REDIRECT = {"seva_list": "seva_latest", "seva_count_list": "seva_latest"}

_AMT_WORDS = {"k": 1_000, "thousand": 1_000, "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000, "crore": 10_000_000, "crores": 10_000_000}
_NUM = r"(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|crores?)?\b"
_ABOVE = re.compile(r"(?:above|over|more than|greater than|exceeding|at least|minimum|min|>=?|மேல்|ಮೇಲೆ|മുകളിൽ|పైన|அதிகமான)\s*" + _NUM, re.I)
_BELOW = re.compile(r"(?:below|under|less than|lesser than|at most|maximum|max|<=?|கீழ்|ಕೆಳಗೆ|താഴെ|కింద)\s*" + _NUM, re.I)

_NAME_STOP = {
    "the", "a", "an", "this", "that", "last", "next", "previous", "past", "all", "each", "every", "any", "me", "us", "you", "them", "him", "her", "it", "my", "our",
    "month", "week", "year", "day", "date", "today", "tomorrow", "yesterday", "user", "users", "staff", "mode", "type", "types", "name", "names", "amount", "total",
    "in", "on", "at", "during", "since", "till", "until", "to", "and", "or", "with", "from", "by", "of", "for", "than", "was", "were", "is", "are", "be", "been", "has",
    "have", "had", "did", "do", "does", "how", "many", "much", "what", "which", "who", "whom", "top", "highest", "latest", "recent", "most", "least", "quarter",
    "payment", "payments", "paid", "pay", "modes", "wise", "cash", "upi", "card", "cheque", "online", "bank", "ledger", "branch", "financial", "fy", "overall", "ever", "so", "far", "date", "between", "above", "below", "over", "under", "more", "less",
}
_NAME_AFTER = re.compile(r"\b(?:by|of|for|from|named|name|called|devotee|donor|customer|person|mr\.?|mrs\.?|ms\.?|shri|sri|smt)\s+([a-z][a-z.]*(?:\s+[a-z][a-z.]*){0,2})", re.I)
_MONTH_WORDS = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
                "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"}


def parse_mode(q: str) -> str | None:
    for mode, rx in _MODE_RE:
        if rx.search(q):
            return mode
    return None


def _amount(m: re.Match) -> float:
    n = float(m.group(1).replace(",", ""))
    return n * _AMT_WORDS.get((m.group(2) or "").lower(), 1)


def parse_amounts(q: str) -> tuple[float | None, float | None]:
    lo = _amount(m) if (m := _ABOVE.search(q)) else None
    hi = _amount(m) if (m := _BELOW.search(q)) else None
    return lo, hi


def match_catalog(q: str, items: list[tuple[int, str]]) -> tuple[int, str] | None:
    """The seva / hall / sannidhi whose name appears in the question (whole name, or every word of it); longest wins."""
    best, score = None, 0
    ql = q.lower()
    for ident, name in items:
        n = (name or "").strip().lower()
        if len(n) < 3:
            continue
        words = [w for w in re.findall(r"[^\W\d_]{4,}|[஀-ൿ]{3,}", n)]
        if n in ql:
            s = len(n) + 100
        elif words and all(w in ql for w in words):
            s = sum(len(w) for w in words)
        else:
            continue
        if s > score:
            best, score = (ident, name), s
    return best


def extract_name(q: str, taken: set[str]) -> str | None:
    """A person's name after 'by / of / for / from / named' (Latin script). Concept words, months, periods are never names."""
    for m in _NAME_AFTER.finditer(q):
        words = []
        for w in m.group(1).split():
            wl = w.lower().strip(".")
            if not wl or wl in _NAME_STOP or wl in _MONTH_WORDS or ask_nlu.concepts(wl) or wl in taken:
                break
            words.append(w.strip("."))
        if words and len("".join(words)) >= 3:
            return " ".join(words).title()
    return None


def extract(q: str, catalog: dict | None) -> dict:
    """Everything a question asks to narrow by (values + display labels). Applied only where a template supports it."""
    cat = catalog or {}
    found: dict = {}
    if (mode := parse_mode(q)):
        found["mode"] = mode
    lo, hi = parse_amounts(q)
    if lo is not None:
        found["amin"] = lo
    if hi is not None:
        found["amax"] = hi
    taken: set[str] = set()
    for key, listing in (("sva", cat.get("sevas")), ("hall", cat.get("halls")), ("san", cat.get("sannidhis"))):
        hit = match_catalog(q, listing or [])
        if hit:
            found[key] = hit
            taken |= {w.lower() for w in hit[1].split()}
    if (nm := extract_name(q, taken)):
        found["name"] = nm
    return found


def _inject(sql: str, extra: str) -> str:
    """Add `extra` (starting with ' AND ') to the WHERE clause: right before the first GROUP BY / ORDER BY, or at the end."""
    cut = [i for i in (sql.find(" GROUP BY "), sql.find(" ORDER BY ")) if i >= 0]
    at = min(cut) if cut else len(sql)
    return sql[:at] + extra + sql[at:]


def apply(template_id: str, sql: str, found: dict) -> tuple[str, dict, list[str]]:
    """-> (sql with filters, bound params, human labels of the filters that were actually applied)."""
    cols = TEMPLATE_FILTERS.get(template_id)
    if not cols or not found:
        return sql, {}, []
    parts, params, labels = [], {}, []
    if "mode" in found and "mode" in cols:
        val = MODE_ALIAS.get(template_id, {}).get(found["mode"], found["mode"])
        parts.append(f"UPPER({cols['mode']}) = :pm")
        params["pm"] = val
        labels.append(val.title() if val != "UPI" else "UPI")
    if "amin" in found and "amt" in cols:
        parts.append(f"{cols['amt']} >= :amin")
        params["amin"] = found["amin"]
        labels.append(f"≥ {found['amin']:,.0f}")
    if "amax" in found and "amt" in cols:
        parts.append(f"{cols['amt']} <= :amax")
        params["amax"] = found["amax"]
        labels.append(f"≤ {found['amax']:,.0f}")
    for key, pname in (("sva", "svaid"), ("hall", "hallid"), ("san", "sanid")):
        if key in found and key in cols:
            parts.append(f"{cols[key]} = :{pname}")
            params[pname] = found[key][0]
            labels.append(found[key][1])
    if "name" in found and "name" in cols:
        parts.append(f"{cols['name']} LIKE :nm")
        params["nm"] = f"%{found['name']}%"
        labels.append(found["name"])
    if not parts:
        return sql, {}, []
    return _inject(sql, " AND " + " AND ".join(parts)), params, labels
