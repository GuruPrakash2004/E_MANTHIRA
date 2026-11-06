"""
Server-side evaluation of the rules a temple configured in the Doc Designer
(`UtlDocDsgrFlds`) — the same hide / mandatory / default / list rules the
browser applies, re-checked here so a save can never bypass them and no screen
needs hard-coded per-field validation (CLAUDE.md rule 5).

Conditions use the legacy mini-language `#FIELD# <op> value` (see
`frontend/src/utils/docFieldConditions.js`, which mirrors this module).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

from fastapi import HTTPException, status
from sqlalchemy import Integer, Numeric, text
from sqlalchemy.engine import Connection

# The Designer stored a few condition references with typos (e.g. DocID 1261 uses #PAYMNETMODE#).
# Mapping them to the real code keeps the rule working instead of silently never matching.
CODE_ALIASES = {"PAYMNETMODE": "PAYMNTMODE"}

_REF_RE = re.compile(r"^#(.+)#$")


def load_fields(conn: Connection, doc_id: int) -> list[dict]:
    rows = conn.execute(
        text("SELECT * FROM UtlDocDsgrFlds WHERE DocID = :d ORDER BY FldSection, FldOrderBy"), {"d": doc_id}
    ).mappings().all()
    return [dict(r) for r in rows]


def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _compare(actual: Any, operator: str, target: Any) -> bool:
    a, t = _s(actual).upper(), _s(target).upper()
    op = (operator or "").strip()
    if op == "=":
        return a == t
    if op == "<>":
        return a != t
    try:
        x, y = Decimal(a or "0"), Decimal(t or "0")
    except InvalidOperation:
        return False
    return {">": x > y, "<": x < y, ">=": x >= y, "<=": x <= y}.get(op, False)


def _cond(compare_val: Any, operator: Any, with_val: Any, values: Mapping[str, Any]) -> bool:
    m = _REF_RE.match(_s(compare_val))
    if not m:
        return False
    code = CODE_ALIASES.get(m.group(1), m.group(1))
    return _compare(values.get(code), _s(operator), with_val)


def is_hidden(row: Mapping, values: Mapping[str, Any]) -> bool:
    if _s(row.get("FLdBlnHide")).upper() != "Y":
        return False
    if _s(row.get("FldHideCompareVal")):
        return _cond(row.get("FldHideCompareVal"), row.get("FldHideOperator"), row.get("FldHideWithVal"), values)
    return True


def is_mandatory(row: Mapping, values: Mapping[str, Any]) -> bool:
    if _s(row.get("FldMndtryCompareVal")):
        return _cond(row.get("FldMndtryCompareVal"), row.get("FldMndtryOperator"), row.get("FldMndtryWithVal"), values)
    return _s(row.get("FldBlnMandatory")).upper() == "Y"


def static_default(row: Mapping) -> str | None:
    if _s(row.get("FldUseDefault")).upper() != "Y":
        return None
    d = _s(row.get("FldDefStdDefault"))
    return d or None


def list_options(row: Mapping) -> list[str]:
    raw = _s(row.get("FldNumStringListContent"))
    return [o.strip() for o in raw.split("|") if o.strip()] if raw else []


def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _is_combo(row: Mapping) -> bool:
    return _s(row.get("FldBlnComboData")).upper() == "Y" and bool(_s(row.get("FldCmbTblName")))


def effective_values(rows: Iterable[Mapping], values: Mapping[str, Any]) -> dict[str, Any]:
    """Submitted values with the Designer's static defaults for anything left blank, and with every field the
    Designer currently hides reduced to its default (or blank) — e.g. the cheque block is empty unless the payment
    mode is Cheque, and a hidden PRASADA still stores its default "No", like the legacy form."""
    rows = list(rows)
    out = {k: v for k, v in values.items()}
    for r in rows:
        code = _s(r.get("FldCode"))
        if _blank(out.get(code)) and not _is_combo(r):  # a lookup's default is its display text; the screen resolves it to the id
            d = static_default(r)
            if d is not None:
                out[code] = d
    for r in rows:
        code = _s(r.get("FldCode"))
        if is_hidden(r, out):
            d = None if _is_combo(r) else static_default(r)
            if d is not None:
                out[code] = d
            else:
                out.pop(code, None)
    return out


def validate(rows: list[dict], values: Mapping[str, Any], *, skip: Iterable[str] = (), fy=None) -> None:
    """Raises 422 with the Designer caption for the first broken rule. `fy` (a FinancialYear) enables the Designer's
    "date within the financial year" rule."""
    skip = set(skip)
    for r in rows:
        code = _s(r.get("FldCode"))
        if code in skip or is_hidden(r, values):
            continue
        caption = _s(r.get("FldCaption")) or code
        v = values.get(code)
        if is_mandatory(r, values) and (_blank(v) or (_is_combo(r) and _s(v) in ("", "0"))):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{caption} is mandatory")
        if _blank(v):
            continue
        opts = list_options(r)
        if opts and _s(v).upper() not in {o.upper() for o in opts}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{caption}: '{_s(v)}' is not one of {', '.join(opts)}")
        _check_input_rules(r, v, caption, fy)
        width = r.get("FldDataWidth")
        if (
            isinstance(v, str)
            and _s(r.get("FldDataType")).lower() in ("text", "list string")
            and isinstance(width, (int, float))
            and 0 < width < 4000
            and len(v) > width
        ):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{caption} must be at most {int(width)} characters")


def column_values(rows: Iterable[Mapping], values: Mapping[str, Any], table_obj, aliases: Mapping[str, str] | None = None) -> dict[str, Any]:
    """FldCode -> value, typed for the real column (reflected), for every designer field that is a real column.
    Combo ids become int (0 = the legacy "none" placeholder); numeric columns get numbers; dates get dates."""
    cols = {c.name.lower(): c for c in table_obj.columns}
    out: dict[str, Any] = {}
    for r in rows:
        code = _s(r.get("FldCode"))
        col = cols.get((aliases or {}).get(code, code).lower())
        if col is None:
            continue
        v = values.get(code)
        numeric_col = isinstance(col.type, (Integer, Numeric))
        is_date = _s(r.get("FldDataType")).lower() == "date" or "date" in type(col.type).__name__.lower()
        if _blank(v):
            # DsgrModule.GetInsertString (decompiled vTemple7.exe): a blank Text / List String field is stored as ONE SPACE,
            # a blank Date as NULL, a blank Numeric as Val("") = 0.
            out[col.name] = None if is_date else (0 if numeric_col else " ")
            continue
        if is_date:
            out[col.name] = _to_date(v)
        elif numeric_col:
            try:
                out[col.name] = int(v) if isinstance(col.type, Integer) else Decimal(str(v))
            except (ValueError, InvalidOperation):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{_s(r.get('FldCaption')) or code} must be a number")
        else:
            out[col.name] = _s(v) if not isinstance(v, (int, float)) else str(v)
    return out


def _to_date(v: Any) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = _s(v)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Invalid date '{s}'")


def header_columns(conn, doc_id: int, table_name: str, fields: Mapping[str, Any], *, computed: Iterable[str] = (),
                   sections: Iterable[str] = ("Header", "Footer"), aliases: Mapping[str, str] | None = None, fy=None) -> tuple[dict, dict]:
    """Load the document's Designer rows, apply defaults / hide rules, enforce the Designer's mandatory / list / width
    rules, and return (columns for the header insert, effective values keyed by FldCode)."""
    from app.legacy.tables import table

    rows = load_fields(conn, doc_id)
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "This document has no fields configured in the Doc Designer")
    computed = set(computed)
    values = effective_values(rows, {k: v for k, v in (fields or {}).items() if k not in computed})
    sections = set(sections)
    head = [r for r in rows if (r.get("FldSection") or "Header") in sections]
    validate(head, values, skip=computed, fy=fy)
    return column_values(head, values, table(table_name), aliases), values


# ---------------------------------------------------------------- formulas (FldFormula)

def _formula_text(row: Mapping) -> str:
    f = _s(row.get("FldFormula")).lstrip("=").strip()
    return "" if f in ("", "\\") else f  # a lone backslash is the Designer's "no formula" marker


def columns_from_lines(lines: Iterable[Mapping], extra: Mapping[str, str] | None = None) -> dict[str, list]:
    """Detail columns keyed by FldCode for SVTCOLSUM; `extra` maps another name (e.g. a grid position "5") to a code."""
    cols: dict[str, list] = {}
    for line in lines:
        for k, v in line.items():
            cols.setdefault(k, []).append(v)
    for name, code in (extra or {}).items():
        cols[name] = cols.get(code, [])
    return cols


def compute_formulas(rows: Iterable[Mapping], values: Mapping[str, Any], columns: Mapping[str, list] | None = None, *,
                     user_code: str = "", aliases: Mapping[str, str] | None = None,
                     sections: Iterable[str] = ("Header", "Footer", "Total")) -> dict[str, Any]:
    """Evaluate the Designer's header/footer/total formulas (`SVTCOLSUM`, `SVTAMTINWORDS`, arithmetic over #FIELD#s,
    `#SVTUSERCODE#`) with the shared engine in `app.utils.formulas`. Returns {FldCode: Decimal | str}. A formula that
    can't be evaluated is skipped. `aliases` maps a column name used inside formulas to its FldCode (e.g. CGSTAMT->CGST)."""
    from app.utils.formulas import FormulaError, evaluate

    sections = set(sections)
    pending = []
    for r in rows:
        code, f = _s(r.get("FldCode")), _formula_text(r)
        if not f or (r.get("FldSection") or "Header") not in sections:
            continue
        # an editable field the user filled in keeps their value (legacy: they overtype the calculated one)
        if _s(r.get("FldBlnReadOnly")).upper() != "Y" and not _blank(values.get(code)):
            continue
        pending.append((code, f))
    fields: dict[str, Any] = {k: v for k, v in values.items()}
    fields["SVTUSERCODE"] = user_code
    for name, code in (aliases or {}).items():
        fields[name] = fields.get(code)
    out: dict[str, Any] = {}
    for _ in range(len(pending) + 1):  # a formula may use another formula's result: repeat until stable
        changed = False
        for code, f in pending:
            if f.upper() == "#SVTUSERCODE#":
                res: Any = user_code
            else:
                try:
                    res = evaluate(f, {**fields, **out}, columns or {})
                except FormulaError:
                    continue
            if out.get(code) != res:
                out[code] = res
                changed = True
                for name, c in (aliases or {}).items():
                    if c == code:
                        fields[name] = res
        if not changed:
            break
    return out


