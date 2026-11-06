import datetime as dt
import re

import pytest

from app.core.db import get_engine
from app.services import ask_data, ask_templates as t

TODAY = dt.date(2026, 11, 2)
FY = (dt.date(2026, 4, 1), dt.date(2027, 3, 31))

# (question, expected template id, expected period)
MATRIX = [
    ("What are the total sevas created this month?", "seva_count", "this_month"),
    ("how many sevas", "seva_count", "this_fy"),
    ("how many sevas overall", "seva_count", "all"),
    ("total seva amount last financial year", "seva_amount", "last_fy"),
    ("Which customer has purchased seva for the highest amount?", "seva_top1", "this_fy"),
    ("top 10 customers by seva amount", "seva_top10", "this_fy"),
    ("average seva amount", "seva_avg", "this_fy"),
    ("month wise seva amount", "seva_monthly", "this_fy"),
    ("daily seva collection this month", "seva_daily", "this_month"),
    ("which seva earned the most", "seva_type_amount", "this_fy"),
    ("which seva is booked the most", "seva_type_count", "this_fy"),
    ("sannidhi wise seva collection", "seva_sannidhi", "this_fy"),
    ("which nakshatra has the most sevas", "seva_nakshatra", "this_fy"),
    ("which user entered the most sevas", "seva_by_user", "this_fy"),
    ("how many sevas were cancelled", "seva_cancelled", "this_fy"),
    ("show the latest seva entries", "seva_latest", "this_fy"),
    ("sevas scheduled for tomorrow", "seva_schedule_list", "tomorrow"),
    ("upcoming sevas", "seva_schedule_list", "upcoming"),
    ("total donations", "donation_total", "this_fy"),
    ("total donations last month", "donation_total", "last_month"),
    ("who donated the most", "donation_top", "this_fy"),
    ("what is the largest single donation", "donation_largest", "this_fy"),
    ("how many hall bookings today", "hall_count", "today"),
    ("which hall earns the most", "hall_by_hall", "this_fy"),
    ("upcoming hall bookings", "hall_upcoming", "upcoming"),
    ("balance due on hall bookings", "hall_balance", "this_fy"),
    ("total expenses paid", "payment_vch_total", "this_fy"),
    ("what is the total collection", "total_collection", "this_fy"),
    ("list all sevas with their rates", "seva_list", "this_fy"),
    # Indian languages
    ("இந்த மாதம் மொத்த சேவைகள் எத்தனை", "seva_count", "this_month"),
    ("ಅತಿ ಹೆಚ್ಚು ಮೊತ್ತದ ಸೇವೆ ಮಾಡಿದ ಭಕ್ತರು ಯಾರು", "seva_top1", "this_fy"),
    ("ഈ മാസം ആകെ സംഭാവന", "donation_total", "this_month"),
    ("మొత్తం విరాళాలు గత నెల", "donation_total", "last_month"),
    ("இந்த ஆண்டு மொத்த நன்கொடை", "donation_total", "this_fy"),
    ("ಈ ಆರ್ಥಿಕ ವರ್ಷ ಒಟ್ಟು ಸಂಗ್ರಹ ಎಷ್ಟು", "total_collection", "this_fy"),
]


@pytest.mark.parametrize("q,tid,period", MATRIX)
def test_matching(q, tid, period):
    b = t.build(q, TODAY, FY)
    assert b is not None, f"no match: {q}"
    assert (b["id"], b["period"]) == (tid, period), (q, b["id"], b["period"], b["score"])


@pytest.mark.parametrize("q", ["what is the weather in Chennai", "what is the capital of india", "who is the prime minister", "hello", "tell me a joke"])
def test_unrelated_question_no_match(q):
    assert t.build(q, TODAY, FY) is None


def test_suggestions_all_match_a_template():
    for lang, qs in t.SUGGEST.items():
        for q in qs:
            assert t.build(q, TODAY, FY), (lang, q)


def test_default_period_is_the_financial_year():
    b = t.build("total donations", TODAY, FY)
    assert b["range"] == (dt.date(2026, 4, 1), dt.date(2027, 4, 1)) and b["params"] == {"d1": dt.date(2026, 4, 1), "d2": dt.date(2027, 4, 1)}
    assert "DONRECDate >= :d1" in b["sql"]


