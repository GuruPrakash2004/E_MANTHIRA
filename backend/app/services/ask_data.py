"""
"Ask the Data": natural-language question -> SQL (Vanna + a local Hugging Face model) -> rows + chart spec.

* The model runs inside this Python process (no hosted LLM). It loads lazily on the first question.
* Vanna only GENERATES the SQL. Execution goes through our own engine after `ask_sql_guard.validate`.
* History lives in `WebAiQueryHistory` (the single table this feature adds; see tools/create_ask_history.sql).
  Result rows are never stored - re-run the saved SQL instead.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading
from decimal import Decimal
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core import capabilities
from app.core.config import get_settings
from app.core.db import get_engine
from app.services import ask_sql_guard as guard
from app.services import ask_templates

log = logging.getLogger(__name__)

HISTORY_TABLE = "WebAiQueryHistory"
LANGUAGES = [
    {"code": "en", "label": "English", "speech": "en-IN"},
    {"code": "ta", "label": "தமிழ்", "speech": "ta-IN"},
    {"code": "kn", "label": "ಕನ್ನಡ", "speech": "kn-IN"},
    {"code": "ml", "label": "മലയാളം", "speech": "ml-IN"},
    {"code": "te", "label": "తెలుగు", "speech": "te-IN"},
]
# Page captions per language (served by /ask-data/meta; the React page hard-codes none of them).
CAPTIONS = {
    "en": {"title": "Ask the Data", "subtitle": "Ask a question about your temple data in plain words", "placeholder": "e.g. What are the total sevas created this month?", "ask": "Ask", "history": "History", "search": "Search history", "delete": "Delete", "rerun": "Run again", "sql": "SQL used", "empty": "No questions yet", "thinking": "Working on it...", "good": "Correct", "bad": "Wrong", "rows": "rows", "unavailable": "Not available in this database"},
    "ta": {"title": "தரவைக் கேளுங்கள்", "subtitle": "உங்கள் கோவில் தரவைப் பற்றி எளிய சொற்களில் கேளுங்கள்", "placeholder": "எ.கா. இந்த மாதம் உருவாக்கப்பட்ட மொத்த சேவைகள் எத்தனை?", "ask": "கேள்", "history": "வரலாறு", "search": "வரலாற்றில் தேடு", "delete": "நீக்கு", "rerun": "மீண்டும் இயக்கு", "sql": "பயன்படுத்திய SQL", "empty": "கேள்விகள் இல்லை", "thinking": "செயலாக்கப்படுகிறது...", "good": "சரி", "bad": "தவறு", "rows": "வரிசைகள்", "unavailable": "இந்த தரவுத்தளத்தில் கிடைக்கவில்லை"},
    "kn": {"title": "ಡೇಟಾವನ್ನು ಕೇಳಿ", "subtitle": "ನಿಮ್ಮ ದೇವಾಲಯದ ಡೇಟಾ ಬಗ್ಗೆ ಸರಳ ಮಾತುಗಳಲ್ಲಿ ಕೇಳಿ", "placeholder": "ಉದಾ. ಈ ತಿಂಗಳು ರಚಿಸಿದ ಒಟ್ಟು ಸೇವೆಗಳು ಎಷ್ಟು?", "ask": "ಕೇಳಿ", "history": "ಇತಿಹಾಸ", "search": "ಇತಿಹಾಸ ಹುಡುಕಿ", "delete": "ಅಳಿಸಿ", "rerun": "ಮತ್ತೆ ಚಲಾಯಿಸಿ", "sql": "ಬಳಸಿದ SQL", "empty": "ಇನ್ನೂ ಪ್ರಶ್ನೆಗಳಿಲ್ಲ", "thinking": "ಸಂಸ್ಕರಿಸಲಾಗುತ್ತಿದೆ...", "good": "ಸರಿ", "bad": "ತಪ್ಪು", "rows": "ಸಾಲುಗಳು", "unavailable": "ಈ ಡೇಟಾಬೇಸ್‌ನಲ್ಲಿ ಲಭ್ಯವಿಲ್ಲ"},
    "ml": {"title": "ഡാറ്റ ചോദിക്കൂ", "subtitle": "നിങ്ങളുടെ ക്ഷേത്ര ഡാറ്റയെക്കുറിച്ച് ലളിതമായി ചോദിക്കൂ", "placeholder": "ഉദാ. ഈ മാസം സൃഷ്ടിച്ച ആകെ സേവകൾ എത്ര?", "ask": "ചോദിക്കൂ", "history": "ചരിത്രം", "search": "ചരിത്രത്തിൽ തിരയുക", "delete": "ഇല്ലാതാക്കുക", "rerun": "വീണ്ടും പ്രവർത്തിപ്പിക്കുക", "sql": "ഉപയോഗിച്ച SQL", "empty": "ചോദ്യങ്ങളില്ല", "thinking": "പ്രോസസ്സ് ചെയ്യുന്നു...", "good": "ശരി", "bad": "തെറ്റ്", "rows": "വരികൾ", "unavailable": "ഈ ഡാറ്റാബേസിൽ ലഭ്യമല്ല"},
    "te": {"title": "డేటాను అడగండి", "subtitle": "మీ ఆలయ డేటా గురించి సులభంగా అడగండి", "placeholder": "ఉదా. ఈ నెలలో సృష్టించిన మొత్తం సేవలు ఎన్ని?", "ask": "అడగండి", "history": "చరిత్ర", "search": "చరిత్రలో వెతకండి", "delete": "తొలగించు", "rerun": "మళ్లీ అమలు చేయి", "sql": "ఉపయోగించిన SQL", "empty": "ప్రశ్నలు లేవు", "thinking": "ప్రాసెస్ చేస్తోంది...", "good": "సరైనది", "bad": "తప్పు", "rows": "వరుసలు", "unavailable": "ఈ డేటాబేస్‌లో అందుబాటులో లేదు"},
}
# Chat-screen captions (voice, loading steps) per language; merged into CAPTIONS below.
_CHAT_CAPTIONS = {
    "en": {"listening": "Listening... speak now", "speak": "Speak", "stop": "Stop", "send": "Send", "step1": "Understanding your question", "step2": "Finding the data", "step3": "Preparing your answer",
           "mic_unsupported": "Voice input needs Chrome or Edge", "mic_denied": "Microphone access was blocked", "new_chat": "New chat", "nav_tooltip": "Ask me", "try": "Try asking", "composer": "Ask anything about your temple data"},
    "ta": {"listening": "கேட்கிறேன்... இப்போது பேசுங்கள்", "speak": "பேசுங்கள்", "stop": "நிறுத்து", "send": "அனுப்பு", "step1": "உங்கள் கேள்வியைப் புரிந்துகொள்கிறேன்", "step2": "தரவைத் தேடுகிறேன்", "step3": "பதிலைத் தயாரிக்கிறேன்",
           "mic_unsupported": "குரல் உள்ளீட்டிற்கு Chrome அல்லது Edge தேவை", "mic_denied": "மைக்ரோஃபோன் அணுகல் தடுக்கப்பட்டது", "new_chat": "புதிய உரையாடல்", "nav_tooltip": "என்னிடம் கேளுங்கள்", "try": "இவற்றைக் கேளுங்கள்", "composer": "உங்கள் கோவில் தரவைப் பற்றி எதையும் கேளுங்கள்"},
    "kn": {"listening": "ಆಲಿಸುತ್ತಿದ್ದೇನೆ... ಈಗ ಮಾತನಾಡಿ", "speak": "ಮಾತನಾಡಿ", "stop": "ನಿಲ್ಲಿಸಿ", "send": "ಕಳುಹಿಸಿ", "step1": "ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ", "step2": "ಡೇಟಾ ಹುಡುಕುತ್ತಿದ್ದೇನೆ", "step3": "ಉತ್ತರ ಸಿದ್ಧಪಡಿಸುತ್ತಿದ್ದೇನೆ",
           "mic_unsupported": "ಧ್ವನಿ ಇನ್‌ಪುಟ್‌ಗೆ Chrome ಅಥವಾ Edge ಬೇಕು", "mic_denied": "ಮೈಕ್ರೊಫೋನ್ ಪ್ರವೇಶ ನಿರ್ಬಂಧಿಸಲಾಗಿದೆ", "new_chat": "ಹೊಸ ಚಾಟ್", "nav_tooltip": "ನನ್ನನ್ನು ಕೇಳಿ", "try": "ಇವನ್ನು ಕೇಳಿ", "composer": "ನಿಮ್ಮ ದೇವಾಲಯದ ಡೇಟಾ ಬಗ್ಗೆ ಏನು ಬೇಕಾದರೂ ಕೇಳಿ"},
    "ml": {"listening": "കേൾക്കുന്നു... ഇപ്പോൾ സംസാരിക്കൂ", "speak": "സംസാരിക്കൂ", "stop": "നിർത്തുക", "send": "അയയ്ക്കുക", "step1": "നിങ്ങളുടെ ചോദ്യം മനസ്സിലാക്കുന്നു", "step2": "ഡാറ്റ തിരയുന്നു", "step3": "ഉത്തരം തയ്യാറാക്കുന്നു",
           "mic_unsupported": "വോയ്‌സ് ഇൻപുട്ടിന് Chrome അല്ലെങ്കിൽ Edge വേണം", "mic_denied": "മൈക്രോഫോൺ ആക്സസ് തടഞ്ഞിരിക്കുന്നു", "new_chat": "പുതിയ ചാറ്റ്", "nav_tooltip": "എന്നോട് ചോദിക്കൂ", "try": "ഇവ ചോദിക്കൂ", "composer": "നിങ്ങളുടെ ക്ഷേത്ര ഡാറ്റയെക്കുറിച്ച് എന്തും ചോദിക്കൂ"},
    "te": {"listening": "వింటున్నాను... ఇప్పుడు మాట్లాడండి", "speak": "మాట్లాడండి", "stop": "ఆపండి", "send": "పంపండి", "step1": "మీ ప్రశ్నను అర్థం చేసుకుంటున్నాను", "step2": "డేటా కోసం వెతుకుతున్నాను", "step3": "సమాధానం సిద్ధం చేస్తున్నాను",
           "mic_unsupported": "వాయిస్ ఇన్‌పుట్‌కు Chrome లేదా Edge కావాలి", "mic_denied": "మైక్రోఫోన్ యాక్సెస్ నిరోధించబడింది", "new_chat": "కొత్త చాట్", "nav_tooltip": "నన్ను అడగండి", "try": "వీటిని అడగండి", "composer": "మీ ఆలయ డేటా గురించి ఏదైనా అడగండి"},
}
for _l, _c in _CHAT_CAPTIONS.items():
    CAPTIONS[_l].update(_c)

LANG_NAMES = {"en": "English", "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam", "te": "Telugu"}

# Business rules the model must follow; trained as documentation.
RULES = (
    "This is a SQL Server 2014 database of a temple trust. Use only T-SQL valid on SQL Server 2014 "
    "(no STRING_AGG, no TRIM, use TOP not LIMIT). Never write to the database. "
    "Master tables have an ID 0 / code '-' placeholder row meaning 'none': exclude it. "
    "Flags are char(1) 'Y'/'N'. Seva entries are in TrnHdrSEVA (with dates in TrnDtlSevaDates), donations in "
    "TrnHdrDONREC, hall bookings in TrnHdrHB, payment vouchers TrnHdrPMTVCH, receipt vouchers TrnHdrRCPTVCH. "
    "Prefer the *DispName / *CodeClean computed columns only for display."
)
EXAMPLES = [
    ("What are the total sevas created this month?",
     "SELECT COUNT(*) AS total_sevas FROM TrnHdrSEVA WHERE YEAR(SevaDate)=YEAR(GETDATE()) AND MONTH(SevaDate)=MONTH(GETDATE())"),
]

_lock = threading.Lock()
_vn = None


# --------------------------------------------------------------------------- model
def _build_class():
    from vanna.chromadb import ChromaDB_VectorStore
    from vanna.hf import Hf

    class LocalVanna(ChromaDB_VectorStore, Hf):
        def __init__(self, config=None):
            ChromaDB_VectorStore.__init__(self, config=config)  # sets self.config first (Hf reads it)
            Hf.__init__(self, config=config)

        def submit_prompt(self, prompt, **kwargs) -> str:
            # Vanna's stock Hf samples at temperature 1 - wrong for SQL. Greedy decoding instead.
            ids = self.tokenizer.apply_chat_template(prompt, add_generation_prompt=True, return_tensors="pt").to(self.model.device)
            out = self.model.generate(ids, max_new_tokens=400, do_sample=False, eos_token_id=self.tokenizer.eos_token_id)
            return self.tokenizer.decode(out[0][ids.shape[-1]:], skip_special_tokens=True)

    return LocalVanna


def _store_path() -> str:
    p = Path(get_settings().ask_store_dir)
    if not p.is_absolute():
        p = Path(__file__).resolve().parents[2] / p
    return str(p)


def get_vanna():
    global _vn
    with _lock:
        if _vn is None:
            cfg = {"model_name_or_path": get_settings().ask_hf_model, "path": _store_path()}
            _vn = _build_class()(config=cfg)
            if not _vn.get_training_data().shape[0]:
                _train(_vn)
        return _vn


def _train(vn) -> int:
    """Teach the store the schema (read live from the connected DB), the rules and sample Q/SQL pairs."""
    n = 0
    sql = (
        "SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS c "
        "JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE' "
        "WHERE c.TABLE_NAME LIKE 'Mst%' OR c.TABLE_NAME LIKE 'Trn%' ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION"
    )
    tables: dict[str, list[str]] = {}
    with get_engine().connect() as c:
        for t, col, typ in c.execute(text(sql)):
            if str(t).lower() in guard.BLOCKED_TABLES:
                continue
            tables.setdefault(t, []).append(f"  {col} {typ}")
    for t, cols in tables.items():
        vn.train(ddl=f"CREATE TABLE {t} (\n" + ",\n".join(cols) + "\n)")
        n += 1
    vn.train(documentation=RULES)
    for q, s in EXAMPLES:
        vn.train(question=q, sql=s)
    return n


def retrain() -> int:
    vn = get_vanna()
    for _, row in vn.get_training_data().iterrows():
        vn.remove_training_data(id=row["id"])
    return _train(vn)


# --------------------------------------------------------------------------- results
def _jsonable(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, bytes):
        return v.hex()
    return v


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def choose_chart(columns: list[str], rows: list[list]) -> str:
    if not rows:
        return "table"
    if len(rows) == 1 and len(columns) == 1 and _is_num(rows[0][0]):
        return "kpi"
    if len(rows) < 2:
        return "table"
    if len(columns) == 2 and _is_num(rows[0][1]) and not _is_num(rows[0][0]):
        first = str(rows[0][0])
        if len(first) >= 7 and first[:4].isdigit() and first[4] == "-":
            return "line"
        return "pie" if len(rows) <= 6 else "bar"
    if len(columns) == 2 and _is_num(rows[0][1]) and _is_num(rows[0][0]) and len(rows) > 2:
        return "line"
    return "table"


def run_select(conn: Connection, sql: str, params: dict | None = None) -> tuple[list[str], list[list]]:
    safe = guard.validate(sql)
    res = conn.execute(text(safe), params or {})
    cols = list(res.keys())
    rows = [[_jsonable(v) for v in r] for r in res.fetchmany(guard.MAX_ROWS)]  # cap at fetch time (ORDER BY can't sit in a derived table)
    return cols, rows


def _answer(question: str, columns: list[str], rows: list[list], lang: str) -> str:
    if not rows:
        return "No data found."
    if len(rows) == 1 and len(columns) == 1:
        return f"{columns[0].replace('_', ' ')}: {rows[0][0]}"
    if len(rows) == 1:
        return ", ".join(f"{c.replace('_', ' ')}: {v}" for c, v in zip(columns, rows[0]))
    return f"{len(rows)} rows"


# --------------------------------------------------------------------------- history
def available() -> bool:
    return capabilities.has_table(HISTORY_TABLE)


_PARAM_TAG = "\n-- params: "


def _embed(sql: str | None, params: dict | None) -> str | None:
    """History stores one text column (no extra columns): bound dates ride along as a trailing '-- params:' comment."""
    if not sql or not params:
        return sql
    import json
    return sql + _PARAM_TAG + json.dumps({k: str(v) for k, v in params.items()})


def _split(stored: str) -> tuple[str, dict]:
    import json
    i = stored.rfind(_PARAM_TAG)
    if i < 0:
        return stored, {}
    return stored[:i], {k: dt.date.fromisoformat(v) for k, v in json.loads(stored[i + len(_PARAM_TAG):]).items()}


def _save(conn: Connection, user: str, lang: str, q: str, sql: str | None, chart: str | None, n: int | None, ans: str | None, status: str, params: dict | None = None) -> int:
    row = conn.execute(
        text(
            f"INSERT INTO {HISTORY_TABLE} (UserCode, Lang, Question, GeneratedSql, ChartType, [RowCount], AnswerText, Status) "
            "OUTPUT INSERTED.ID VALUES (:u, :l, :q, :s, :c, :n, :a, :st)"
        ),
        {"u": user, "l": lang, "q": q[:1000], "s": _embed(sql, params), "c": chart, "n": n, "a": ans, "st": status},
    ).first()
    conn.commit()
    return int(row[0])


def _period_label(tpl: dict | None, lang: str) -> str:
    """'This financial year (01/04/2026 - 31/03/2027)'; empty when the answer is not date-filtered."""
    if not tpl or not tpl.get("dated"):
        return ""
    name = ask_templates.PERIOD_LABELS.get(lang, ask_templates.PERIOD_LABELS["en"]).get(tpl["period"], "")
    rng = tpl.get("range")
    if not rng:
        return name
    last = rng[1] - dt.timedelta(days=1)
    dates = f"{rng[0]:%d/%m/%Y}" if last == rng[0] else f"{rng[0]:%d/%m/%Y} - {last:%d/%m/%Y}"
    return f"{name} ({dates})" if name else dates


def _catalog(conn: Connection) -> dict:
    """Seva / hall / sannidhi names (cached 5 min) so a question can name them: 'how many Archana sevas'."""
    from app.core import cache

    def load() -> dict:
        def q(sql: str) -> list[tuple[int, str]]:
            return [(int(r[0]), str(r[1])) for r in conn.execute(text(sql)).all() if r[1]]

        return {
            "sevas": q("SELECT SVAID, SVANAME FROM MstSVA WHERE SVAID <> 0 AND ISNULL(InActive, 'N') <> 'Y'"),
            "halls": q("SELECT HALLID, HALLNAME FROM MstHALL WHERE HALLID <> 0 AND ISNULL(InActive, 'N') <> 'Y'"),
            "sannidhis": q("SELECT SANNIDHIID, SANNIDHINAME FROM MstSANNIDHI WHERE SANNIDHIID <> 0 AND ISNULL(InActive, 'N') <> 'Y'"),
        }

    try:
        return cache.get_or_set(("askcat",), 300, load)
    except Exception:  # noqa: BLE001 - a missing master table must not break asking
        return {}


def user_fy(conn: Connection, fin_year_id: int | None) -> tuple[dt.date, dt.date] | None:
    """The user's working financial year (JWT claim), else the active one; None if MstCompFinYear is unusable."""
    from app.core import fy as fy_mod

    try:
        f = fy_mod.get_fy_by_id(conn, fin_year_id) if fin_year_id else fy_mod.get_active_fy(conn)
        return f.start_date, f.end_date
    except Exception:  # noqa: BLE001 - fall back to the calendar-derived April-March year
        return None


