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

function evalCondition(compareVal, operator, withVal, codeValues) {
  const code = fieldCodeFromRef(compareVal)
  if (!code) return false
  return compare(codeValues[code], operator, withVal)
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
