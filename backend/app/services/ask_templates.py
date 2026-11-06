"""
Retrieval-first answers for "Ask the Data": no model, no download, ~0 RAM.

A question is matched (character 3-gram TF-IDF cosine, works for every script) against a curated library of
question phrasings in English/Tamil/Kannada/Malayalam/Telugu. The best template supplies the SQL; the period is
detected by keyword and passed as BOUND parameters, never spliced into the SQL. With no period in the question the
answer covers the user's current financial year (the whole app filters by FY); "all time" / "overall" lifts that.
Questions below the match threshold get example questions instead of a guess (or the optional small model).

Indic phrasings are composed from a shared vocabulary (bag of words; order does not matter to the matcher), so a new
template only needs vocabulary keys. Table/column names are the real legacy ones; tests/test_ask_templates.py runs
every template against the live DB.
"""
from __future__ import annotations

import datetime as dt
import math
import re
from collections import Counter

THRESHOLD = 0.30
CONCEPT_MIN = 0.60  # weighted concept overlap needed to trust the lexicon match
LANGS = ("en", "ta", "kn", "ml", "te")

# --------------------------------------------------------------------------- periods
# key -> phrases (any language); first hit wins, so more specific phrases come first.
PERIODS: list[tuple[str, list[str]]] = [
    ("last_fy", ["last financial year", "previous financial year", "last fy", "last year", "previous year", "கடந்த நிதியாண்டு", "கடந்த ஆண்டு", "கடந்த வருடம்",
                 "ಕಳೆದ ಆರ್ಥಿಕ ವರ್ಷ", "ಕಳೆದ ವರ್ಷ", "കഴിഞ്ഞ സാമ്പത്തിക വർഷം", "കഴിഞ്ഞ വർഷം", "గత ఆర్థిక సంవత్సరం", "గత సంవత్సరం"]),
    ("this_fy", ["this financial year", "current financial year", "this fy", "this year", "current year", "இந்த நிதியாண்டு", "இந்த ஆண்டு", "இந்த வருடம்",
                 "ಈ ಆರ್ಥಿಕ ವರ್ಷ", "ಈ ವರ್ಷ", "ഈ സാമ്പത്തിക വർഷം", "ഈ വർഷം", "ఈ ఆర్థిక సంవత్సరం", "ఈ సంవత్సరం"]),
    ("all", ["all time", "overall", "till date", "to date", "so far", "ever", "எல்லா காலத்திலும்", "இதுவரை", "ಇಲ್ಲಿಯವರೆಗೆ", "ಎಲ್ಲಾ ಕಾಲ", "ഇതുവരെ", "ఇప్పటివరకు"]),
    ("last_month", ["last month", "previous month", "கடந்த மாதம்", "ಕಳೆದ ತಿಂಗಳು", "കഴിഞ്ഞ മാസം", "గత నెల"]),
    ("next_month", ["next month", "அடுத்த மாதம்", "ಮುಂದಿನ ತಿಂಗಳು", "അടുത്ത മാസം", "వచ్చే నెల"]),
    ("this_month", ["this month", "current month", "இந்த மாதம்", "ಈ ತಿಂಗಳು", "ഈ മാസം", "ఈ నెల"]),
    ("next_week", ["next week", "அடுத்த வாரம்", "ಮುಂದಿನ ವಾರ", "അടുത്ത ആഴ്ച", "వచ్చే వారం"]),
    ("this_week", ["this week", "இந்த வாரம்", "ಈ ವಾರ", "ഈ ആഴ്ച", "ఈ వారం"]),
    ("tomorrow", ["tomorrow", "நாளை", "ನಾಳೆ", "നാളെ", "రేపు"]),
    ("yesterday", ["yesterday", "நேற்று", "ನಿನ್ನೆ", "ഇന്നലെ", "నిన్న"]),
    ("today", ["today", "இன்று", "ಇಂದು", "ഇന്ന്", "ఈరోజు", "ఈ రోజు"]),
]

from app.services import ask_dates, ask_nlu  # noqa: E402  (date parser, concept lexicon + colloquial phrases)

for _key, _extra in ask_nlu.COLLOQUIAL_PERIODS.items():
    next(words for k, words in PERIODS if k == _key).extend(_extra)