def ask(conn: Connection, *, question: str, lang: str, user: str, fy: tuple[dt.date, dt.date] | None = None) -> dict:
    lang = lang if lang in LANG_NAMES else "en"
    q = question.strip()
    sql, params, source = None, {}, "template"
    tpl = ask_templates.build(q, fy=fy, catalog=_catalog(conn))
    try:
        if tpl:
            sql, params = tpl["sql"], tpl["params"]
        elif get_settings().ask_llm_fallback:
            source = "model"
            prompt = q if lang == "en" else f"{q}\n(The question is in {LANG_NAMES[lang]}; write the SQL in T-SQL.)"
            sql = get_vanna().generate_sql(prompt, allow_llm_to_see_data=False)
        else:
            msg = {"en": "I could not match that question. Try one of these:"}.get(lang, "I could not match that question. Try one of these:")
            hid = _save(conn, user, lang, q, None, None, None, msg, "nomatch")
            return {"id": hid, "status": "nomatch", "error": msg, "suggestions": ask_templates.suggestions(lang),
                    "sql": None, "columns": [], "rows": [], "chart": "table", "answer": ""}
        cols, rows = run_select(conn, sql, params)
    except Exception as e:  # noqa: BLE001 - report any failure to the user, keep it in history
        log.warning("ask_data failed: %s", e)
        hid = _save(conn, user, lang, q, sql, None, None, str(e)[:500], "error")
        return {"id": hid, "status": "error", "error": str(e), "sql": sql, "columns": [], "rows": [], "chart": "table", "answer": ""}
    chart = choose_chart(cols, rows)
    ans = _answer(q, cols, rows, lang)
    hid = _save(conn, user, lang, q, guard.clean_sql(sql), chart, len(rows), ans, "ok", params)
    return {"id": hid, "status": "ok", "source": source, "sql": guard.clean_sql(sql), "columns": cols, "rows": rows, "chart": chart, "answer": ans,
            "period_label": _period_label(tpl, lang), "filter_label": " · ".join(tpl["filters"]) if tpl else ""}


