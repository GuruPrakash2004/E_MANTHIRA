"""
Concept understanding for "Ask the Data" (no model, no download).

People do not type the formal words: Tamil speakers say "சேவா ரிஜிஸ்டர் பண்ணாங்க" and "போன மாசம்", others type Tamil/Kannada in
Latin letters ("pona masam evlo seva"). This module reduces a question to *concepts* (seva, count, donor, ...) with a
lexicon of formal, colloquial and romanised surface forms in English / Tamil / Kannada / Malayalam / Telugu, and scores
templates by weighted concept overlap. Surface forms are matched as substrings for Indic scripts (they agglutinate:
"சேவைகளில்" still contains "சேவ") and as word prefixes for English. Longer surface forms are consumed first, so
"முன்பதிவு" (booking) is not also read as "பதிவு" (register).
"""
from __future__ import annotations

import re

# concept -> surface forms (lower-case). Add words here to teach the bot a new way of saying something.
LEX: dict[str, list[str]] = {
    "seva": ["seva", "sevai", "sevaa", "save", "sewa", "seba", "seeva", "சேவ", "ಸೇವ", "സേവ", "സേവന", "సేవ"],
    "donation": ["donation", "donate", "kanike", "kaanike", "nankodai", "நன்கொடை", "காணிக்கை", "ದೇಣಿಗೆ", "ಕಾಣಿಕೆ", "സംഭാവന", "കാണിക്ക", "విరాళ", "కానుక"],
    "donor": ["donor", "donated", "who donated", "தானம் செய்த", "நன்கொடையாளர்", "ದಾನಿ", "ദാതാവ്", "దాత"],
    "hall": ["hall", "mandapam", "mantapa", "மண்டப", "ಸಭಾಂಗಣ", "ಮಂಟಪ", "ഹാൾ", "മണ്ഡപ", "హాలు", "మండపం"],
    "booking": ["booking", "reserv", "முன்பதிவு", "ಬುಕಿಂಗ್", "ಕಾಯ್ದಿರಿಸ", "ബുക്കിംഗ്", "ബുക്ക്", "బుకింగ్", "రిజర్వ"],
    "total": ["total", "sum of", "மொத்த", "ಒಟ್ಟು", "ആകെ", "మొత్తం"],
    "amount": ["amount", "how much", "money", "rupees", "earned", "எவ்வளவு", "எவ்ளோ", "evvalavu", "ఎంత", "தொகை", "ரூபாய்", "ಮೊತ್ತ", "ಹಣ", "തുക", "പണം", "సొమ్ము", "డబ్బు"],
    "count": ["how many", "howmany", "count", "number of", "no. of", "no of", "registered", "register", "registration", "entered", "booked", "made",
              "created", "raised", "done", "issued", "purchased", "bought", "எத்தனை", "ரிஜிஸ்டர்", "பதிவான", "பதிவு", "பண்ண", "செய்த", "எண்ணிக்கை",
              "ಎಷ್ಟು", "ನೋಂದ", "ದಾಖಲ", "ಸಂಖ್ಯೆ", "എത്ര", "രജിസ്റ്റർ", "രേഖപ്പെടുത്ത", "എണ്ണം", "ఎన్ని", "రిజిస్టర్", "నమోదు", "సంఖ్య"],
    "highest": ["highest", "most", "maximum", "biggest", "largest", "max ", "அதிக", "ಅತಿ ಹೆಚ್ಚು", "ಹೆಚ್ಚು", "ഏറ്റവും കൂടുതൽ", "കൂടുതൽ", "అత్యధిక", "ఎక్కువ"],
    "top": ["top", "best", "முதல்", "முன்னணி", "ಅಗ್ರ", "മുൻനിര", "అగ్ర"],
    "devotee": ["customer", "devotee", "bhakta", "person", "who", "பக்தர்", "வாடிக்கையாளர்", "யார்", "ಭಕ್ತ", "ಗ್ರಾಹಕ", "ಯಾರು", "ഭക്ത", "ഉപഭോക്താ", "ആര്",
                "భక్త", "కస్టమర్", "ఎవరు"],
    "monthwise": ["month wise", "month-wise", "monthly", "per month", "by month", "trend", "மாதவாரி", "மாத வாரியாக", "ತಿಂಗಳವಾರು", "മാസം തിരിച്ച", "మాసవారీ", "నెలవారీ"],
    "daywise": ["day wise", "day-wise", "daily", "per day", "by day", "தினசரி", "தினம்", "ದಿನವಾರು", "ദിവസേന", "రోజువారీ"],
    "paymode": ["payment mode", "pay mode", "cash and online", "cash vs", "cash versus", "பணம் செலுத்தும் முறை", "ಪಾವತಿ ವಿಧಾನ", "പേയ്മെന്റ് രീതി", "చెల్లింపు విధానం"],
    "sannidhi": ["sannidhi", "sannidhanam", "சன்னிதி", "சந்நிதி", "ಸನ್ನಿಧಿ", "സന്നിധി", "సన్నిధి"],
    "nakshatra": ["nakshatra", "nakshatram", "star", "நட்சத்திர", "ನಕ್ಷತ್ರ", "നക്ഷത്ര", "నక్షత్ర"],
    "gothra": ["gothra", "gotra", "கோத்திர", "ಗೋತ್ರ", "ഗോത്ര", "గోత్ర"],
    "rashi": ["rashi", "raasi", "ராசி", "ರಾಶಿ", "രാശി", "రాశి"],
    "staff": ["user", "staff", "employee", "operator", "entered by", "பயனர்", "ஊழியர்", "ಬಳಕೆದಾರ", "ಸಿಬ್ಬಂದಿ", "ഉപയോക്താ", "ജീവനക്കാ", "వినియోగదారు", "సిబ్బంది"],
    "cancelled": ["cancel", "canceled", "ரத்து", "ರದ್ದು", "റദ്ദ", "రద్దు"],
    "unauth": ["unauthori", "not authori", "pending authori", "unapproved", "அங்கீகரிக்கப்படாத", "ಅಧಿಕೃತಗೊಳಿಸದ", "അംഗീകരിക്കാത്ത", "ఆమోదించని"],
    "upcoming": ["upcoming", "scheduled", "schedule", "to be performed", "coming up", "வரவிருக்கும்", "ಮುಂಬರುವ", "വരാനിരിക്കുന്ന", "రాబోయే"],
    "average": ["average", "avg", "mean", "சராசரி", "ಸರಾಸರಿ", "ശരാശരി", "సగటు"],
    "latest": ["latest", "recent", "newest", "last 10", "சமீபத்திய", "ಇತ್ತೀಚಿನ", "ഏറ്റവും പുതിയ", "ఇటీవలి"],
    "list": ["list", "பட்டியல்", "ಪಟ್ಟಿ", "പട്ടിക", "జాబితా"],
    "voucher": ["voucher", "வவுச்சர்", "ವೋಚರ್", "വൗച്ചർ", "వౌచర్"],
    "receipt": ["receipt", "ரசீது", "ರಸೀದಿ", "രസീത്", "రసీదు"],
    "payment": ["expense", "spend", "spent", "செலவு", "ಖರ್ಚು", "ചെലവ്", "ఖర్చు"],
    "advance": ["advance", "முன்பணம்", "ಮುಂಗಡ", "അഡ്വാൻസ്", "అడ్వాన్స్"],
    "balance": ["balance", "due", "pending", "outstanding", "நிலுவை", "ಬಾಕಿ", "ബാക്കി", "బాకీ"],
    "collection": ["collection", "collected", "revenue", "income", "வசூல்", "வருமானம்", "ಸಂಗ್ರಹ", "ಆದಾಯ", "പിരിവ്", "വരുമാനം", "వసూలు", "ఆదాయం"],
    "types": ["types", "type of", "kinds", "வகை", "ವಿಧ", "തരം", "రకాలు"],
    "occupancy": ["occupancy", "occupied", "days booked", "பயன்பாட்டு நாட்கள்", "ಬಳಕೆಯ ದಿನಗಳು", "ഉപയോഗ ദിവസങ്ങൾ", "వినియోగ రోజులు"],
    "rate": ["rate", "price", "cost", "fee", "விலை", "கட்டணம்", "ದರ", "ಬೆಲೆ", "നിരക്ക്", "വില", "రేటు", "ధర"],
    "single": ["single", "ஒரே", "ಒಂದೇ", "ഒറ്റ", "ఒకే"],
    "wise": ["wise", "வாரியாக", "ವಾರು", "തിരിച്ച്", "వారీగా"],
}
# multi-concept phrases: "which seva ..." means the seva *type*, "each seva", "most popular seva" likewise
MULTI: dict[str, set[str]] = {
    "which seva": {"seva", "types"}, "most popular seva": {"seva", "types", "highest"}, "each seva": {"seva", "types"}, "per seva": {"seva", "types"},
    "seva wise": {"seva", "types"}, "seva-wise": {"seva", "types"}, "ஒவ்வொரு சேவை": {"seva", "types"}, "எந்த சேவை": {"seva", "types"},
}
ALIAS = {"howmany": "count"}  # template specs use their own spelling of a few keys

