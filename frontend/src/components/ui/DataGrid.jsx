import { useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, Card, Group, Skeleton, Stack, Text, TextInput } from '@mantine/core'
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, FileSearch, FileSpreadsheet, MousePointerClick, Search, X } from 'lucide-react'
import { downloadXls } from '../../utils/xls'
import EmptyState from './EmptyState'
import { ColumnPicker } from './ListingGrid'
import { rawOf, textOf } from '../../utils/reportCells'
import ReportPrintButtons from './ReportPrint'

/**
 * The shared list grid for every screen that shows rows in a table: global search, a filter box and sort arrows on
 * every column, drag-to-resize, Select Columns (show / hide / reorder, remembered per grid in this browser),
 * Export to Excel and "Total Records: shown / all" - the same behaviour as the document Listing window.
 *
 *   columns   [{ key, label, num?, render?(row), value?(row) }]  value() = plain text used by search / filter / sort / export
 *   rows      array of objects
 *   idKey     row identity (defaults to the row index)
 *   onOpen    (row) => void  - optional: double-click a row / "Open Selected" loads it; omit on report-only lists
 *   name      export file name + the key the column choices are remembered under (use a stable string)
 *   footer    optional <Table.Tfoot> style node kept as the last table rows
 */
const PREF = (name) => `vt-grid-cols:${name}`
const readPrefs = (name) => {
  try {
    return JSON.parse(localStorage.getItem(PREF(name)) || 'null')
  } catch {
    return null
  }
}
const writePrefs = (name, p) => {
  try {
    if (p) localStorage.setItem(PREF(name), JSON.stringify(p))
    else localStorage.removeItem(PREF(name))
  } catch {
    /* private mode: the choice lasts this session only */
  }
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', userSelect: 'none', whiteSpace: 'nowrap' }
const td = { padding: '6px 10px', borderBottom: '1px solid var(--vt-line)', verticalAlign: 'top' }

export default function DataGrid({ columns, rows, idKey, onOpen, name = 'list', loading, idle, idleTitle, idleHint, emptyTitle = 'No records found', emptyHint, footer, maxHeight = 560, rowStyle, selected: selectedProp, onSelect }) {
  const [prefs, setPrefs] = useState(() => readPrefs(name)) // { order, hidden, widths }
  const [global, setGlobal] = useState('')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState(null)
  const [selectedOwn, setSelectedOwn] = useState(null)
  const selected = onSelect ? selectedProp ?? null : selectedOwn
  const setSelected = (id) => (onSelect ? onSelect(id) : setSelectedOwn(id))
  const [pickOpen, setPickOpen] = useState(false)
  const widths = useRef(prefs)
  widths.current = prefs

  const all = rows || []
  const keyed = columns.map((c) => ({ ...c, label: String(c.label ?? ''), visible: true }))
  const allCols = useMemo(() => {
    if (!prefs?.order) return keyed
    const byKey = Object.fromEntries(keyed.map((c) => [c.key, c]))
    return [...prefs.order.filter((k) => byKey[k]).map((k) => byKey[k]), ...keyed.filter((c) => !prefs.order.includes(c.key))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, prefs])
  const isShown = (c) => !(prefs?.hidden || []).includes(c.key)
  const cols = allCols.filter(isShown)

  const shown = useMemo(() => {
    let out = all
    const g = global.trim().toLowerCase()
    if (g) out = out.filter((r) => cols.some((c) => textOf(c, r).toLowerCase().includes(g)))
    for (const c of cols) {
      const f = (filters[c.key] || '').trim().toLowerCase()
      if (f) out = out.filter((r) => textOf(c, r).toLowerCase().includes(f))
    }
    if (sort) {
      const c = cols.find((x) => x.key === sort.key)
      if (c) {
        out = [...out].sort((a, b) => {
          let x = rawOf(c, a)
          let y = rawOf(c, b)
          if (x == null || x === '') return y == null || y === '' ? 0 : 1 // blanks always last
          if (y == null || y === '') return -1
          if (typeof x !== 'number' && typeof y !== 'number') {
            // numbers shown as text ("1,234.50") still sort as numbers
            const nx = Number(String(x).replace(/[₹,\s]/g, ''))
            const ny = Number(String(y).replace(/[₹,\s]/g, ''))
            if (String(x).trim() !== '' && String(y).trim() !== '' && !Number.isNaN(nx) && !Number.isNaN(ny)) {
              x = nx
              y = ny
            }
          }
          const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })
          return sort.dir === 'asc' ? r : -r
        })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, global, filters, sort, prefs])

  const cycleSort = (key) => setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  const idOf = (r, i) => (idKey ? r[idKey] : i)
  const anyFilter = global || Object.values(filters).some(Boolean)

  const widthOf = (c) => prefs?.widths?.[c.key]
  const setWidth = (key, w) => setPrefs((p) => ({ ...(p || {}), widths: { ...(p?.widths || {}), [key]: Math.max(60, Math.round(w)) } }))
  function startResize(e, c) {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = e.currentTarget.parentElement.getBoundingClientRect().width
    const move = (ev) => setWidth(c.key, w0 + ev.clientX - x0)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      writePrefs(name, widths.current)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (idle) {
    return (
      <Card withBorder>
        <EmptyState icon={FileSearch} title={idleTitle} hint={idleHint} />
      </Card>
    )
  }
  if (loading) {
    return (
      <Card withBorder p="md">
        <Stack gap="xs">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={34} radius="sm" />
          ))}
        </Stack>
      </Card>
    )
  }
  if (all.length === 0) {
    return (
      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        <EmptyState icon={FileSearch} title={emptyTitle} hint={emptyHint} />
      </Card>
    )
  }

  const openRow = (r) => onOpen?.(r)
  return (
    <Card withBorder p={0} style={{ overflow: 'hidden' }}>
      <Group gap="xs" p="sm" wrap="nowrap" style={{ borderBottom: '1px solid var(--vt-line)' }}>
        <TextInput
          style={{ flex: 1, maxWidth: 420 }}
          size="xs"
          leftSection={<Search size={14} />}
          placeholder="Global search across all columns..."
          aria-label="Global search"
          value={global}
          onChange={(e) => setGlobal(e.currentTarget.value)}
          rightSection={global ? <ActionIcon variant="subtle" color="gray" size={22} aria-label="Clear search" onClick={() => setGlobal('')}><X size={12} /></ActionIcon> : null}
        />
        {anyFilter && (
          <Button variant="subtle" color="kumkum" size="compact-xs" onClick={() => { setGlobal(''); setFilters({}) }}>
            Clear filters
          </Button>
        )}
        {onOpen && (
          <Group gap={4} ml="auto" visibleFrom="sm" c="dimmed" wrap="nowrap">
            <MousePointerClick size={13} aria-hidden />
            <Text size="xs">Double-click row to load</Text>
          </Group>
        )}
      </Group>

      <div style={{ overflow: 'auto', maxHeight }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13, tableLayout: Object.keys(prefs?.widths || {}).length ? 'fixed' : 'auto' }}>
          <colgroup>{cols.map((c) => <col key={c.key} style={widthOf(c) ? { width: widthOf(c) } : undefined} />)}</colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--vt-sandal)' }}>
            <tr>
              {cols.map((c) => {
                const dir = sort?.key === c.key ? sort.dir : null
                return (
                  <th key={c.key} aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ ...th, position: 'relative', textAlign: c.num ? 'right' : 'left' }}>
                    <button type="button" onClick={() => cycleSort(c.key)} title="Sort" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: c.num ? 'flex-end' : 'flex-start' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                      {dir === 'asc' ? <ArrowUp size={12} /> : dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUpDown size={12} style={{ opacity: 0.45 }} />}
                    </button>
                    <span
                      onMouseDown={(e) => startResize(e, c)}
                      onDoubleClick={() => { setPrefs((p) => { const n = { ...(p || {}), widths: { ...(p?.widths || {}) } }; delete n.widths[c.key]; writePrefs(name, n); return n }) }}
                      aria-hidden
                      title="Drag to resize"
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'col-resize', borderRight: '2px solid var(--vt-line)' }}
                    />
                  </th>
                )
              })}
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={c.key} style={{ padding: '4px 6px', borderBottom: '1px solid var(--vt-line)' }}>
                  <input
                    aria-label={`Filter ${c.label}`}
                    placeholder="Filter..."
                    value={filters[c.key] || ''}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                    style={{ width: '100%', minWidth: 60, boxSizing: 'border-box', height: 26, padding: '0 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', color: 'inherit' }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const id = idOf(r, i)
              const on = selected === id
              return (
                <tr
                  key={`${id}-${i}`}
                  onClick={() => setSelected(id)}
                  onDoubleClick={onOpen ? () => openRow(r) : undefined}
                  aria-selected={on}
                  style={{ cursor: 'pointer', background: on ? 'var(--vt-gold-chip)' : i % 2 ? 'var(--vt-sandal)' : 'transparent', ...(rowStyle ? rowStyle(r) : null) }}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={c.num ? 'vt-num' : undefined} style={{ ...td, textAlign: c.num ? 'right' : 'left' }}>
                      {c.render ? c.render(r) : c.value ? c.value(r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
        {shown.length === 0 && <EmptyState icon={Search} title="No records match" hint="Change or clear the filters." />}
      </div>

      <Group justify="space-between" p="sm" wrap="wrap" gap="xs" style={{ borderTop: '1px solid var(--vt-line)' }}>
        <Text size="sm" fw={700} px={10} py={2} style={{ border: '1px solid var(--vt-line)', borderRadius: 8 }}>
          Total Records: {shown.length} / {all.length}
        </Text>
        <Group gap="xs" wrap="wrap">
          <Button size="xs" variant="default" leftSection={<Columns3 size={14} />} onClick={() => setPickOpen(true)}>
            Select Columns
          </Button>
          <Button size="xs" variant="default" leftSection={<FileSpreadsheet size={14} />} disabled={!shown.length} onClick={() => downloadXls(name, shown, cols.map((c) => ({ label: c.label, value: (r) => textOf(c, r) })))}>
            Export to Excel
          </Button>
          <ReportPrintButtons size="xs" title={name} columns={cols} rows={shown} />
          {onOpen && (
            <Button size="xs" color="kumkum" disabled={selected == null} onClick={() => { const r = shown.find((x, i) => idOf(x, i) === selected); if (r) openRow(r) }}>
              Open Selected
            </Button>
          )}
        </Group>
      </Group>

      {pickOpen && (
        <ColumnPicker
          columns={allCols}
          isShown={isShown}
          onClose={() => setPickOpen(false)}
          onApply={(order, vis) => {
            const next = { ...(prefs || {}), order, hidden: order.filter((k) => !vis.includes(k)) }
            setPrefs(next)
            writePrefs(name, next)
            setPickOpen(false)
          }}
          onReset={() => {
            setPrefs(null)
            writePrefs(name, null)
            setPickOpen(false)
          }}
        />
      )}
    </Card>
  )
}