PERIOD_LABELS = {
    "en": {"all": "All time", "today": "Today", "yesterday": "Yesterday", "tomorrow": "Tomorrow", "this_week": "This week", "next_week": "Next week",
           "this_month": "This month", "last_month": "Last month", "next_month": "Next month", "this_fy": "This financial year", "last_fy": "Last financial year", "upcoming": "Upcoming"},
    "ta": {"all": "எல்லா காலமும்", "today": "இன்று", "yesterday": "நேற்று", "tomorrow": "நாளை", "this_week": "இந்த வாரம்", "next_week": "அடுத்த வாரம்",
           "this_month": "இந்த மாதம்", "last_month": "கடந்த மாதம்", "next_month": "அடுத்த மாதம்", "this_fy": "இந்த நிதியாண்டு", "last_fy": "கடந்த நிதியாண்டு", "upcoming": "வரவிருக்கும்"},
    "kn": {"all": "ಎಲ್ಲಾ ಕಾಲ", "today": "ಇಂದು", "yesterday": "ನಿನ್ನೆ", "tomorrow": "ನಾಳೆ", "this_week": "ಈ ವಾರ", "next_week": "ಮುಂದಿನ ವಾರ",
           "this_month": "ಈ ತಿಂಗಳು", "last_month": "ಕಳೆದ ತಿಂಗಳು", "next_month": "ಮುಂದಿನ ತಿಂಗಳು", "this_fy": "ಈ ಆರ್ಥಿಕ ವರ್ಷ", "last_fy": "ಕಳೆದ ಆರ್ಥಿಕ ವರ್ಷ", "upcoming": "ಮುಂಬರುವ"},
    "ml": {"all": "എല്ലാ കാലവും", "today": "ഇന്ന്", "yesterday": "ഇന്നലെ", "tomorrow": "നാളെ", "this_week": "ഈ ആഴ്ച", "next_week": "അടുത്ത ആഴ്ച",
           "this_month": "ഈ മാസം", "last_month": "കഴിഞ്ഞ മാസം", "next_month": "അടുത്ത മാസം", "this_fy": "ഈ സാമ്പത്തിക വർഷം", "last_fy": "കഴിഞ്ഞ സാമ്പത്തിക വർഷം", "upcoming": "വരാനിരിക്കുന്ന"},
    "te": {"all": "ఇప్పటివరకు", "today": "ఈరోజు", "yesterday": "నిన్న", "tomorrow": "రేపు", "this_week": "ఈ వారం", "next_week": "వచ్చే వారం",
           "this_month": "ఈ నెల", "last_month": "గత నెల", "next_month": "వచ్చే నెల", "this_fy": "ఈ ఆర్థిక సంవత్సరం", "last_fy": "గత ఆర్థిక సంవత్సరం", "upcoming": "రాబోయే"},
}


def period_range(key: str | None, today: dt.date | None = None, fy: tuple[dt.date, dt.date] | None = None) -> tuple[dt.date, dt.date] | None:
    """[from, to) for a period key; None = no date filter. `fy` = the user's financial year (start, end inclusive)."""
    t = today or dt.date.today()
    d = dt.timedelta
    if key in (None, "all"):
        return None
    if key == "today":
        return t, t + d(days=1)
    if key == "yesterday":
        return t - d(days=1), t
    if key == "tomorrow":
        return t + d(days=1), t + d(days=2)
    if key in ("this_week", "next_week"):
        mon = t - d(days=t.weekday()) + (d(days=7) if key == "next_week" else d(0))
        return mon, mon + d(days=7)
    if key in ("this_month", "next_month"):
        a = t.replace(day=1)
        if key == "next_month":
            a = (a + d(days=32)).replace(day=1)
        return a, (a + d(days=32)).replace(day=1)
    if key == "last_month":
        b = t.replace(day=1)
        return (b - d(days=1)).replace(day=1), b
    if fy is None:  # calendar fallback when no FY is configured
        fy = (dt.date(t.year if t.month >= 4 else t.year - 1, 4, 1), dt.date(t.year + 1 if t.month >= 4 else t.year, 3, 31))
    if key == "this_fy":
        return fy[0], fy[1] + d(days=1)
    if key == "last_fy":
        return fy[0].replace(year=fy[0].year - 1), fy[0]
    if key == "upcoming":
        return t, max(fy[1], t) + d(days=1)
    return None


def detect_period(question: str) -> tuple[str | None, str]:
    """Return (period key or None, the question with the period words removed)."""
    q = question.lower()
    for key, words in PERIODS:
        for w in words:
            if w in q:
                return key, q.replace(w, " ")
    return None, q


