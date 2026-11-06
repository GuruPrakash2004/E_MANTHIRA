/**
 * Evaluates the legacy UtlDocDsgrFlds "hide when" / "mandatory when"
 * mini-conditions — the same `#FIELD# operator value` mini-language
 * `svtModule.fnEvaluate` interprets (CLAUDE.md §9: "Formulas... evaluated by
 * our safe evaluator, never sent to SQL Server"). `codeValues` maps the
 * legacy FldCode (e.g. "PAYMENT") to the field's CURRENT raw value from the
 * screen's own form state — screens keep their existing internal state
 * shape and just supply this small lookup, rather than being rewritten to
 * key state by FldCode throughout.
 */
function compare(actual, operator, target) {
  const a = String(actual ?? '').trim().toUpperCase()
  const t = String(target ?? '').trim().toUpperCase()
  switch ((operator || '').trim()) {
    case '=':
      return a === t
    case '<>':
      return a !== t
    case '>':
      return Number(a) > Number(t)
    case '<':
      return Number(a) < Number(t)
    case '>=':
      return Number(a) >= Number(t)
    case '<=':
      return Number(a) <= Number(t)
    default:
      return false
  }
}

/** compareVal is like "#PAYMENT#" — pull out the FldCode it references. */
function fieldCodeFromRef(compareVal) {
  const m = /^#(.+)#$/.exec((compareVal || '').trim())
  return m ? m[1] : null
}

// The Designer stored some references with typos (DocID 1261 uses #PAYMNETMODE#); map them to the real code
// so the rule still works. Mirrors backend app/meta/doc_rules.py CODE_ALIASES.
const CODE_ALIASES = { PAYMNETMODE: 'PAYMNTMODE' }

function evalCondition(compareVal, operator, withVal, codeValues) {
  const raw = fieldCodeFromRef(compareVal)
  if (!raw) return false
  const code = CODE_ALIASES[raw] || raw
  return compare(codeValues[code], operator, withVal)
}

/** The FldCodes a designer text refers to as `#CODE#` (combo filters, pick-up queries) */
export function referencedCodes(text) {
  return [...String(text || '').matchAll(/#([A-Za-z0-9_]+)#/g)].map((m) => m[1])
}

/**
 * The fields a combo's list depends on: the `#CODE#` references in its designer filter, plus the one link the legacy form
 * hard-wires: a Seva list follows the chosen Sannidhi (frmTrnSeva.FillSevaCombo; the backend applies MstSanSeva).
 */
export function comboDependencies(field) {
  const deps = referencedCodes(field?.FldCmbAddnlCond)
  if (field?.FldCode === 'SVAID' && !deps.includes('SANNIDHIID')) deps.push('SANNIDHIID')
  return deps
}

/** True if this designer field should be hidden right now. */
export function isFieldHidden(fieldMeta, codeValues) {
  if (!fieldMeta) return false
  if (fieldMeta.FLdBlnHide !== 'Y') return false
  // A conditional hide overrides the static Y — only hidden when the condition matches.
  if (fieldMeta.FldHideCompareVal) return evalCondition(fieldMeta.FldHideCompareVal, fieldMeta.FldHideOperator, fieldMeta.FldHideWithVal, codeValues)
  return true
}

/** True if this designer field is mandatory right now. */
export function isFieldMandatory(fieldMeta, codeValues) {
  if (!fieldMeta) return false
  if (fieldMeta.FldMndtryCompareVal) return evalCondition(fieldMeta.FldMndtryCompareVal, fieldMeta.FldMndtryOperator, fieldMeta.FldMndtryWithVal, codeValues)
  return fieldMeta.FldBlnMandatory === 'Y'
}

export function fieldCaption(fieldMeta, fallback) {
  return fieldMeta?.FldCaption || fallback
}

/**
 * The legacy Designer's "String/Number List" field (`FldNumStringListContent`,
 * pipe-delimited, e.g. "CASH|CARD|CHEQUE|UPI") — this IS how fields like
 * Seva/Donation's Payment Mode are actually configured in `UtlDocDsgrFlds`
 * (CLAUDE.md rule 5: don't hard-code a dropdown list that exists in these
 * tables). `fallback` is only used when the field has no metadata yet (e.g.
 * still loading) so a screen never regresses to showing nothing.
 */
export function fieldListOptions(fieldMeta, fallback) {
  const raw = fieldMeta?.FldNumStringListContent
  if (!raw) return fallback
  const options = raw.split('|').map((s) => s.trim()).filter(Boolean)
  return options.length ? options : fallback
}

/**
 * The legacy Designer's static default (`FldUseDefault='Y'` +
 * `FldDefStdDefault`) — e.g. Payment Mode defaults to "Cash". Only the
 * static default is implemented; the *conditional* default
 * (`FldDefBlnAgnstCond`/`FldDefCondList`) isn't — its mini-language isn't
 * confirmed, and guessing risks seeding the wrong value on a real document.
 */
export function fieldDefault(fieldMeta) {
  if (!fieldMeta) return undefined
  if (fieldMeta.FldUseDefault !== 'Y') return undefined
  const def = fieldMeta.FldDefStdDefault
  return def ? def.trim() : undefined
}

// ---------------------------------------------------------------- Designer presentation / input rules

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '')

/** Applies the Designer's text rules to what the user typed: string type (alphabets / numbers / alphanumeric), the
 * "do not allow" characters, and the case setting (UPPER / lower / Title / Sentence). */
export function applyTextRules(field, raw) {
  let v = String(raw ?? '')
  const type = norm(field.FldTxtStringType)
  if (type.includes('ALPHA') && type.includes('NUM')) v = v.replace(/[^A-Za-z0-9 ]/g, '')
  else if (type.includes('ALPHA')) v = v.replace(/[^A-Za-z ]/g, '')
  else if (type.includes('NUM')) v = v.replace(/[^0-9]/g, '')
  const bad = field.FldTxtBlnDoNotAllowChk === 'Y' ? String(field.FldTxtDoNotAllowChars || '') : ''
  if (bad && bad !== 'N') v = [...v].filter((c) => !bad.includes(c)).join('')
  const c = norm(field.FldTxtCase)
  if (c.startsWith('UPPER')) v = v.toUpperCase()
  else if (c.startsWith('LOWER')) v = v.toLowerCase()
  else if (c.startsWith('TITLE')) v = v.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase())
  else if (c.startsWith('SENTENCE')) v = v.toLowerCase().replace(/^(\s*)(\S)/, (_, a, b) => a + b.toUpperCase())
  return v
}

