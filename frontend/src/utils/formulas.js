// Doc Designer formula evaluator - same grammar as backend/app/utils/formulas.py.
//   expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)*
//   unary := ('-'|'+') unary | atom
//   atom := NUMBER | #FIELD# | '(' expr ')' | FUNC '(' args ')'
//   FUNC := SVTCOLSUM | SVTROUND50 (whole rupee, half up) | SVTROUND2 (2dp) | SVTAMTINWORDS
// Arithmetic is exact (BigInt rationals) so rounding matches the backend's Decimal.
// Returns a Number, or a string for SVTAMTINWORDS. Throws FormulaError on bad input.
import amountInWords from "./amountInWords.js";

export class FormulaError extends Error {}

const FUNCS = new Set(["SVTCOLSUM", "SVTROUND50", "SVTROUND2", "SVTAMTINWORDS"]);
const DIGITS = "0123456789";

// ---- rationals {n, d} with d > 0 ----
const babs = (a) => (a < 0n ? -a : a);
const gcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a || 1n; };
const rat = (n, d = 1n) => {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const ZERO = rat(0n);

function parseDec(s) {
  const m = /^([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) return null;
  const frac = m[2] || "";
  let r = rat(BigInt((m[1] || "0") + frac), 10n ** BigInt(frac.length));
  if (m[3]) {
    const e = parseInt(m[3], 10);
    r = e >= 0 ? rat(r.n * 10n ** BigInt(e), r.d) : rat(r.n, r.d * 10n ** BigInt(-e));
  }
  return r;
}

function toRat(v) {
  if (v === null || v === undefined) return ZERO;
  let s = String(v).trim().replace(/,/g, "");
  if (s === "") return ZERO;
  let neg = false;
  if (s[0] === "-") { neg = true; s = s.slice(1); } else if (s[0] === "+") s = s.slice(1);
  const r = parseDec(s);
  if (!r) return ZERO;
  return neg ? rat(-r.n, r.d) : r;
}

const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => (b.n === 0n ? ZERO : rat(a.n * b.d, a.d * b.n));

// round(a * 10^dp) half up (away from zero for exact .5, like Decimal ROUND_HALF_UP)
function roundHalfUp(a, dp) {
  const scale = 10n ** BigInt(dp);
  const num = babs(a.n) * scale * 2n + a.d; // floor(|x|*scale + 1/2) = floor((2|n|s + d) / 2d)
  const q = num / (2n * a.d);
  return rat(a.n < 0n ? -q : q, scale);
}

const toNumber = (a) => Number(a.n) / Number(a.d);
const toFixedStr = (a) => {
  // exact decimal string for rationals with power-of-ten denominators (rounded results)
  return toNumber(a);
};

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") {
      const j = src.indexOf("#", i + 1);
      if (j < 0) throw new FormulaError("unterminated #FIELD#");
      const name = src.slice(i + 1, j).trim();
      if (!name) throw new FormulaError("empty #FIELD#");
      toks.push(["FLD", name]);
      i = j + 1;
    } else if (DIGITS.includes(c) || (c === "." && i + 1 < n && DIGITS.includes(src[i + 1]))) {
      let j = i;
      while (j < n && (DIGITS.includes(src[j]) || src[j] === ".")) j++;
      toks.push(["NUM", src.slice(i, j)]);
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push(["ID", src.slice(i, j)]);
      i = j;
    } else if ("+-*/(),".includes(c)) {
      toks.push([c, c]);
      i++;
    } else {
      throw new FormulaError(`unexpected character '${c}'`);
    }
  }
  return toks;
}

function lookup(m, name) {
  if (Object.prototype.hasOwnProperty.call(m, name)) return m[name];
  const up = name.toUpperCase();
  for (const k of Object.keys(m)) if (k.toUpperCase() === up) return m[k];
  return undefined;
}

const val = (v) => {
  if (typeof v === "string") throw new FormulaError("text result used in arithmetic");
  return v;
};

class Parser {
  constructor(toks, fields, cols) { this.t = toks; this.p = 0; this.f = fields; this.c = cols; }
  peek() { return this.p < this.t.length ? this.t[this.p][0] : null; }
  eat(kind) {
    if (this.p >= this.t.length || (kind && this.t[this.p][0] !== kind)) {
      throw new FormulaError(`expected ${kind || "token"}`);
    }
    return this.t[this.p++];
  }
  expr() {
    let v = this.term();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.eat()[0];
      const r = val(this.term());
      v = op === "+" ? add(val(v), r) : sub(val(v), r);
    }
    return v;
  }
  term() {
    let v = this.unary();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.eat()[0];
      const r = val(this.unary());
      v = op === "*" ? mul(val(v), r) : div(val(v), r);
    }
    return v;
  }
  unary() {
    if (this.peek() === "-" || this.peek() === "+") {
      const op = this.eat()[0];
      const v = val(this.unary());
      return op === "-" ? rat(-v.n, v.d) : v;
    }
    return this.atom();
  }
  atom() {
    const k = this.peek();
    if (k === "NUM") {
      const r = parseDec(this.eat()[1]);
      if (!r) throw new FormulaError("bad number");
      return r;
    }
    if (k === "FLD") return toRat(lookup(this.f, this.eat()[1]));
    if (k === "(") { this.eat(); const v = this.expr(); this.eat(")"); return v; }
    if (k === "ID") {
      const name = this.eat()[1].toUpperCase();
      if (!FUNCS.has(name)) throw new FormulaError(`unknown function ${name}`);
      this.eat("(");
      if (name === "SVTCOLSUM") {
        const t = this.eat();
        if (t[0] !== "FLD" && t[0] !== "ID") throw new FormulaError("SVTCOLSUM needs a column name");
        this.eat(")");
        const list = lookup(this.c, t[1]) || [];
        return list.reduce((s, x) => add(s, toRat(x)), ZERO);
      }
      const v = val(this.expr());
      this.eat(")");
      if (name === "SVTROUND50") return roundHalfUp(v, 0);
      if (name === "SVTROUND2") return roundHalfUp(v, 2);
      return amountInWords(toNumber(v));
    }
    throw new FormulaError("unexpected end or token");
  }
}

export function evaluate(formula, fields = {}, columns = {}) {
  let src = String(formula ?? "").trim();
  if (src.startsWith("=")) src = src.slice(1);
  const toks = tokenize(src);
  if (!toks.length) throw new FormulaError("empty formula");
  const ps = new Parser(toks, fields || {}, columns || {});
  const v = ps.expr();
  if (ps.p !== toks.length) throw new FormulaError("trailing tokens");
  return typeof v === "string" ? v : toFixedStr(v);
}

export default evaluate;