def test_all_time_has_no_date_filter():
    b = t.build("total donations overall", TODAY, FY)
    assert b["params"] == {} and ":d1" not in b["sql"]


def test_period_ranges():
    assert t.period_range("this_month", TODAY) == (dt.date(2026, 11, 1), dt.date(2026, 12, 1))
    assert t.period_range("last_month", TODAY) == (dt.date(2026, 10, 1), dt.date(2026, 11, 1))
    assert t.period_range("next_week", TODAY) == (dt.date(2026, 11, 9), dt.date(2026, 11, 16))
    assert t.period_range("last_fy", TODAY, FY) == (dt.date(2025, 4, 1), dt.date(2026, 4, 1))
    assert t.period_range("tomorrow", TODAY) == (dt.date(2026, 11, 3), dt.date(2026, 11, 4))


def test_template_ids_unique_and_read_only():
    ids = [x["id"] for x in t.T]
    assert len(ids) == len(set(ids))
    for x in t.T:
        assert not re.search(r"(?i)\b(insert|update|delete|drop|exec)\b", x["sql"])


@pytest.mark.parametrize("tpl", t.T, ids=lambda x: x["id"])
@pytest.mark.parametrize("with_dates", [True, False])
def test_every_template_runs_on_live_db(tpl, with_dates):
    rng = t.period_range("this_fy", TODAY, FY) if with_dates else None

    def cond(m):
        col = m.group(1) or tpl["col"]
        return f"AND {col} >= :d1 AND {col} < :d2" if rng and col else ""

    with get_engine().connect() as c:
        cols, _ = ask_data.run_select(c, t._W.sub(cond, tpl["sql"]), {"d1": rng[0], "d2": rng[1]} if rng else {})
    assert cols


# Everyday / colloquial / romanised phrasings (what people actually type and say)
COLLOQUIAL = [
    ("போன மாசம் எத்தனை சேவா ரிஜிஸ்டர் பண்ணாங்க", "seva_count", "last_month"),
    ("pona masam evlo seva register aachu", "seva_count", "last_month"),
    ("last months total seva registered", "seva_count", "last_month"),
    ("how many sevas were registered last month", "seva_count", "last_month"),
    ("sevas done this month", "seva_count", "this_month"),
    ("இன்னைக்கு எத்தனை சேவா பண்ணாங்க", "seva_count", "today"),
    ("நேத்து எவ்வளவு நன்கொடை வந்தது", "donation_total", "yesterday"),
    ("who donated the most", "donation_top", "this_fy"),
    ("யார் அதிக நன்கொடை கொடுத்தார்", "donation_top", "this_fy"),
    ("how much money did we collect from sevas last month", "seva_amount", "last_month"),
    ("hall booking count next month", "hall_upcoming", "next_month"),
    ("ಕಳೆದ ತಿಂಗಳು ಎಷ್ಟು ಸೇವೆ ನೋಂದಣಿ ಆಯಿತು", "seva_count", "last_month"),
    ("കഴിഞ്ഞ മാസം എത്ര സേവ രജിസ്റ്റർ ചെയ്തു", "seva_count", "last_month"),
    ("గత నెల ఎన్ని సేవలు నమోదు అయ్యాయి", "seva_count", "last_month"),
]


@pytest.mark.parametrize("q,tid,period", COLLOQUIAL)
def test_colloquial_questions(q, tid, period):
    b = t.build(q, TODAY, FY)
    assert b is not None, f"no match: {q}"
    assert (b["id"], b["period"]) == (tid, period), (q, b["id"], b["period"], b["score"])


