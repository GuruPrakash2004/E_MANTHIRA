import dayjs from 'dayjs'

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Every date from `from` to `to` (inclusive) that falls on one of `weekdays` (0 = Sunday ... 6 = Saturday; empty = all
 * days), as YYYY-MM-DD strings. Capped at `cap` dates so a mistyped range cannot book years of sevas.
 */
export function datesInRange(from, to, weekdays = [], cap = 366) {
  if (!from || !to) return []
  const out = []
  let d = dayjs(from).startOf('day')
  const end = dayjs(to).startOf('day')
  while (!d.isAfter(end) && out.length < cap) {
    if (!weekdays.length || weekdays.includes(d.day())) out.push(d.format('YYYY-MM-DD'))
    d = d.add(1, 'day')
  }
  return out
}

/** The one date format of the whole app: 26-Oct-2026. */
export const DATE_FORMAT = 'DD-MMM-YYYY'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Strict parser for a typed date: 26-Oct-2026 (the app's format), 26 October 2026, 26/10/2026, 26-10-2026 or 26.10.2026
 * (1-digit day/month are fine). Anything else, including a half-typed date or 31-Feb-2026, gives null, so the field never
 * commits a wrong day while typing. Used as `dateParser` by the shared DateInput (components/ui/AppDates.jsx).
 */
export function parseTypedDate(text) {
  const m = /^\s*(\d{1,2})[\s/.-]+(\d{1,2}|[A-Za-z]{3,9})[\s/.-]+(\d{4})\s*$/.exec(text || '')
  if (!m) return null
  const day = Number(m[1])
  const year = Number(m[3])
  let month
  if (/^\d+$/.test(m[2])) month = Number(m[2])
  else {
    month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    if (month === 0) return null
  }
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}
