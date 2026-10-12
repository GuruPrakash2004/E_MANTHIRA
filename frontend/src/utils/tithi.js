// Approximate Hindu tithi from the real calendar date (low-precision Sun and Moon longitudes, evaluated at about
// sunrise IST). Good enough to place Amavasya / Poornima / Ekadashi / Sankashti on the right day; the temple can
// still edit any day. Tithi 1-15 = Shukla paksha (waxing), 16-30 = Krishna paksha (waning).
const RAD = Math.PI / 180
const norm = (x) => ((x % 360) + 360) % 360

export function tithiOf(date) {
  // Sunrise IST is about 00:30 UTC.
  const t = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 30)
  const d = t / 86400000 - 10957.5 // days since J2000.0
  const sunM = norm(357.529 + 0.98560028 * d)
  const sun = norm(280.459 + 0.98564736 * d + 1.915 * Math.sin(sunM * RAD) + 0.02 * Math.sin(2 * sunM * RAD))
  const moonM = norm(134.963 + 13.064993 * d)
  const moon = norm(218.316 + 13.176396 * d + 6.289 * Math.sin(moonM * RAD) + 1.274 * Math.sin((2 * norm(297.85 + 12.190749 * d) - moonM) * RAD) + 0.658 * Math.sin(2 * norm(297.85 + 12.190749 * d) * RAD))
  return Math.floor(norm(moon - sun) / 12) + 1
}

// Special day for a date, or null: Amavasya (30), Poornima (15), Ekadashi (11 and 26), Sankashti Chaturthi (19).
export function specialDayOf(date) {
  const t = tithiOf(date)
  if (t === 30) return 'Amavasya'
  if (t === 15) return 'Poornima'
  if (t === 11 || t === 26) return 'Ekadashi'
  if (t === 19) return 'Sankashti Chaturthi'
  return null
}