# --------------------------------------------------------------------------- vocabulary (en, ta, kn, ml, te)
V = {
    "seva": ("seva", "சேவை", "ಸೇವೆ", "സേവ", "సేవ"),
    "donation": ("donation", "நன்கொடை", "ದೇಣಿಗೆ", "സംഭാവന", "విరాళం"),
    "hall": ("hall", "மண்டபம்", "ಸಭಾಂಗಣ", "ഹാൾ", "హాలు"),
    "booking": ("booking", "முன்பதிவு", "ಬುಕಿಂಗ್", "ബുക്കിംഗ്", "బుకింగ్"),
    "total": ("total", "மொத்தம்", "ಒಟ್ಟು", "ആകെ", "మొత్తం"),
    "amount": ("amount", "தொகை", "ಮೊತ್ತ", "തുക", "సొమ్ము"),
    "howmany": ("how many", "எத்தனை", "ಎಷ್ಟು", "എത്ര", "ఎన్ని"),
    "count": ("number count", "எண்ணிக்கை", "ಸಂಖ್ಯೆ", "എണ്ണം", "సంఖ్య"),
    "highest": ("highest most", "அதிக", "ಅತಿ ಹೆಚ್ಚು", "ഏറ്റവും കൂടുതൽ", "అత్యధిక"),
    "top": ("top", "முதல்", "ಅಗ್ರ", "മുൻനിര", "అగ్ర"),
    "devotee": ("customer devotee", "பக்தர்", "ಭಕ್ತರು", "ഭക്തൻ", "భక్తుడు"),
    "donor": ("donor", "நன்கொடையாளர்", "ದಾನಿ", "ദാതാവ്", "దాత"),
    "monthwise": ("month wise monthly", "மாதவாரி", "ತಿಂಗಳವಾರು", "മാസം തിരിച്ചുള്ള", "నెలవారీ"),
    "daywise": ("day wise daily", "தினசரி", "ದಿನವಾರು", "ദിവസേന", "రోజువారీ"),
    "paymode": ("payment mode", "பணம் செலுத்தும் முறை", "ಪಾವತಿ ವಿಧಾನ", "പേയ്മെന്റ് രീതി", "చెల్లింపు విధానం"),
    "sannidhi": ("sannidhi", "சன்னிதி", "ಸನ್ನಿಧಿ", "സന്നിധി", "సన్నిధి"),
    "nakshatra": ("nakshatra star", "நட்சத்திரம்", "ನಕ್ಷತ್ರ", "നക്ഷത്രം", "నక్షత్రం"),
    "gothra": ("gothra", "கோத்திரம்", "ಗೋತ್ರ", "ഗോത്രം", "గోత్రం"),
    "rashi": ("rashi", "ராசி", "ರಾಶಿ", "രാശി", "రాశి"),
    "staff": ("user staff entered by", "பயனர் உள்ளிட்டவர்", "ಬಳಕೆದಾರ ನಮೂದಿಸಿದವರು", "ഉപയോക്താവ് നൽകിയത്", "వినియోగదారు నమోదు చేసినవారు"),
    "cancelled": ("cancelled", "ரத்து", "ರದ್ದು", "റദ്ദാക്കിയ", "రద్దు"),
    "unauth": ("pending unauthorised", "அங்கீகரிக்கப்படாத", "ಅಧಿಕೃತಗೊಳಿಸದ", "അംഗീകരിക്കാത്ത", "ఆమోదించని"),
    "upcoming": ("upcoming scheduled", "வரவிருக்கும்", "ಮುಂಬರುವ", "വരാനിരിക്കുന്ന", "రాబోయే"),
    "average": ("average", "சராசரி", "ಸರಾಸರಿ", "ശരാശരി", "సగటు"),
    "latest": ("latest recent", "சமீபத்திய", "ಇತ್ತೀಚಿನ", "ഏറ്റവും പുതിയ", "ఇటీవలి"),
    "list": ("list show", "பட்டியல்", "ಪಟ್ಟಿ", "പട്ടിക", "జాబితా"),
    "voucher": ("voucher", "வவுச்சர்", "ವೋಚರ್", "വൗച്ചർ", "వౌచర్"),
    "receipt": ("receipt income", "ரசீது", "ರಸೀದಿ", "രസീത്", "రసీదు"),
    "payment": ("payment expense paid", "செலவு", "ಖರ್ಚು", "ചെലവ്", "ఖర్చు"),
    "advance": ("advance", "முன்பணம்", "ಮುಂಗಡ", "അഡ്വാൻസ്", "అడ్వాన్స్"),
    "balance": ("balance due pending", "நிலுவைத் தொகை", "ಬಾಕಿ ಮೊತ್ತ", "ബാക്കി തുക", "బాకీ"),
    "wise": ("wise by", "வாரியாக", "ವಾರು", "തിരിച്ച്", "వారీగా"),
    "collection": ("collection revenue", "வசூல்", "ಸಂಗ್ರಹ", "പിരിവ്", "వసూలు"),
    "types": ("types names kinds", "வகைகள்", "ವಿಧಗಳು", "തരങ്ങൾ", "రకాలు"),
    "occupancy": ("occupancy days booked", "பயன்பாட்டு நாட்கள்", "ಬಳಕೆಯ ದಿನಗಳು", "ഉപയോഗ ദിവസങ്ങൾ", "వినియోగ రోజులు"),
}


def _compose(spec: str) -> list[str]:
    keys = spec.split()
    return [" ".join(V[k][i] if k in V else k for k in keys) for i in range(len(LANGS))]  # unknown key = literal word


