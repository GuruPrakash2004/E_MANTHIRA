// MstEvent.ClrCode holds a colour NAME the legacy forms understood (RED, ORANGE, PARROT GREEN ...); a few older rows
// hold an OLE number (0x00BBGGRR). Both come out as a CSS colour here; null = no colour set.
const NAMED = {
  RED: '#E53935', ORANGE: '#FB8C00', 'LIGHT ORANGE': '#FF7043', GREEN: '#2E7D32', BLUE: '#1E88E5', MAGENTA: '#D81B60', BROWN: '#8D6E63', PINK: '#F48FB1',
  YELLOW: '#FDD835', 'PARROT GREEN': '#9CCC65', PURPLE: '#8E24AA', PEACH: '#FFDAB9', GREY: '#9E9E9E', GRAY: '#9E9E9E', BLACK: '#212121',
  'NAVY BLUE': '#1A237E', CORNFLOWERBLUE: '#6495ED', AQUA: '#26C6DA', BLANCHEDALMOND: '#FFEBCD', BEIGE: '#F5F5DC', BLUEVIOLET: '#8A2BE2', DARKSALMON: '#E9967A',
}

/** Event colour (name or OLE number) -> CSS colour, or null. */
export function oleColorToCss(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string' && Number.isNaN(Number(v))) return NAMED[v.trim().toUpperCase()] || null
  const n = Number(v)
  if (n < 0) return null
  return `rgb(${n & 0xff}, ${(n >> 8) & 0xff}, ${(n >> 16) & 0xff})`
}
