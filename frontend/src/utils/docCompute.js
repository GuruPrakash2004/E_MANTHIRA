import { evaluate, FormulaError } from './formulas.js'

/**
 * Doc Designer formulas (`UtlDocDsgrFlds.FldFormula`) for a document, evaluated with the shared engine in
 * ./formulas.js (same grammar and vectors as backend app/utils/formulas.py). Mirrors `compute_formulas` /
 * `apply_computed` in backend app/meta/doc_rules.py, which re-computes them on save.
 */
const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''
const formulaOf = (f) => {
  const t = String(f.FldFormula || '').trim().replace(/^=/, '').trim()
  return t === '\\' ? '' : t // a lone backslash is the Designer's "no formula" marker
}

/** Detail columns keyed by FldCode, for SVTCOLSUM. `extra` maps another name (a grid position such as "5") to a code. */
export function columnsFromLines(lines, extra = {}) {
  const cols = {}
  for (const line of lines) for (const [k, v] of Object.entries(line)) (cols[k] ||= []).push(v)
  for (const [name, code] of Object.entries(extra)) cols[name] = cols[code] || []
  return cols
}

/** { FldCode: number | string } for every Header/Footer/Total formula that can be evaluated. */
export function computeFormulas(fields, values, columns = {}, { userCode = '', aliases = {}, sections = ['Header', 'Footer', 'Total'] } = {}) {
  const pending = []
  for (const f of fields) {
    const text = formulaOf(f)
    if (!text || !sections.includes(f.FldSection || 'Header')) continue
    // an editable field the user filled in keeps their value (legacy: they overtype the calculated one)
    if (f.FldBlnReadOnly !== 'Y' && !isBlank(values[f.FldCode])) continue
    pending.push([f.FldCode, text])
  }
  const fieldsMap = { ...values, SVTUSERCODE: userCode }
  for (const [name, code] of Object.entries(aliases)) fieldsMap[name] = fieldsMap[code]
  const out = {}
  for (let i = 0; i <= pending.length; i += 1) {
    let changed = false
    for (const [code, text] of pending) {
      let res
      if (text.toUpperCase() === '#SVTUSERCODE#') res = userCode
      else {
        try {
          res = evaluate(text, { ...fieldsMap, ...out }, columns)
        } catch (e) {
          if (e instanceof FormulaError) continue
          throw e
        }
      }
      if (out[code] !== res) {
        out[code] = res
        changed = true
        for (const [name, c] of Object.entries(aliases)) if (c === code) fieldsMap[name] = res
      }
    }
    if (!changed) break
  }
  return out
}

/** Values to show: a read-only field takes its formula's result; an editable one only when still blank. */
export function withComputed(fields, values, computed) {
  const ro = Object.fromEntries(fields.map((f) => [f.FldCode, f.FldBlnReadOnly === 'Y']))
  const out = { ...values }
  for (const [code, res] of Object.entries(computed || {})) if (ro[code] || isBlank(out[code])) out[code] = res
  return out
}