# Each template: id, sql ({W} = date filter on `col`, {W:expr} = on expr; bound params :d1/:d2 only),
# col, default period, `v` = vocabulary specs (all languages), `en` = natural English phrasings,
# `native` = natural sentences in other languages.
OK = "Cancelled = 'N'"
T: list[dict] = [
    # ---- sevas
    dict(id="seva_count", col="SEVADate", sql=f"SELECT COUNT(*) AS total_sevas FROM TrnHdrSEVA WHERE {OK} {{W}}",
         v=["seva howmany", "seva total count", "seva count"], en=["how many sevas were created", "total number of sevas created", "count of seva entries"],
         native=["மொத்த சேவைகள் எத்தனை", "ಒಟ್ಟು ಸೇವೆಗಳು ಎಷ್ಟು", "ആകെ സേവകൾ എത്ര", "మొత్తం సేవలు ఎన్ని"]),
    dict(id="seva_amount", col="SEVADate", sql=f"SELECT SUM(TotalAmt) AS total_seva_amount FROM TrnHdrSEVA WHERE {OK} {{W}}",
         v=["seva total amount", "seva collection", "seva collection amount"], en=["how much was collected from sevas", "total seva income"]),
    dict(id="seva_avg", col="SEVADate", sql=f"SELECT AVG(TotalAmt) AS average_seva_amount FROM TrnHdrSEVA WHERE {OK} {{W}}",
         v=["seva average amount"], en=["average seva amount", "what is the average seva value"]),
    dict(id="seva_top1", col="SEVADate", sql=f"SELECT TOP 1 KNAME AS customer, SUM(TotalAmt) AS total_amount FROM TrnHdrSEVA WHERE {OK} AND KNAME IS NOT NULL {{W}} GROUP BY KNAME ORDER BY SUM(TotalAmt) DESC",
         v=["highest devotee seva amount", "devotee seva highest"], en=["which customer purchased seva for the highest amount", "who paid the highest seva amount", "top devotee by seva amount"],
         native=["அதிக தொகைக்கு சேவை செய்த பக்தர் யார்", "ಅತಿ ಹೆಚ್ಚು ಮೊತ್ತದ ಸೇವೆ ಮಾಡಿದ ಭಕ್ತರು ಯಾರು", "ഏറ്റവും കൂടുതൽ തുകയ്ക്ക് സേവ ചെയ്ത ഭക്തൻ ആര്", "అత్యధిక మొత్తానికి సేవ చేసిన భక్తుడు ఎవరు"]),
    dict(id="seva_top10", col="SEVADate", sql=f"SELECT TOP 10 KNAME AS customer, SUM(TotalAmt) AS total_amount FROM TrnHdrSEVA WHERE {OK} AND KNAME IS NOT NULL {{W}} GROUP BY KNAME ORDER BY SUM(TotalAmt) DESC",
         v=["top devotee seva", "top devotee seva list"], en=["top 10 customers by seva amount", "list top devotees by seva", "highest paying customers for sevas"]),
    dict(id="seva_devotees", col="SEVADate", sql=f"SELECT COUNT(DISTINCT KNAME) AS devotees FROM TrnHdrSEVA WHERE {OK} AND KNAME IS NOT NULL {{W}}",
         v=["devotee howmany seva", "devotee count seva"], en=["how many different devotees did sevas", "number of unique customers"]),
    dict(id="seva_monthly", col="SEVADate", sql=f"SELECT CONVERT(char(7), SEVADate, 120) AS month, SUM(TotalAmt) AS amount FROM TrnHdrSEVA WHERE {OK} {{W}} GROUP BY CONVERT(char(7), SEVADate, 120) ORDER BY 1",
         v=["monthwise seva amount", "monthwise seva collection", "seva monthwise"], en=["seva trend by month", "monthly seva collection"]),
    dict(id="seva_daily", col="SEVADate", sql=f"SELECT CONVERT(char(10), SEVADate, 120) AS day, SUM(TotalAmt) AS amount FROM TrnHdrSEVA WHERE {OK} {{W}} GROUP BY CONVERT(char(10), SEVADate, 120) ORDER BY 1",
         v=["daywise seva amount", "daywise seva collection"], en=["daily seva collection", "seva amount per day"]),
    dict(id="seva_by_payment", col="SEVADate", sql=f"SELECT PAYMENT AS payment_mode, SUM(TotalAmt) AS amount FROM TrnHdrSEVA WHERE {OK} AND PAYMENT IS NOT NULL {{W}} GROUP BY PAYMENT ORDER BY 2 DESC",
         v=["seva paymode wise amount", "paymode seva"], en=["cash and online split of sevas", "payment mode wise sevas"]),
    dict(id="seva_type_amount", col="SEVADate", sql=f"SELECT TOP 15 s.SVANAME AS seva, SUM(h.TotalAmt) AS amount FROM TrnHdrSEVA h JOIN MstSVA s ON s.SVAID = h.SVAID WHERE h.{OK} {{W}} GROUP BY s.SVANAME ORDER BY SUM(h.TotalAmt) DESC",
         v=["seva types wise amount", "seva types wise collection", "highest seva types amount"], en=["which seva earned the most", "seva wise collection", "revenue by seva type"]),
    dict(id="seva_type_count", col="SEVADate", sql=f"SELECT TOP 15 s.SVANAME AS seva, COUNT(*) AS bookings FROM TrnHdrSEVA h JOIN MstSVA s ON s.SVAID = h.SVAID WHERE h.{OK} {{W}} GROUP BY s.SVANAME ORDER BY COUNT(*) DESC",
         v=["seva types wise count", "highest seva types count", "highest seva types booking"], en=["which seva is booked the most", "most popular seva", "seva wise number of bookings"]),
    dict(id="seva_sannidhi", col="SEVADate", sql=f"SELECT n.SANNIDHINAME AS sannidhi, SUM(h.TotalAmt) AS amount FROM TrnHdrSEVA h JOIN MstSANNIDHI n ON n.SANNIDHIID = h.SANNIDHIID WHERE h.{OK} {{W}} GROUP BY n.SANNIDHINAME ORDER BY SUM(h.TotalAmt) DESC",
         v=["sannidhi wise seva amount", "sannidhi wise seva collection", "seva sannidhi wise"], en=["sannidhi wise seva collection", "seva amount by sannidhi"]),
    dict(id="seva_nakshatra", col="SEVADate", sql=f"SELECT TOP 27 n.NAKSHATRANAME AS nakshatra, COUNT(*) AS sevas FROM TrnHdrSEVA h JOIN MstNAKSHATRA n ON n.NAKSHATRAID = h.NAKSHATRAID WHERE h.{OK} {{W}} GROUP BY n.NAKSHATRANAME ORDER BY COUNT(*) DESC",
         v=["nakshatra wise seva count", "highest nakshatra seva"], en=["which nakshatra has the most sevas", "nakshatra wise sevas"]),
    dict(id="seva_gothra", col="SEVADate", sql=f"SELECT TOP 10 g.GOTHRANAME AS gothra, COUNT(*) AS sevas FROM TrnHdrSEVA h JOIN MstGOTHRA g ON g.GOTHRAID = h.GOTHRAID WHERE h.{OK} {{W}} GROUP BY g.GOTHRANAME ORDER BY COUNT(*) DESC",
         v=["gothra wise seva count", "highest gothra seva"], en=["which gothra has the most sevas", "gothra wise sevas"]),
    dict(id="seva_rashi", col="SEVADate", sql=f"SELECT r.RASHINAME AS rashi, COUNT(*) AS sevas FROM TrnHdrSEVA h JOIN MstRASHI r ON r.RASHIID = h.RASHIID WHERE h.{OK} {{W}} GROUP BY r.RASHINAME ORDER BY COUNT(*) DESC",
         v=["rashi wise seva count", "highest rashi seva"], en=["which rashi has the most sevas", "rashi wise sevas"]),
    dict(id="seva_by_user", col="SEVADate", sql=f"SELECT AddedBy AS user_name, COUNT(*) AS entries FROM TrnHdrSEVA WHERE {OK} AND AddedBy IS NOT NULL {{W}} GROUP BY AddedBy ORDER BY COUNT(*) DESC",
         v=["staff seva count wise", "highest staff seva"], en=["which user entered the most sevas", "seva entries by user"]),
    dict(id="seva_cancelled", col="SEVADate", sql="SELECT COUNT(*) AS cancelled_sevas FROM TrnHdrSEVA WHERE Cancelled = 'Y' {W}",
         v=["cancelled seva howmany", "cancelled seva count"], en=["how many sevas were cancelled", "number of cancelled seva entries"]),
    dict(id="seva_unauth", col="SEVADate", sql=f"SELECT COUNT(*) AS unauthorised_sevas FROM TrnHdrSEVA WHERE {OK} AND ISNULL(Authorised, 'N') <> 'Y' {{W}}",
         v=["unauth seva howmany", "unauth seva count"], en=["how many sevas are not authorised", "pending authorisation sevas"]),
    dict(id="seva_latest", col="SEVADate", sql=f"SELECT TOP 10 PrintSEVANO AS seva_no, SEVADate AS seva_date, KNAME AS customer, TotalAmt AS amount FROM TrnHdrSEVA WHERE {OK} {{W}} ORDER BY SEVAID DESC",
         v=["latest seva list", "latest seva"], en=["show the latest seva entries", "recent sevas", "last 10 sevas"]),
    dict(id="seva_upcoming", col=None, default="upcoming",
         sql=f"SELECT CONVERT(char(10), d.PDate, 120) AS day, COUNT(*) AS sevas FROM TrnDtlSevaDates d JOIN TrnHdrSEVA h ON h.SEVAID = d.SevaID WHERE h.{OK} {{W:d.PDate}} GROUP BY CONVERT(char(10), d.PDate, 120) ORDER BY 1",
         v=["upcoming seva daywise", "upcoming seva howmany"], en=["how many sevas are scheduled", "sevas scheduled for tomorrow", "sevas to be performed this week", "upcoming sevas"]),
    dict(id="seva_schedule_list", col=None, default="upcoming",
         sql=f"SELECT TOP 100 CONVERT(char(10), d.PDate, 120) AS day, s.SVANAME AS seva, h.KNAME AS customer FROM TrnDtlSevaDates d JOIN TrnHdrSEVA h ON h.SEVAID = d.SevaID JOIN MstSVA s ON s.SVAID = h.SVAID WHERE h.{OK} {{W:d.PDate}} ORDER BY d.PDate, s.SVANAME",
         v=["upcoming seva list", "upcoming seva types"], en=["list the sevas scheduled", "which sevas are scheduled tomorrow", "seva schedule list"]),
    # ---- donations
    dict(id="donation_total", col="DONRECDate", sql="SELECT SUM(TOTAMT) AS total_donations FROM TrnHdrDONREC WHERE Cancelled = 'N' {W}",
         v=["donation total amount", "donation collection", "donation"], en=["total donations", "how much donation was received"],
         native=["மொத்த நன்கொடை", "ಒಟ್ಟು ದೇಣಿಗೆ", "ആകെ സംഭാവന", "మొత్తం విరాళాలు"]),
    dict(id="donation_count", col="DONRECDate", sql="SELECT COUNT(*) AS donation_receipts FROM TrnHdrDONREC WHERE Cancelled = 'N' {W}",
         v=["donation howmany", "donation count"], en=["how many donation receipts", "number of donations received"]),
    dict(id="donation_avg", col="DONRECDate", sql="SELECT AVG(TOTAMT) AS average_donation FROM TrnHdrDONREC WHERE Cancelled = 'N' {W}",
         v=["donation average amount"], en=["average donation amount"]),
    dict(id="donation_top", col="DONRECDate", sql="SELECT TOP 10 DONOR AS donor, SUM(TOTAMT) AS total_amount FROM TrnHdrDONREC WHERE Cancelled = 'N' AND DONOR IS NOT NULL {W} GROUP BY DONOR ORDER BY SUM(TOTAMT) DESC",
         v=["top donor donation", "highest donor", "highest donation devotee"], en=["top donors", "who donated the most", "highest donor"]),
    dict(id="donation_largest", col="DONRECDate", sql="SELECT TOP 1 DONOR AS donor, TOTAMT AS amount, DONRECDate AS donation_date FROM TrnHdrDONREC WHERE Cancelled = 'N' {W} ORDER BY TOTAMT DESC",
         v=["highest single donation", "highest donation amount", "highest donation"], en=["what is the largest single donation", "biggest donation received"]),
    dict(id="donation_monthly", col="DONRECDate", sql="SELECT CONVERT(char(7), DONRECDate, 120) AS month, SUM(TOTAMT) AS amount FROM TrnHdrDONREC WHERE Cancelled = 'N' {W} GROUP BY CONVERT(char(7), DONRECDate, 120) ORDER BY 1",
         v=["monthwise donation"], en=["month wise donations", "donation trend by month"]),
    dict(id="donation_by_payment", col="DONRECDate", sql="SELECT PAYMNTMODE AS payment_mode, SUM(TOTAMT) AS amount FROM TrnHdrDONREC WHERE Cancelled = 'N' AND PAYMNTMODE IS NOT NULL {W} GROUP BY PAYMNTMODE ORDER BY 2 DESC",
         v=["donation paymode wise"], en=["donations by payment mode", "cash versus online donations"]),
    dict(id="donation_latest", col="DONRECDate", sql="SELECT TOP 10 PrintDONRECNO AS receipt_no, DONRECDate AS donation_date, DONOR AS donor, TOTAMT AS amount FROM TrnHdrDONREC WHERE Cancelled = 'N' {W} ORDER BY DONRECID DESC",
         v=["latest donation list"], en=["show the latest donations", "recent donation receipts"]),
    # ---- hall bookings
    dict(id="hall_count", col="HBDate", sql="SELECT COUNT(*) AS total_hall_bookings FROM TrnHdrHB WHERE Cancelled = 'N' {W}",
         v=["hall booking howmany", "hall booking count"], en=["how many hall bookings", "number of hall bookings", "total hall bookings"],
         native=["மண்டப முன்பதிவுகள் எத்தனை", "ಸಭಾಂಗಣ ಬುಕಿಂಗ್ ಎಷ್ಟು", "ഹാൾ ബുക്കിംഗ് എത്ര", "హాలు బుకింగ్‌లు ఎన్ని"]),
    dict(id="hall_amount", col="HBDate", sql="SELECT SUM(TOTAMT) AS hall_booking_amount FROM TrnHdrHB WHERE Cancelled = 'N' {W}",
         v=["hall booking total amount", "hall booking collection"], en=["total hall booking amount", "hall booking revenue", "how much from hall bookings"]),
    dict(id="hall_by_hall", col="HBDate", sql="SELECT hl.HALLNAME AS hall, SUM(h.TOTAMT) AS amount FROM TrnHdrHB h JOIN MstHALL hl ON hl.HALLID = h.HALLID WHERE h.Cancelled = 'N' {W} GROUP BY hl.HALLNAME ORDER BY SUM(h.TOTAMT) DESC",
         v=["hall wise booking amount", "highest hall booking amount"], en=["which hall earns the most", "hall wise collection", "revenue by hall"]),
    dict(id="hall_by_hall_count", col="HBDate", sql="SELECT hl.HALLNAME AS hall, COUNT(*) AS bookings FROM TrnHdrHB h JOIN MstHALL hl ON hl.HALLID = h.HALLID WHERE h.Cancelled = 'N' {W} GROUP BY hl.HALLNAME ORDER BY COUNT(*) DESC",
         v=["hall wise booking count", "highest hall booking count"], en=["which hall is booked the most", "hall wise number of bookings"]),
    dict(id="hall_occupancy", col=None, sql="SELECT hl.HALLNAME AS hall, COUNT(*) AS days_booked FROM TrnST s JOIN TrnHdrHB h ON h.HBID = s.HBID JOIN MstHALL hl ON hl.HALLID = s.HALLID WHERE h.Cancelled = 'N' {W:s.STAYDATE} GROUP BY hl.HALLNAME ORDER BY COUNT(*) DESC",
         v=["hall occupancy wise", "hall occupancy days"], en=["how many days was each hall occupied", "hall occupancy"]),
    dict(id="hall_upcoming", col=None, default="upcoming",
         sql="SELECT TOP 20 PrintHBNO AS booking_no, NMEOFFUNC AS function_name, CONPRS AS contact_person, HBSTARTDT AS from_date, HBENDDT AS to_date FROM TrnHdrHB WHERE Cancelled = 'N' {W:HBSTARTDT} ORDER BY HBSTARTDT",
         v=["upcoming hall booking list", "upcoming hall booking"], en=["upcoming hall bookings", "which halls are booked next week", "hall bookings coming up"]),
    dict(id="hall_advance", col="HBDate", sql="SELECT SUM(ADV) AS advance_received FROM TrnHdrHB WHERE Cancelled = 'N' {W}",
         v=["hall booking advance total"], en=["total advance received for hall bookings"]),
    dict(id="hall_balance", col="HBDate", sql="SELECT SUM(BALAMT) AS balance_due FROM TrnHdrHB WHERE Cancelled = 'N' {W}",
         v=["hall booking balance total"], en=["balance due on hall bookings", "pending hall payments"]),
    dict(id="hall_monthly", col="HBDate", sql="SELECT CONVERT(char(7), HBDate, 120) AS month, SUM(TOTAMT) AS amount FROM TrnHdrHB WHERE Cancelled = 'N' {W} GROUP BY CONVERT(char(7), HBDate, 120) ORDER BY 1",
         v=["monthwise hall booking amount", "monthwise hall booking collection"], en=["hall booking trend by month"]),
    # ---- vouchers and combined
    dict(id="receipt_vch_total", col="RCPTVCHDate", sql="SELECT SUM(TOTCR) AS total_receipts FROM TrnHdrRCPTVCH WHERE Cancelled = 'N' {W}",
         v=["receipt voucher total amount"], en=["total receipt vouchers", "receipt voucher amount", "total receipts"]),
    dict(id="payment_vch_total", col="PMTVCHDate", sql="SELECT SUM(TOTDR) AS total_payments FROM TrnHdrPMTVCH WHERE Cancelled = 'N' {W}",
         v=["payment voucher total amount", "payment total"], en=["total payment vouchers", "total expenses paid", "how much did we spend"]),
    dict(id="payment_vch_latest", col="PMTVCHDate", sql="SELECT TOP 10 PrintPMTVCHNO AS voucher_no, PMTVCHDate AS voucher_date, NARR AS narration, TOTDR AS amount FROM TrnHdrPMTVCH WHERE Cancelled = 'N' {W} ORDER BY PMTVCHID DESC",
         v=["latest payment voucher list"], en=["show the latest expenses", "recent payment vouchers"]),
    dict(id="total_collection", col=None,
         sql="SELECT 'Seva' AS source, ISNULL(SUM(TotalAmt), 0) AS amount FROM TrnHdrSEVA WHERE Cancelled = 'N' {W:SEVADate} "
             "UNION ALL SELECT 'Donation', ISNULL(SUM(TOTAMT), 0) FROM TrnHdrDONREC WHERE Cancelled = 'N' {W:DONRECDate} "
             "UNION ALL SELECT 'Hall', ISNULL(SUM(TOTAMT), 0) FROM TrnHdrHB WHERE Cancelled = 'N' {W:HBDate}",
         v=["total collection seva donation hall", "collection wise total"], en=["what is the total collection", "overall income by source", "seva donation and hall collection together"],
         native=["மொத்த வசூல் எவ்வளவு", "ಒಟ್ಟು ಸಂಗ್ರಹ ಎಷ್ಟು", "ആകെ പിരിവ് എത്ര", "మొత్తం వసూలు ఎంత"]),
    # ---- masters
    dict(id="seva_list", col=None, sql="SELECT SVANAME AS seva, AMT AS rate FROM MstSVA WHERE SVAID <> 0 AND ISNULL(InActive, 'N') <> 'Y' ORDER BY SVANAME",
         v=["seva list amount", "seva list rate", "seva list types"], en=["list all sevas with their rates", "seva rate list", "what sevas do we offer"]),
    dict(id="seva_types_count", col=None, sql="SELECT COUNT(*) AS seva_types FROM MstSVA WHERE SVAID <> 0 AND ISNULL(InActive, 'N') <> 'Y'",
         v=["seva types howmany", "seva types count"], en=["how many types of sevas are there"]),
    dict(id="hall_list", col=None, sql="SELECT HALLNAME AS hall FROM MstHALL WHERE HALLID <> 0 AND ISNULL(InActive, 'N') <> 'Y' ORDER BY HALLNAME",
         v=["hall list", "hall list types"], en=["list all halls", "which halls do we have"]),
]

