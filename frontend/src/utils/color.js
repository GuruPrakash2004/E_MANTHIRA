/** OLE colour (0x00BBGGRR, as stored in MstEVENT.CLRCODE) -> CSS rgb(), or null when unset (negative / missing). */
export function oleColorToCss(v) {
  if (v == null || v < 0) return null
  const r = v & 0xff
  const g = (v >> 8) & 0xff
  const b = (v >> 16) & 0xff
  return `rgb(${r}, ${g}, ${b})`
}
