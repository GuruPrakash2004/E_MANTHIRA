// Indian-grouped money, per project convention: ₹ 1,23,456.00
export function formatINR(value, { decimals = 2 } = {}) {
  const n = Number(value) || 0
  return `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

// YYYY-MM-DD of a Date's LOCAL calendar day. Never use date.toISOString().slice(0, 10) for this: it converts to UTC
// first, so a date picked in India (local midnight) comes out as the previous day.
export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
