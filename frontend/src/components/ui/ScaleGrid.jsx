import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EmptyState from './EmptyState'
import { FileSearch } from 'lucide-react'

/**
 * A grid that scales: only the visible rows are rendered (tens of thousands of rows stay smooth), the header stays
 * put while scrolling, columns can be resized by dragging the header edge, and the grid fills the height it is given.
 *
 *   columns: [{ key, label, width?, num?, render?(row, index), title?(row) }]
 *   rows:    objects; a row with `_kind: 'subtotal' | 'total' | 'group'` is drawn as a summary line.
 *   frozenCols: number of leading columns that stay in view while scrolling sideways.
 *   onRowClick(row), selectedIndex, rowHeight (px, default 34), height (css, default 'calc(100vh - 360px)').
 */
export default function ScaleGrid({
  columns,
  rows,
  rowHeight = 34,
  height = 'calc(100vh - 360px)',
  minHeight = 260,
  onRowClick,
  selectedIndex,
  loading,
  emptyTitle = 'No records',
  emptyHint,
  footer,
  frozenCols = 0,
}) {
  const ref = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(480)
  const [widths, setWidths] = useState(() => Object.fromEntries(columns.map((c) => [c.key, c.width || 140])))

  useEffect(() => {
    setWidths((w) => {
      const n = { ...w }
      columns.forEach((c) => { if (n[c.key] == null) n[c.key] = c.width || 140 })
      return n
    })
  }, [columns])
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const total = rows.length
  const overscan = 8
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const last = Math.min(total, Math.ceil((scrollTop + viewH) / rowHeight) + overscan)
  const gridW = useMemo(() => columns.reduce((s, c) => s + (widths[c.key] || 140), 0), [columns, widths])
  const template = columns.map((c) => `${widths[c.key] || 140}px`).join(' ')

  const startResize = useCallback((e, key) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = widths[key] || 140
    const move = (ev) => setWidths((w) => ({ ...w, [key]: Math.max(50, w0 + ev.clientX - x0) }))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [widths])

  const leftOf = (idx) => columns.slice(0, idx).reduce((t, c) => t + (widths[c.key] || 140), 0)
  const stick = (idx) => (idx < frozenCols ? { position: 'sticky', left: leftOf(idx), zIndex: 1, background: 'var(--vt-surface)' } : null)
  const cell = { padding: '0 10px', display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }

  if (!loading && total === 0) {
    return (
      <div style={{ border: '1px solid var(--vt-line)', borderRadius: 12, background: 'var(--vt-surface)' }}>
        <EmptyState icon={FileSearch} title={emptyTitle} hint={emptyHint} />
      </div>
    )
  }
  return (
    <div style={{ border: '1px solid var(--vt-line)', borderRadius: 12, background: 'var(--vt-surface)', overflow: 'hidden' }}>
      <div ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} style={{ height, minHeight, overflow: 'auto', position: 'relative' }} role="grid" aria-rowcount={total + 1}>
        <div style={{ width: gridW, minWidth: '100%' }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: template, position: 'sticky', top: 0, zIndex: 2, height: rowHeight + 4, background: 'var(--vt-sandal)', borderBottom: '2px solid var(--vt-line)', fontWeight: 700, fontSize: 13 }}>
            {columns.map((c, ci) => (
              <div key={c.key} role="columnheader" style={{ ...cell, position: 'relative', justifyContent: c.num ? 'flex-end' : 'flex-start', ...(stick(ci) ? { ...stick(ci), background: 'var(--vt-sandal)', zIndex: 3 } : null) }} title={c.label}>
                {c.label}
                <span onMouseDown={(e) => startResize(e, c.key)} aria-hidden style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }} />
              </div>
            ))}
          </div>
          <div style={{ height: total * rowHeight, position: 'relative' }}>
            {rows.slice(first, last).map((r, k) => {
              const i = first + k
              const summary = r._kind === 'subtotal' || r._kind === 'total' || r._kind === 'group'
              return (
                <div
                  key={r._key ?? i}
                  role="row"
                  aria-rowindex={i + 2}
                  onClick={onRowClick ? () => onRowClick(r, i) : undefined}
                  style={{
                    position: 'absolute',
                    top: i * rowHeight,
                    left: 0,
                    right: 0,
                    height: rowHeight,
                    display: 'grid',
                    gridTemplateColumns: template,
                    fontSize: 13,
                    fontWeight: summary ? 700 : 400,
                    background: selectedIndex === i ? 'var(--vt-gold-chip)' : summary ? 'var(--vt-sandal)' : i % 2 ? 'var(--vt-surface-alt, transparent)' : undefined,
                    borderBottom: '1px solid var(--vt-line)',
                    cursor: onRowClick ? 'pointer' : undefined,
                  }}
                >
                  {columns.map((c, ci) => (
                    <div key={c.key} role="gridcell" className={c.num ? 'vt-num' : undefined} style={{ ...cell, justifyContent: c.num ? 'flex-end' : 'flex-start', ...(stick(ci) ? { ...stick(ci), background: summary ? 'var(--vt-sandal)' : selectedIndex === i ? 'var(--vt-gold-chip)' : 'var(--vt-surface)' } : null) }} title={c.title ? c.title(r) : undefined}>
                      {c.render ? c.render(r, i) : r[c.key]}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {footer && <div style={{ padding: '8px 12px', borderTop: '1px solid var(--vt-line)', fontSize: 13 }}>{footer}</div>}
    </div>
  )
}