from app.services import ask_nlu_extra as _x  # noqa: E402  (spoken / colloquial / Latin-typed vocabulary per language)

for _c, _forms in _x.EXTRA_LEX.items():
    LEX.setdefault(_c, []).extend(_forms)
MULTI.update(_x.EXTRA_MULTI)
from app.services import ask_nlu_extra2 as _x2  # noqa: E402  (second batch of concepts)

for _c, _forms in _x2.EXTRA_LEX.items():
    LEX.setdefault(_c, []).extend(_forms)
MULTI.update(_x2.EXTRA_MULTI)

_WEIGHT_HIGH = {"seva", "donation", "hall", "voucher", "receipt", "collection", "donor"} | _x2.HIGH_WEIGHT
_WEIGHT_LOW = {"wise", "total", "list"}


def weight(c: str) -> float:
    return 3.0 if c in _WEIGHT_HIGH else 1.0 if c in _WEIGHT_LOW else 2.0


def _pattern(s: str) -> re.Pattern:
    return re.compile((r"\b" if s[:1].isascii() and s[:1].isalnum() else "") + re.escape(s))


_SURFACES: list[tuple[re.Pattern, set[str]]] = sorted(
    [(_pattern(s), {c}) for c, ss in LEX.items() for s in ss] + [(_pattern(s), cs) for s, cs in MULTI.items()],
    key=lambda x: -len(x[0].pattern),
)


