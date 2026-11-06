// The sidebar is rendered from a prepared list, never straight from the raw MstMenu rows: the legacy menu keeps
// separator rows (caption "-") and blank captions that mean nothing in the web sidebar and would only leave gaps.

/** A legacy separator / blank entry: empty, or nothing but dashes, underscores, equals signs or dots. */
export const isSeparator = (caption) => /^[\s\-–—_=.]*$/.test(String(caption ?? ''))

/**
 * Turns the menu rows from the backend into the sections to draw: [{ type, items: [row | { _heading, caption }] }].
 * Section and sub-group names, their order and the item order all come from the rows; a sub-group heading is only
 * added when it has at least one real item under it.
 */
export function buildSidebar(menu) {
  const real = (menu || []).filter((m) => !isSeparator(m.caption))
  const sections = []
  ;[...real]
    .sort((x, y) => (x.section_order ?? 99) - (y.section_order ?? 99))
    .forEach((m) => {
      const label = m.section || m.type
      let sec = sections.find((s) => s.type === label)
      if (!sec) {
        sec = { type: label, items: [], sub: null }
        sections.push(sec)
      }
      const sub = m.subgroup || ''
      if (sub && sub !== sec.sub) sec.items.push({ menu_item_id: `h-${label}-${sub}`, caption: sub, _heading: true })
      sec.sub = sub
      sec.items.push(m)
    })
  return sections.map(({ type, items }) => ({ type, items }))
}