/** Left / Right / Center text alignment of the Designer field ('' when unset). */
export function inputAlignment(field) {
  const a = String(field.FldTxtAlignment || '').trim().toLowerCase()
  return a === 'right' || a === 'center' ? a : ''
}

const OP_BOUND = { '>': 'min', '>=': 'min', '<': 'max', '<=': 'max' }

/** Number rules: negatives allowed? and the from / to range (FldNumBlnRange + operators/values). */
export function numberBounds(field) {
  const out = { allowNegative: field.FldNumBlnAllowNegative === 'Y', min: undefined, max: undefined }
  if (field.FldNumBlnRange === 'Y') {
    for (const [chk, op, val] of [
      ['FldNumBlnRangeFromChk', 'FldNumRangeFromOperator', 'FldNumRangeFromValue'],
      ['FldNumBlnRangeToChk', 'FldNumRangeToOperator', 'FldNumRangeToValue'],
    ]) {
      const kind = OP_BOUND[String(field[op] || '').trim()]
      const n = Number(field[val])
      if (field[chk] === 'Y' && kind && Number.isFinite(n) && String(field[val] ?? '').trim() !== '') out[kind] = n
    }
  }
  if (!out.allowNegative && (out.min === undefined || out.min < 0)) out.min = 0
  return out
}

/** Date rules: an explicit from / to range (FldDtBlnRange + FldDtRangeFrom/ToValue). */
export function dateBounds(field) {
  const out = { minDate: undefined, maxDate: undefined }
  if (field.FldDtBlnRange === 'Y') {
    const from = field.FldDtBlnRangeFrom === 'Y' && field.FldDtRangeFromValue ? new Date(field.FldDtRangeFromValue) : null
    const to = field.FldDtBlnRangeTo === 'Y' && field.FldDtRangeToValue ? new Date(field.FldDtRangeToValue) : null
    if (from && !Number.isNaN(from.getTime())) out.minDate = from
    if (to && !Number.isNaN(to.getTime())) out.maxDate = to
  }
  return out
}

/** Conditional read-only (`FldROCompareVal` / `FldROOperator` / `FldROWithVal`), e.g. "read-only unless Payment = Cheque". */
export function isReadOnlyByCondition(fieldMeta, codeValues) {
  if (!fieldMeta || !fieldMeta.FldROCompareVal) return false
  return evalCondition(fieldMeta.FldROCompareVal, fieldMeta.FldROOperator, fieldMeta.FldROWithVal, codeValues)
}