_ASCII_FORMS = [(s, c) for c, ss in LEX.items() for s in ss if s.isascii() and s.isalpha() and len(s) >= 5]


def _fuzzy(t: str, found: set[str]) -> None:
    """Typos: 'donatn', 'bookng', 'colection' -> the nearest English surface form (cutoff keeps real words apart)."""
    import difflib

    forms = [s for s, _ in _ASCII_FORMS]
    for w in re.findall(r"[a-z]{5,}", t):
        hit = difflib.get_close_matches(w, forms, n=1, cutoff=0.82)
        if hit:
            found.update(c for s, c in _ASCII_FORMS if s == hit[0])


def concepts(text: str) -> set[str]:
    """Concepts mentioned in `text`. Longest surface forms are consumed first so overlapping words are not double counted."""
    t = text.lower()
    found: set[str] = set()
    for pat, cs in _SURFACES:
        if pat.search(t):
            found |= cs
            t = pat.sub(" ", t)
    _fuzzy(t, found)
    return found


def spec_concepts(spec: str) -> set[str]:
    return {ALIAS.get(k, k) for k in spec.split() if ALIAS.get(k, k) in LEX}


def best_template(question_concepts: set[str], templates: list[dict]) -> tuple[dict | None, float]:
    """Weighted Dice overlap between the question's concepts and each template's concept specs."""
    if not question_concepts:
        return None, 0.0
    wq = sum(weight(c) for c in question_concepts)
    best, score = None, 0.0
    for t in templates:
        for spec in t.get("_specs", ()):
            if not spec:
                continue
            inter = sum(weight(c) for c in question_concepts & spec)
            if not inter:
                continue
            s = 2 * inter / (wq + sum(weight(c) for c in spec))
            if s > score + 1e-9:
                best, score = t, s
    return best, score


# colloquial / romanised period phrases, merged into ask_templates.PERIODS (stems: Indic words take suffixes)
COLLOQUIAL_PERIODS = {
    "last_month": ["கடந்த மாத", "போன மாத", "போன மாச", "கடந்த மாச", "முந்தைய மாத", "முந்தின மாச", "pona masam", "ponna masam", "pona madham", "kadantha madham",
                   "kadantha masam", "munthina masam", "ಹಿಂದಿನ ತಿಂಗಳ", "ಕಳೆದ ತಿಂಗಳ", "പോയ മാസ", "കഴിഞ്ഞ മാസ", "పోయిన నెల", "గత నెల"],
    "this_month": ["இந்த மாத", "இந்த மாச", "indha masam", "intha masam", "indha madham", "inda masam", "ಈ ತಿಂಗಳ", "ഈ മാസ", "ఈ నెల"],
    "next_month": ["அடுத்த மாத", "அடுத்த மாச", "adutha masam", "ಮುಂದಿನ ತಿಂಗಳ", "അടുത്ത മാസ", "వచ్చే నెల"],
    "last_fy": ["போன வருஷ", "போன வருட", "கடந்த வருட", "pona varusham", "pona varudam"],
    "this_fy": ["இந்த வருஷ", "இந்த வருட", "indha varusham", "intha varudam"],
    "today": ["இன்னைக்கு", "இன்னிக்கு", "இன்றைய", "innaiku", "innikku"],
    "yesterday": ["நேத்து", "நேற்றைய", "nethu", "netru"],
    "tomorrow": ["நாளைக்கு", "நாளைய", "naalaiku", "naalai"],
    "this_week": ["indha vaaram", "intha vaaram"],
    "next_week": ["adutha vaaram"],
}

for _k, _v in _x.EXTRA_PERIODS.items():
    COLLOQUIAL_PERIODS.setdefault(_k, []).extend(_v)