from app.services import ask_filters, ask_templates_more  # noqa: E402

T.extend(ask_templates_more.MORE)

# Example questions shown when nothing matches (each one must match a template; tests enforce it).
SUGGEST = {
    "en": ["What are the total sevas created this month?", "Which customer has purchased seva for the highest amount?", "What is the total collection this financial year?",
           "Show the latest donations", "Upcoming hall bookings"],
    "ta": ["இந்த மாதம் மொத்த சேவைகள் எத்தனை", "அதிக தொகைக்கு சேவை செய்த பக்தர் யார்", "இந்த நிதியாண்டு மொத்த வசூல் எவ்வளவு"],
    "kn": ["ಈ ತಿಂಗಳು ಒಟ್ಟು ಸೇವೆಗಳು ಎಷ್ಟು", "ಅತಿ ಹೆಚ್ಚು ಮೊತ್ತದ ಸೇವೆ ಮಾಡಿದ ಭಕ್ತರು ಯಾರು", "ಈ ಆರ್ಥಿಕ ವರ್ಷ ಒಟ್ಟು ಸಂಗ್ರಹ ಎಷ್ಟು"],
    "ml": ["ഈ മാസം ആകെ സേവകൾ എത്ര", "ഏറ്റവും കൂടുതൽ തുകയ്ക്ക് സേവ ചെയ്ത ഭക്തൻ ആര്", "ഈ സാമ്പത്തിക വർഷം ആകെ പിരിവ് എത്ര"],
    "te": ["ఈ నెల మొత్తం సేవలు ఎన్ని", "అత్యధిక మొత్తానికి సేవ చేసిన భక్తుడు ఎవరు", "ఈ ఆర్థిక సంవత్సరం మొత్తం వసూలు ఎంత"],
}