# Spoken / colloquial / Latin-typed questions in every supported language
ALL_LANGUAGES = [
    # Kannada
    ("ಹೋದ ತಿಂಗಳು ಎಷ್ಟು ಸೇವೆ ಮಾಡಿದ್ರು", "seva_count", "last_month"),
    ("ಇವತ್ತು ಎಷ್ಟು ಹಣ ದೇಣಿಗೆ ಬಂತು", "donation_total", "today"),
    ("ಯಾವ ಸೇವೆ ಜಾಸ್ತಿ ಬುಕ್ ಆಗಿದೆ", "seva_type_count", "this_fy"),
    ("ಅತಿ ಹೆಚ್ಚು ದೇಣಿಗೆ ಕೊಟ್ಟವರು ಯಾರು", "donation_top", "this_fy"),
    ("ee tingalu eshtu seva register aagide", "seva_count", "this_month"),
    # Malayalam
    ("കഴിഞ്ഞ മാസം എത്ര വഴിപാട് നടന്നു", "seva_count", "last_month"),
    ("ഇന്ന് എത്ര രൂപ സംഭാവന കിട്ടി", "donation_total", "today"),
    ("ഏറ്റവും കൂടുതൽ സംഭാവന നൽകിയത് ആരാണ്", "donation_top", "this_fy"),
    ("ഏത് വഴിപാടാണ് ഏറ്റവും കൂടുതൽ ബുക്ക് ചെയ്തത്", "seva_type_count", "this_fy"),
    ("kazhinja masam ethra vazhipad register cheythu", "seva_count", "last_month"),
    # Telugu
    ("పోయిన నెల ఎన్ని సేవలు చేశారు", "seva_count", "last_month"),
    ("ఈరోజు ఎంత డబ్బు విరాళం వచ్చింది", "donation_total", "today"),
    ("అత్యధిక విరాళం ఇచ్చింది ఎవరు", "donation_top", "this_fy"),
    ("ఏ సేవ ఎక్కువ బుక్ అయింది", "seva_type_count", "this_fy"),
    ("ee nela enni seva register ayyayi", "seva_count", "this_month"),
    # Tamil (spoken + Tanglish)
    ("ரொம்ப அதிகமா சேவா பண்ணவங்க யார்", "seva_top1", "this_fy"),
    ("indha masam evlo donation vandhuchu", "donation_total", "this_month"),
    ("நேத்து எவ்வளவு நன்கொடை வந்தது", "donation_total", "yesterday"),
    ("எந்த சேவா அதிகம் புக் ஆச்சு", "seva_type_count", "this_fy"),
    # English (Indian usage)
    ("how much donation came today", "donation_total", "today"),
    ("hall booking details for next week", "hall_upcoming", "next_week"),
]


@pytest.mark.parametrize("q,tid,period", ALL_LANGUAGES)
def test_all_languages_spoken_and_romanised(q, tid, period):
    b = t.build(q, TODAY, FY)
    assert b is not None, f"no match: {q}"
    assert (b["id"], b["period"]) == (tid, period), (q, b["id"], b["period"], b["score"])


# ---- dates: last week, months, specific dates, ranges, rolling windows, quarters (today = Mon 2 Nov 2026, FY Apr 2026 - Mar 2027)
D = dt.date
DATES = [
    ("how many saves were been made last week", "seva_count", (D(2026, 10, 26), D(2026, 11, 2))),
    ("how many sevas were registered previous week", "seva_count", (D(2026, 10, 26), D(2026, 11, 2))),
    ("total seva amount in october", "seva_amount", (D(2026, 10, 1), D(2026, 11, 1))),
    ("donations in march", "donation_total", (D(2027, 3, 1), D(2027, 4, 1))),
    ("how many sevas in may", "seva_count", (D(2026, 5, 1), D(2026, 6, 1))),
    ("seva count from 1 oct to 15 oct", "seva_count", (D(2026, 10, 1), D(2026, 10, 16))),
    ("between 5/10 and 12/10 seva amount", "seva_amount", (D(2026, 10, 5), D(2026, 10, 13))),
    ("sevas on 20/10/2026", "seva_count", (D(2026, 10, 20), D(2026, 10, 21))),
    ("sevas on 2026-10-20", "seva_count", (D(2026, 10, 20), D(2026, 10, 21))),
    ("seva amount on 5th november", "seva_amount", (D(2026, 11, 5), D(2026, 11, 6))),
    ("last 7 days donations", "donation_total", (D(2026, 10, 27), D(2026, 11, 3))),
    ("seva amount in the last 3 months", "seva_amount", (D(2026, 8, 2), D(2026, 11, 3))),
    ("last quarter total collection", "total_collection", (D(2026, 7, 1), D(2026, 10, 1))),
    ("this quarter total collection", "total_collection", (D(2026, 10, 1), D(2027, 1, 1))),
    ("q1 total collection", "total_collection", (D(2026, 4, 1), D(2026, 7, 1))),
    ("sevas since april", "seva_count", (D(2026, 4, 1), D(2026, 11, 3))),
    ("sevas on 5 november", "seva_upcoming", (D(2026, 11, 5), D(2026, 11, 6))),  # a future date = the scheduled list
    ("day before yesterday donations", "donation_total", (D(2026, 10, 31), D(2026, 11, 1))),
    # Indian languages
    ("கடந்த வாரம் எத்தனை சேவா", "seva_count", (D(2026, 10, 26), D(2026, 11, 2))),
    ("అక్టోబర్ లో ఎన్ని సేవలు", "seva_count", (D(2026, 10, 1), D(2026, 11, 1))),
    ("ಕಳೆದ 7 ದಿನಗಳಲ್ಲಿ ಎಷ್ಟು ದೇಣಿಗೆ", None, (D(2026, 10, 27), D(2026, 11, 3))),
    ("കഴിഞ്ഞ ആഴ്ച എത്ര വഴിപാട് നടന്നു", "seva_count", (D(2026, 10, 26), D(2026, 11, 2))),
    ("நவம்பர் மாதம் மொத்த நன்கொடை", "donation_total", (D(2026, 11, 1), D(2026, 12, 1))),
]


