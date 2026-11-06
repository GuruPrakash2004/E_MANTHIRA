// Pure helpers for the Alertify popup (no React): pill templates, timings, due dates. Tested with Node.

const PILL = /<<([^<>]+)>>/g

/** "Hello <<Doc No>> x" -> [{ text:'Hello ' }, { pill:'Doc No' }, { text:' x' }] */
export function parseTemplate(text) {
  const out = []
  let last = 0
  for (const m of String(text || '').matchAll(PILL)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ pill: m[1].trim() })
    last = m.index + m[0].length
  }
  if (last < String(text || '').length) out.push({ text: text.slice(last) })
  return out
}

/**
 * Replace every <<Caption>> with that transaction's value. A pill with no value drops out (no "undefined", no double space).
 * `values` maps a caption (case-insensitive) to text; pills in `keep` stay as they are (e.g. <<Doc No>> until the bill is saved).
 */
export function resolveTemplate(text, values, keep = []) {
  const map = new Map(Object.entries(values || {}).map(([k, v]) => [k.trim().toLowerCase(), v == null ? '' : String(v).trim()]))
  const kept = new Set(keep.map((k) => k.trim().toLowerCase()))
  return String(text || '')
    .replace(PILL, (all, cap) => (kept.has(cap.trim().toLowerCase()) ? all : map.get(cap.trim().toLowerCase()) ?? ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

/** Which pills a template uses (for the "unknown pill" check). */
export const pillsIn = (text) => [...String(text || '').matchAll(PILL)].map((m) => m[1].trim())

/**
 * The time in a Seva Timing / start-time text as 24-hour 'HH:MM', or null when there is none to read.
 * Reads "6:30 AM", "06:30", "6 am", "6.30 pm", "7 to 8 AM" (the first time), "18:00 hrs".
 */
export function parseTiming(text) {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return null
  const m = s.match(/(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] != null ? Number(m[2]) : 0
  let mer = m[3] ? m[3].replace(/\./g, '') : ''
  if (!mer) {
    // "7 to 8 pm": the meridiem written at the end belongs to the first time as well
    const tail = s.match(/(a\.?m\.?|p\.?m\.?)\s*$/)
    if (tail && /\bto\b|-/.test(s) && h <= 12) mer = tail[1].replace(/\./g, '')
  }
  if (min > 59 || h > 24) return null
  if (mer === 'pm' && h < 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  if (h === 24) h = 0
  if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function to12h(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (Number.isNaN(h)) return ''
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return iso(dt)
}

/**
 * One due date per anchor date (a seva's performance dates, a hall's event date, a receipt date), moved by `days` before / after,
 * at `time`. `past` marks alerts whose moment has already gone: those are skipped on save (and shown so the user knows).
 *   dir: 'before' | 'on' | 'after'  (days is ignored for 'on')
 */
export function dueDates(anchors, days, dir, time, now = new Date()) {
  const n = Number(days)
  if (!Number.isFinite(n) || n < 0 || (dir !== 'on' && !(n > 0))) return []
  const seen = new Set()
  const out = []
  for (const a of anchors || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a))) continue
    const date = dir === 'on' ? a : addDays(a, dir === 'before' ? -n : n)
    if (seen.has(date)) continue // two anchors that land on one day make one alert
    seen.add(date)
    const [h, m] = String(time || '11:00').split(':').map(Number)
    const [y, mo, d] = date.split('-').map(Number)
    out.push({ date, time, past: new Date(y, mo - 1, d, h || 0, m || 0) <= now })
  }
  return out.sort((x, y) => x.date.localeCompare(y.date))
}