# --------------------------------------------------------------------------- matching
_STOP = {"what", "whats", "is", "are", "was", "were", "the", "a", "an", "of", "in", "on", "by", "for", "to", "do", "does",
         "did", "me", "my", "tell", "show", "give", "which", "who", "has", "have", "had", "and", "with", "from", "all"}  # "how many/much" carry meaning: kept


def _grams(s: str) -> Counter:
    s = re.sub(r"[^\w\s]", " ", s.lower(), flags=re.UNICODE)
    s = " " + " ".join(w for w in s.split() if w not in _STOP) + " "
    return Counter(s[i:i + 3] for i in range(max(len(s) - 2, 1)))


def phrasings(t: dict) -> list[str]:
    out = list(t.get("en", []))
    for spec in t.get("v", []):
        out += _compose(spec)
    return out + list(t.get("native", []))


_IDF: dict[str, float] = {}
_DOC_VECS: list[tuple[int, dict]] = []


def _vec(g: Counter) -> dict[str, float]:
    v = {k: c * _IDF.get(k, 1.0) for k, c in g.items()}
    norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {k: x / norm for k, x in v.items()}


def _build() -> None:
    if _DOC_VECS:
        return
    docs = [(i, _grams(ph)) for i, t in enumerate(T) for ph in phrasings(t)]
    df: Counter = Counter()
    for _, g in docs:
        df.update(g.keys())
    n = len(docs)
    for k, c in df.items():
        _IDF[k] = math.log((1 + n) / (1 + c)) + 1
    _DOC_VECS.extend((i, _vec(g)) for i, g in docs)