@pytest.mark.parametrize("q,tid,rng", DATES)
def test_date_understanding(q, tid, rng):
    b = t.build(q, TODAY, FY)
    assert b is not None, f"no match: {q}"
    assert b["range"] == rng, (q, b["range"], b["id"])
    if tid:
        assert b["id"] == tid, (q, b["id"])


def test_english_verb_may_is_not_the_month():
    b = t.build("how many sevas may be cancelled", TODAY, FY)
    assert b["id"] == "seva_cancelled" and b["period"] == "this_fy"


@pytest.mark.parametrize("q,n", [("top 5 donors", 5), ("latest 20 sevas", 20), ("show top 3 customers by seva amount", 3), ("top donors", 10)])
def test_top_n(q, n):
    assert f"TOP {n} " in t.build(q, TODAY, FY)["sql"]


def test_typos_are_tolerated():
    for q, tid in [("how many sevaa were registerd last month", "seva_count"), ("total donatn this month", "donation_total")]:
        assert t.build(q, TODAY, FY)["id"] == tid, q


def test_scheduled_list_template_runs_on_live_db():
    b = t.build("list the sevas scheduled next week", TODAY, FY)
    assert b["id"] == "seva_schedule_list"
    with get_engine().connect() as c:
        cols, _ = ask_data.run_select(c, b["sql"], b["params"])
    assert cols == ["day", "seva", "customer"]


# ---- second batch: what staff ask about money, halls, festivals, documents
from app.services import ask_filters  # noqa: E402

BATCH2 = [
    ("what is the biggest seva booking", "seva_largest", None),
    ("how much did each user collect today", "collection_by_user", "today"),
    ("who collected how much today", "collection_by_user", "today"),
    ("which seva got the most donation", "donation_by_seva", None),
    ("how many donation receipts were cancelled", "donation_cancelled", None),
    ("daily donations", "donation_daily", None),
    ("which halls are free tomorrow", "hall_free", "tomorrow"),
    ("is the hall available today", "hall_free", "today"),
    ("which halls are booked today", "hall_booked_on", "today"),
    ("what kind of functions are held in the hall", "hall_functions", None),
    ("who booked the hall the most", "hall_top_customers", None),
    ("show the latest hall bookings", "hall_latest", None),
    ("how many receipt vouchers", "receipt_vch_count", None),
    ("how many payment vouchers", "payment_vch_count", None),
    ("cash versus bank payments", "payment_by_mode", None),
    ("where did we spend the most", "expense_by_head", None),
    ("top expense heads", "expense_by_head", None),
    ("top income heads", "income_by_head", None),
    ("branch wise expense", "expense_by_branch", None),
    ("branch wise income", "income_by_branch", None),
    ("monthly expenses", "payment_monthly", None),
    ("how much did we save", "net_surplus", None),
    ("net surplus this year", "net_surplus", "this_fy"),
    ("give me today's summary", "daily_summary", "today"),
    ("what happened today", "daily_summary", "today"),
    ("month wise total collection", "collection_monthly", None),
    ("payment mode wise total collection", "collection_by_mode", None),
    ("which documents are pending authorisation", "pending_auth_all", None),
    ("which documents were cancelled", "cancelled_all", None),
    ("what festivals are coming up", "panchanga_list", "upcoming"),
    ("is there any festival tomorrow", "panchanga_list", "tomorrow"),
    ("list the events", "events_list", None),
    ("list the sannidhis", "sannidhi_list", None),
    # Indian languages
    ("இன்று சுருக்கம்", "daily_summary", "today"),
    ("ಈ ತಿಂಗಳು ಹಬ್ಬಗಳು", "panchanga_list", "this_month"),
    ("ഈ ആഴ്ച ഉത്സവം", "panchanga_list", "this_week"),
    ("రేపు ఖాళీ హాలు ఏవి", "hall_free", "tomorrow"),
    ("கிளை வாரியாக செலவு", "expense_by_branch", None),
]


