// How far back the "Recent ..." lists of the entry screens reach. Kept per browser; every list reads it when it loads.
//   all  = every bill ever entered      days = the last N days (any financial year)      fy = the financial year being worked in
const KEY = 'vt-history'
const DEFAULT = { mode: 'all', days: 30 }
export const HISTORY_TOP = 1000 // newest bills loaded into a list; the list scrolls (use Find for anything older)

export function getHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v && ['all', 'days', 'fy'].includes(v.mode)) return { mode: v.mode, days: Math.max(1, Number(v.days) || DEFAULT.days) }
  } catch {
    /* storage blocked or unreadable: use the default */
  }
  return DEFAULT
}

export function setHistory(h) {
  try {
    localStorage.setItem(KEY, JSON.stringify(h))
  } catch {
    /* the choice then lasts until the page is closed */
  }
}

/** Query parameters for a recent-list request: the newest HISTORY_TOP bills inside the chosen window. */
export function historyParams(extra = {}) {
  const h = getHistory()
  const days = h.mode === 'all' ? 0 : h.mode === 'days' ? h.days : undefined // undefined = the user's financial year
  return { top: HISTORY_TOP, ...(days === undefined ? {} : { days }), ...extra }
}

export function historyLabel(h = getHistory()) {
  if (h.mode === 'all') return 'All bills'
  if (h.mode === 'days') return `Last ${h.days} day${h.days === 1 ? '' : 's'}`
  return 'This financial year'
}