def history(conn: Connection, *, user: str, is_admin: bool, q: str | None, limit: int = 100) -> list[dict]:
    where, p = [], {}
    if not is_admin:
        where.append("UserCode = :u")
        p["u"] = user
    if q:
        where.append("Question LIKE :q")
        p["q"] = f"%{q}%"
    sql = (
        f"SELECT TOP {int(limit)} ID, UserCode, AskedAt, Lang, Question, ChartType, [RowCount], AnswerText, Status, Rating "
        f"FROM {HISTORY_TABLE}" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY ID DESC"
    )
    return [{k: _jsonable(v) for k, v in r.items()} for r in conn.execute(text(sql), p).mappings().all()]


def get_history_row(conn: Connection, hid: int) -> dict | None:
    r = conn.execute(text(f"SELECT ID, UserCode, Question, GeneratedSql, Lang FROM {HISTORY_TABLE} WHERE ID = :i"), {"i": hid}).mappings().first()
    return dict(r) if r else None


def rerun(conn: Connection, hid: int) -> dict:
    r = get_history_row(conn, hid)
    if not r or not r["GeneratedSql"]:
        raise LookupError("History entry not found")
    sql, params = _split(r["GeneratedSql"])
    cols, rows = run_select(conn, sql, params)
    label = f"{params['d1']:%d/%m/%Y} - {(params['d2'] - dt.timedelta(days=1)):%d/%m/%Y}" if "d1" in params and "d2" in params else ""
    return {"id": hid, "status": "ok", "sql": sql, "columns": cols, "rows": rows, "period_label": label,
            "chart": choose_chart(cols, rows), "answer": _answer(r["Question"], cols, rows, r["Lang"] or "en")}


def delete(conn: Connection, hid: int) -> None:
    conn.execute(text(f"DELETE FROM {HISTORY_TABLE} WHERE ID = :i"), {"i": hid})
    conn.commit()


def feedback(conn: Connection, hid: int, rating: int, corrected_sql: str | None = None) -> None:
    """👍 (1) trains the question->SQL pair; 👎 (0) just records it; a corrected SQL is validated, then trained."""
    r = get_history_row(conn, hid)
    if not r:
        raise LookupError("History entry not found")
    conn.execute(text(f"UPDATE {HISTORY_TABLE} SET Rating = :r WHERE ID = :i"), {"r": 1 if rating else 0, "i": hid})
    conn.commit()
    if not get_settings().ask_llm_fallback:
        return  # nothing to teach: template answers are curated, the model is not loaded
    sql = guard.validate(corrected_sql) if corrected_sql else (_split(r["GeneratedSql"])[0] if rating else None)
    if sql:
        get_vanna().train(question=r["Question"], sql=sql)