@pytest.mark.parametrize("q,tid,period", BATCH2)
def test_second_batch_questions(q, tid, period):
    b = t.build(q, TODAY, FY, {})
    assert b is not None, f"no match: {q}"
    assert b["id"] == tid, (q, b["id"], b["score"])
    if period:
        assert b["period"] == period, (q, b["period"])


CAT = {"sevas": [(5, "Archana")], "halls": [(2, "Kalyana Mantapa")], "sannidhis": [(1, "Raghavendra")]}


def test_filters_payment_mode_amount_and_names():
    b = t.build("cash sevas this month", TODAY, FY, CAT)
    assert b["filters"] == ["Cash"] and b["params"]["pm"] == "CASH" and "UPPER(PAYMENT) = :pm" in b["sql"]
    b = t.build("donations above 10,000", TODAY, FY, CAT)
    assert b["params"]["amin"] == 10000 and "TOTAMT >= :amin" in b["sql"]
    assert t.build("donations over 2 lakh", TODAY, FY, CAT)["params"]["amin"] == 200000
    assert t.build("sevas below 500", TODAY, FY, CAT)["params"]["amax"] == 500
    b = t.build("how many Archana sevas last month", TODAY, FY, CAT)
    assert b["id"] == "seva_count" and b["params"]["svaid"] == 5 and b["filters"] == ["Archana"]
    b = t.build("hall booking amount for Kalyana Mantapa", TODAY, FY, CAT)
    assert b["id"] == "hall_amount" and b["params"]["hallid"] == 2
    b = t.build("sevas done by ramesh kumar", TODAY, FY, CAT)
    assert b["params"]["nm"] == "%Ramesh Kumar%" and b["filters"] == ["Ramesh Kumar"]
    b = t.build("upi collection today", TODAY, FY, CAT)
    assert b["id"] == "collection_by_mode" and b["params"]["pm"] == "UPI"


@pytest.mark.parametrize("q", ["which user entered the most sevas", "seva amount by month", "top donors for last week", "sevas by payment mode", "donations from april"])
def test_no_false_person_name(q):
    b = t.build(q, TODAY, FY, CAT)
    assert b is not None and "nm" not in b["params"], (q, b["params"])


@pytest.mark.parametrize("tid", sorted(ask_filters.TEMPLATE_FILTERS))
def test_every_filtered_template_runs_with_all_filters_on_live_db(tid):
    tpl = next(x for x in t.T if x["id"] == tid)
    rng = t.period_range("this_fy", TODAY, FY)
    sql = t._W.sub(lambda m: f"AND {m.group(1) or tpl['col']} >= :d1 AND {m.group(1) or tpl['col']} < :d2" if (m.group(1) or tpl["col"]) else "", tpl["sql"])
    found = {"mode": "CASH", "amin": 1, "amax": 10**9, "sva": (5, "x"), "hall": (2, "x"), "san": (1, "x"), "name": "Ram"}
    sql2, params, labels = ask_filters.apply(tid, sql, found)
    assert labels
    with get_engine().connect() as c:
        cols, _ = ask_data.run_select(c, sql2, {"d1": rng[0], "d2": rng[1], **params})
    assert cols
