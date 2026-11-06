// Plain value of a report cell, shared by the grids' search / sort / export and the printable layout:
// value() first, then a render() that returns text / a number, else the field itself.
export const rawOf = (c, r) => {
  if (c.value) return c.value(r)
  if (c.render) {
    const v = c.render(r)
    if (v === null || v === undefined || typeof v !== 'object') return v
  }
  return r[c.key]
}

export const textOf = (c, r) => {
  const v = rawOf(c, r)
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? '' : String(v)
}
