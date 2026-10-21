"""Doc Designer formula evaluator (UtlDocDsgrFlds formulas). No eval().

Grammar (mirrored exactly in frontend/src/utils/formulas.js):
    expr   := term (('+'|'-') term)*
    term   := unary (('*'|'/') unary)*
    unary  := ('-'|'+') unary | atom
    atom   := NUMBER | '#FIELD#' | '(' expr ')' | FUNC '(' args ')'
    FUNC   := SVTCOLSUM | SVTROUND50 | SVTROUND2 | SVTAMTINWORDS   (case-insensitive)
    SVTCOLSUM arg: a column name, bare or '#COL#' (sums the list in `columns`).
    SVTROUND50: whole rupee, half up. SVTROUND2: 2dp, half up.
    SVTAMTINWORDS(expr): text via utils.amount_in_words (spaces collapsed, like
    the legacy fnAmtInWords); the result is a str and cannot be used in arithmetic.
    A leading '=' is ignored. Blank/missing fields count as 0. Division by 0 -> 0.
Field names match case-insensitively.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Mapping, Sequence

from app.utils.amount_in_words import amount_in_words

FUNCS = {"SVTCOLSUM", "SVTROUND50", "SVTROUND2", "SVTAMTINWORDS"}


class FormulaError(ValueError):
    pass


def _tokenize(src: str) -> list[tuple[str, str]]:
    toks: list[tuple[str, str]] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
        elif c == "#":
            j = src.find("#", i + 1)
            if j < 0:
                raise FormulaError("unterminated #FIELD#")
            name = src[i + 1:j].strip()
            if not name:
                raise FormulaError("empty #FIELD#")
            toks.append(("FLD", name))
            i = j + 1
        elif c in "0123456789" or (c == "." and i + 1 < n and src[i + 1] in "0123456789"):
            j = i
            while j < n and src[j] in "0123456789.":
                j += 1
            toks.append(("NUM", src[i:j]))
            i = j
        elif c.isascii() and (c.isalpha() or c == "_"):
            j = i
            while j < n and src[j].isascii() and (src[j].isalnum() or src[j] == "_"):
                j += 1
            toks.append(("ID", src[i:j]))
            i = j
        elif c in "+-*/(),":
            toks.append((c, c))
            i += 1
        else:
            raise FormulaError(f"unexpected character {c!r}")
    return toks


def _num(v: Any) -> Decimal:
    if v is None:
        return Decimal(0)
    if isinstance(v, Decimal):
        return v
    s = str(v).strip().replace(",", "")
    if s == "":
        return Decimal(0)
    try:
        d = Decimal(s)
    except InvalidOperation:
        return Decimal(0)
    return d if d.is_finite() else Decimal(0)


def _lookup(m: Mapping[str, Any], name: str) -> Any:
    if name in m:
        return m[name]
    up = name.upper()
    for k, v in m.items():
        if str(k).upper() == up:
            return v
    return None


def _val(v: Any) -> Decimal:
    if isinstance(v, str):
        raise FormulaError("text result used in arithmetic")
    return v


class _Parser:
    def __init__(self, toks, fields, cols):
        self.t, self.p, self.f, self.c = toks, 0, fields, cols

    def peek(self):
        return self.t[self.p][0] if self.p < len(self.t) else None

    def eat(self, kind=None):
        if self.p >= len(self.t) or (kind and self.t[self.p][0] != kind):
            raise FormulaError(f"expected {kind or 'token'}")
        self.p += 1
        return self.t[self.p - 1]

    def expr(self):
        v = self.term()
        while self.peek() in ("+", "-"):
            op = self.eat()[0]
            r = _val(self.term())
            v = _val(v) + r if op == "+" else _val(v) - r
        return v

    def term(self):
        v = self.unary()
        while self.peek() in ("*", "/"):
            op = self.eat()[0]
            r = _val(self.unary())
            if op == "*":
                v = _val(v) * r
            else:
                v = Decimal(0) if r == 0 else _val(v) / r
        return v

    def unary(self):
        if self.peek() in ("-", "+"):
            op = self.eat()[0]
            v = _val(self.unary())
            return -v if op == "-" else v
        return self.atom()

    def atom(self):
        k = self.peek()
        if k == "NUM":
            try:
                return Decimal(self.eat()[1])
            except InvalidOperation:
                raise FormulaError("bad number")
        if k == "FLD":
            return _num(_lookup(self.f, self.eat()[1]))
        if k == "(":
            self.eat()
            v = self.expr()
            self.eat(")")
            return v
        if k == "ID":
            name = self.eat()[1].upper()
            if name not in FUNCS:
                raise FormulaError(f"unknown function {name}")
            self.eat("(")
            if name == "SVTCOLSUM":
                t = self.eat()
                if t[0] not in ("FLD", "ID"):
                    raise FormulaError("SVTCOLSUM needs a column name")
                self.eat(")")
                return sum((_num(x) for x in (_lookup(self.c, t[1]) or [])), Decimal(0))
            v = _val(self.expr())
            self.eat(")")
            if name == "SVTROUND50":
                return v.quantize(Decimal(1), rounding=ROUND_HALF_UP)
            if name == "SVTROUND2":
                return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            return amount_in_words(float(v))
        raise FormulaError("unexpected end or token")


def evaluate(formula: str, fields: Mapping[str, Any] | None = None,
             columns: Mapping[str, Sequence[Any]] | None = None):
    """Evaluate a designer formula. Returns Decimal, or str for SVTAMTINWORDS."""
    src = (formula or "").strip()
    if src.startswith("="):
        src = src[1:]
    toks = _tokenize(src)
    if not toks:
        raise FormulaError("empty formula")
    ps = _Parser(toks, fields or {}, columns or {})
    v = ps.expr()
    if ps.p != len(toks):
        raise FormulaError("trailing tokens")
    return v
