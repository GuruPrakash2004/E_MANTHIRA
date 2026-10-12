// Small helpers shared by the demo seed modules. Pure functions, no imports from api.js.
import dayjs from 'dayjs'

export const iso = (daysAgo = 0) => dayjs().subtract(daysAgo, 'day').format('YYYY-MM-DD')
export const isoFuture = (days = 0) => dayjs().add(days, 'day').format('YYYY-MM-DD')
export const stamp = (daysAgo = 0, hh = 10, mm = 30) => dayjs().subtract(daysAgo, 'day').hour(hh).minute(mm).second(0).format('YYYY-MM-DDTHH:mm:ss')

// Deterministic pseudo-random so the demo looks the same on every reload.
export function rng(seed = 1) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const pick = (r, list) => list[Math.floor(r() * list.length)]

export const pad = (n, w = 5) => String(n).padStart(w, '0')
export const FY_PREFIX = '26SLV'

/** OLE colour int (0x00BBGGRR, as MstEVENT.CLRCODE stores it) from #RRGGBB. */
export function oleColor(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (b << 16) | (g << 8) | r
}

export const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