def _prefixes(text_: str) -> set[str]:
    return {w[:4] for w in re.sub(r"[^\w\s]", " ", text_.lower(), flags=re.UNICODE).split() if w not in _STOP}


_VOCAB_PREFIXES: set[str] = set()


def match(question: str) -> tuple[dict | None, float]:
    _build()
    if not _VOCAB_PREFIXES:
        for tpl in T:
            for ph in phrasings(tpl):
                _VOCAB_PREFIXES.update(_prefixes(ph))
    for tpl in T:
        tpl.setdefault("_specs", [ask_nlu.spec_concepts(sp) for sp in tpl.get("v", [])])
    qc = ask_nlu.concepts(question)
    ct, cs = ask_nlu.best_template(qc, T)
    if ct is not None and cs >= CONCEPT_MIN:
        return ct, cs
    if not (_prefixes(question) & _VOCAB_PREFIXES):  # no real word in common (e.g. "hello"): never guess from stray trigrams
        return None, 0.0
    qv = _vec(_grams(question))
    best, score = None, 0.0
    for i, dv in _DOC_VECS:
        s = sum(w * dv.get(k, 0.0) for k, w in qv.items())
        if s > score:
            best, score = T[i], s
    return (best, score) if score >= THRESHOLD else (None, score)


_TOPN = re.compile(r"\b(?:top|first|latest|last|recent|best)\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:top|latest|recent|best)\b", re.I)


