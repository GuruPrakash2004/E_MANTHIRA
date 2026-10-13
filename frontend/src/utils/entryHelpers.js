// Small helpers shared by the money-entry screens.

/** Trim, collapse repeated spaces and Title Case a person's name ("oscar  fernandas" / "MALIKARJUN" -> "Oscar Fernandas"). */
export function normaliseName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s.'-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
}

/** 'CASH' / 'cash' -> 'Cash': display label for a stored list value (values themselves are never changed). */
export const titleCase = (v) =>
  String(v || '')
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase()))) // keeps acronyms such as UPI
    .join(' ')

/** Match a default/stored value to the real list entry regardless of case ('Cash' -> 'CASH'). */
export const matchListValue = (list, value) => list.find((x) => String(x).toLowerCase() === String(value || '').toLowerCase()) || ''

/** A Mantine Select `data` array: stored value untouched, label consistently capitalised. */
export const listToOptions = (list) => list.map((v) => ({ value: v, label: titleCase(v) }))

/** 'HH:mm' (24h, from a time input) -> '7:30 AM'; fits the 10-character RMKS column. */
export function formatTiming(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return ''
  let h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m[2]} ${suffix}`
}

/** Keep digits only, capped at `max` characters (mobile numbers etc.). */
export const digitsOnly = (v, max = 10) => String(v || '').replace(/\D/g, '').slice(0, max)