def apply_computed(rows: Iterable[Mapping], values: dict[str, Any], computed: Mapping[str, Any]) -> dict[str, Any]:
    """Merge formula results into `values`: a read-only field always takes the formula's result; an editable one keeps
    what the user typed and only falls back to the formula when it was left blank (the legacy form recalculates, the
    user can then overtype)."""
    ro = {_s(r.get("FldCode")): _s(r.get("FldBlnReadOnly")).upper() == "Y" for r in rows}
    out = dict(values)
    for code, res in computed.items():
        if ro.get(code) or _blank(out.get(code)):
            out[code] = res
    return out


# ---------------------------------------------------------------- input rules (string type, characters, number / date ranges)

def _norm(v: Any) -> str:
    return re.sub(r"[^A-Z]", "", _s(v).upper())


def _check_input_rules(r: Mapping, v: Any, caption: str, fy=None) -> None:
    """The Designer's per-field input restrictions, re-checked on save: alphabets / numbers / alphanumeric only,
    disallowed characters, negative numbers, a numeric from / to range, a date from / to range."""
    bad_request = lambda msg: HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{caption} {msg}")  # noqa: E731
    dtype = _s(r.get("FldDataType")).lower()
    if dtype in ("text", "list string") and isinstance(v, str):
        st = _norm(r.get("FldTxtStringType"))
        if "ALPHA" in st and "NUM" in st and not re.fullmatch(r"[A-Za-z0-9 ]*", v):
            raise bad_request("allows letters and digits only")
        if "ALPHA" in st and "NUM" not in st and not re.fullmatch(r"[A-Za-z ]*", v):
            raise bad_request("allows letters only")
        if "NUM" in st and "ALPHA" not in st and not re.fullmatch(r"[0-9]*", v):
            raise bad_request("allows digits only")
        bad = _s(r.get("FldTxtDoNotAllowChars")) if _s(r.get("FldTxtBlnDoNotAllowChk")).upper() == "Y" else ""
        if bad and bad != "N" and any(c in bad for c in v):
            raise bad_request(f"must not contain any of: {bad}")
    elif dtype == "numeric" and not _is_combo(r):
        try:
            n = Decimal(_s(v))
        except InvalidOperation:
            return
        if n < 0 and _s(r.get("FldNumBlnAllowNegative")).upper() != "Y":
            raise bad_request("cannot be negative")
        if _s(r.get("FldNumBlnRange")).upper() == "Y":
            for chk, op, val in (("FldNumBlnRangeFromChk", "FldNumRangeFromOperator", "FldNumRangeFromValue"),
                                 ("FldNumBlnRangeToChk", "FldNumRangeToOperator", "FldNumRangeToValue")):
                if _s(r.get(chk)).upper() == "Y" and _s(r.get(val)) and _s(r.get(op)) in (">", ">=", "<", "<="):
                    if not _compare(n, _s(r.get(op)), _s(r.get(val))):
                        raise bad_request(f"must be {_s(r.get(op))} {_s(r.get(val))}")
    elif dtype == "date":
        try:
            d = _to_date(v)
        except HTTPException:
            return
        if _s(r.get("FldDtBlnWithinFinYear")).upper() == "Y" and fy is not None and not (fy.start_date <= d <= fy.end_date):
            raise bad_request(f"must be within the financial year {fy.start_date:%d-%b-%Y} - {fy.end_date:%d-%b-%Y}")
        if _s(r.get("FldDtBlnFirstDOM")).upper() == "Y" and d.day != 1:
            raise bad_request("must be the first day of a month")
        if _s(r.get("FldDtBlnLastDOM")).upper() == "Y" and (d + timedelta(days=1)).day != 1:
            raise bad_request("must be the last day of a month")
        if _s(r.get("FldDtBlnRange")).upper() != "Y":
            return
        for flag, key, op in (("FldDtBlnRangeFrom", "FldDtRangeFromValue", ">="), ("FldDtBlnRangeTo", "FldDtRangeToValue", "<=")):
            lim = _s(r.get(key))
            if _s(r.get(flag)).upper() == "Y" and lim:
                try:
                    limit = _to_date(lim)
                except HTTPException:
                    continue
                if (op == ">=" and d < limit) or (op == "<=" and d > limit):
                    raise bad_request(f"must be on or {'after' if op == '>=' else 'before'} {limit:%d-%b-%Y}")


def check_duplicate_lines(detail_rows: Iterable[Mapping], lines: list[Mapping]) -> None:
    """`FldBlnChkDuplicate`: the same value of that Detail field may not appear on two lines of one document."""
    for r in detail_rows:
        if _s(r.get("FldBlnChkDuplicate")).upper() != "Y":
            continue
        code, seen = _s(r.get("FldCode")), set()
        for i, line in enumerate(lines, start=1):
            v = _s(line.get(code)).upper()
            if not v:
                continue
            if v in seen:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Line {i}: duplicate {_s(r.get('FldCaption')) or code} '{_s(line.get(code))}'")
            seen.add(v)