def _top_n(text_: str) -> int | None:
    m = _TOPN.search(text_)
    n = int(m[1] or m[2]) if m else 0
    return min(max(n, 1), 50) if n else None


FUTURE_PERIODS = {"tomorrow", "next_week", "next_month"}
FUTURE_REDIRECT = {"seva_count": "seva_upcoming", "hall_count": "hall_upcoming"}

_W = re.compile(r"\{W(?::([\w.]+))?\}")


def build(question: str, today: dt.date | None = None, fy: tuple[dt.date, dt.date] | None = None, catalog: dict | None = None) -> dict | None:
    """-> {'id','sql','params','period','range','score'} or None when no template matches well enough."""
    parsed = ask_dates.parse(question, today, fy)  # specific dates / months / last week / last N days / quarters
    if parsed:
        key, stripped = "custom", parsed["stripped"]
    else:
        key, stripped = detect_period(question)
    t, score = match(stripped)
    if not t:
        return None
    # a future period ("tomorrow", "next week") on a count question means the scheduled list, not registrations made then
    future = key in FUTURE_PERIODS or bool(parsed and parsed["range"][0] > (today or dt.date.today()))
    if future and t["id"] in FUTURE_REDIRECT:
        t = next(x for x in T if x["id"] == FUTURE_REDIRECT[t["id"]])
    if t["id"] == "hall_occupancy" and (parsed or key in ("today", "tomorrow", "yesterday", "this_week", "next_week")):
        t = next(x for x in T if x["id"] == "hall_booked_on")
    found = ask_filters.extract(stripped, catalog)  # payment mode, amount limits, a named seva / hall / sannidhi, a person's name
    if found.get("name") and t["id"] in ask_filters.NAME_REDIRECT:
        t = next(x for x in T if x["id"] == ask_filters.NAME_REDIRECT[t["id"]])
    if found.get("mode") and t["id"] in ask_filters.MODE_REDIRECT:
        t = next(x for x in T if x["id"] == ask_filters.MODE_REDIRECT[t["id"]])
    period = key or t.get("default") or "this_fy"
    rng = parsed["range"] if parsed else period_range(period, today, fy)
    top_n = _top_n(stripped)

    def cond(m: re.Match) -> str:
        col = m.group(1) or t["col"]
        return f"AND {col} >= :d1 AND {col} < :d2" if rng and col else ""

    sql = _W.sub(cond, t["sql"])
    sql, fparams, flabels = ask_filters.apply(t["id"], sql, found)
    if top_n:  # "top 5 donors", "latest 20 sevas"
        sql = re.sub(r"\bTOP (?:10|15|20)\b", f"TOP {top_n}", sql, count=1)
    return {"id": t["id"], "sql": sql, "params": {**({"d1": rng[0], "d2": rng[1]} if rng else {}), **fparams}, "period": period,
            "filters": flabels, "range": rng, "dated": bool(_W.search(t["sql"])), "score": round(score, 2)}


def suggestions(lang: str, n: int = 5) -> list[str]:
    return SUGGEST.get(lang, SUGGEST["en"])[:n]
