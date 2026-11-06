"""
Safety gate for model-generated SQL ("Ask the Data").

Only a single read-only SELECT (optionally a WITH ... SELECT) is ever allowed to
reach the database. The model's output is treated as untrusted text.
"""
from __future__ import annotations

import re

MAX_ROWS = 1000

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|deny|"
    r"backup|restore|shutdown|reconfigure|openrowset|openquery|opendatasource|bulk|waitfor|dbcc|use|into)\b",
    re.IGNORECASE,
)
_FORBIDDEN_PREFIX = re.compile(r"\b(xp_|sp_|fn_)\w*", re.IGNORECASE)
# Tables the assistant must never read (credentials / secrets).
BLOCKED_TABLES = ("mstuser", "mstuserrights", "webauditlog", "webaiqueryhistory", "utlgsettings", "utlmisc")


class UnsafeSql(ValueError):
    pass


def _strip_comments_and_strings(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return re.sub(r"'(?:[^']|'')*'", "''", sql)  # string literals can't hide keywords


def clean_sql(raw: str) -> str:
    """Strip markdown fences / trailing semicolon from model output."""
    s = (raw or "").strip()
    s = re.sub(r"^```(?:sql)?", "", s, flags=re.I).strip()
    s = re.sub(r"```$", "", s).strip()
    return s.rstrip(";").strip()


def validate(sql: str) -> str:
    """Return the cleaned SQL or raise UnsafeSql."""
    s = clean_sql(sql)
    if not s:
        raise UnsafeSql("No SQL was generated")
    body = _strip_comments_and_strings(s)
    if ";" in body:
        raise UnsafeSql("Only a single statement is allowed")
    if not re.match(r"^\s*(select|with)\b", body, re.I):
        raise UnsafeSql("Only SELECT queries are allowed")
    m = _FORBIDDEN.search(body) or _FORBIDDEN_PREFIX.search(body)
    if m:
        raise UnsafeSql(f"'{m.group(0)}' is not allowed")
    low = body.lower()
    for t in BLOCKED_TABLES:
        if re.search(rf"\b{t}\b", low):
            raise UnsafeSql("That table is not available to the assistant")
    return s
