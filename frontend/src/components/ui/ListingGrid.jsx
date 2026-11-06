import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, Checkbox, Group, Modal, Skeleton, Text, TextInput, Tooltip } from '@mantine/core'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpDown, ArrowUpToLine, Columns3, Eye, FileSpreadsheet, MousePointerClick, Printer, RotateCcw, Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as metaApi from '../../api/endpoints/meta'
import { downloadXls } from '../../utils/xls'
import EmptyState from './EmptyState'
import useRowPrint from '../../hooks/useRowPrint'

/**
 * Listing of every record of a master / transaction (the legacy "List" window): global search, a filter box and
 * sort arrows on every column, drag-to-resize column widths, Select Columns (show / hide / reorder), export and
 * double-click-to-load. The rows, captions and default columns all come from the backend (`GET /meta/docs/{id}/list`,
 * built from UtlTransactions + UtlDocDsgrFlds); the user's own column choices are kept per document in this browser.
 *
 *   onOpen(row, idValue) - load that record on the calling screen
 */
const PAGE = 300
const storeKey = (docId) => `vt-list-cols:${docId}`
function readPrefs(docId) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(docId)) || 'null')
  } catch {
    return null
  }
}
function writePrefs(docId, p) {
  try {
    if (p) localStorage.setItem(storeKey(docId), JSON.stringify(p))
    else localStorage.removeItem(storeKey(docId))
  } catch {
    /* private mode: the choice just lasts this session */
  }
}

function show(col, v) {
  if (v === null || v === undefined || v === '') return ''
  if (col.type === 'date') {
    if (String(v).startsWith('1900-01-01')) return ''
    const d = dayjs(v)
    return d.isValid() ? d.format(/T00:00:00$/.test(v) ? 'DD/MM/YYYY' : 'DD/MM/YYYY HH:mm') : String(v)
  }
  if (col.type === 'number' && typeof v === 'number' && !Number.isInteger(v)) return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return String(v)
}

const ACTIONS_W = 92 // the Preview / Print column

export default function ListingGrid({ docId, opened, onClose, onOpen, title, initialSearch = '' }) {
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ['doc-list', docId], queryFn: () => metaApi.getDocList(docId), enabled: opened, staleTime: 0 })
  const rp = useRowPrint(docId, title) // Preview / Print for every row of a printable document
  const [prefs, setPrefs] = useState(() => readPrefs(docId)) // { order: [keys], hidden: [keys], widths: {key: px} }
  const [global, setGlobal] = useState('')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState(null) // { key, dir }
  const [selected, setSelected] = useState(null)
  const [limit, setLimit] = useState(PAGE)
  const [keepOpen, setKeepOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  useEffect(() => {
    if (opened) setGlobal(initialSearch || '') // opened from a history card's "Search all records": carry the typed text over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])
  useEffect(() => {
    setPrefs(readPrefs(docId))
    setGlobal('')
    setFilters({})
    setSort(null)
    setSelected(null)
  }, [docId])

  // every column the backend knows, in the user's order (columns the user never arranged go last)
  const allCols = useMemo(() => {
    const cols = data?.columns || []
    if (!prefs?.order) return cols
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]))
    return [...prefs.order.filter((k) => byKey[k]).map((k) => byKey[k]), ...cols.filter((c) => !prefs.order.includes(c.key))]
  }, [data, prefs])
  const isShown = (c) => (prefs?.hidden ? !prefs.hidden.includes(c.key) && (c.visible || prefs.order?.includes(c.key)) : c.visible)
  const cols = allCols.filter(isShown)

  const widthOf = (c) =>
    prefs?.widths?.[c.key] ||
    Math.min(280, Math.max(90, Math.max(c.label.length * 9 + 44, ...(data?.rows || []).slice(0, 40).map((r) => show(c, r[c.key]).length * 7.6 + 20))))
  const setWidth = (key, w) => setPrefs((p) => ({ ...(p || {}), widths: { ...(p?.widths || {}), [key]: Math.max(60, Math.round(w)) } }))

  const rows = useMemo(() => {
    let out = data?.rows || []
    const g = global.trim().toLowerCase()
    if (g) out = out.filter((r) => cols.some((c) => show(c, r[c.key]).toLowerCase().includes(g)))
    for (const c of cols) {
      const f = (filters[c.key] || '').trim().toLowerCase()
      if (f) out = out.filter((r) => show(c, r[c.key]).toLowerCase().includes(f))
    }
    if (sort) {
      const c = cols.find((x) => x.key === sort.key)
      if (c) {
        out = [...out].sort((a, b) => {
          const x = a[c.key]
          const y = b[c.key]
          if (x == null || x === '') return y == null || y === '' ? 0 : 1 // blanks always last
          if (y == null || y === '') return -1
          const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })
          return sort.dir === 'asc' ? r : -r
        })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, global, filters, sort, prefs])
  useEffect(() => setLimit(PAGE), [global, filters, sort])

  const cycleSort = (key) => setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  const open = (r) => {
    onOpen?.(r, r[data.id_col])
    if (!keepOpen) onClose()
  }
  // drag a header edge to resize; the width is remembered when the mouse is released
  const widths = useRef(null)
  widths.current = prefs
  function startResize(e, c) {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = widthOf(c)
    const move = (ev) => setWidth(c.key, w0 + ev.clientX - x0)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      writePrefs(docId, widths.current)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const anyFilter = global || Object.values(filters).some(Boolean)
  const totalW = cols.reduce((n, c) => n + widthOf(c), 0) + (rp.can ? ACTIONS_W : 0)

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        withCloseButton={false}
        size="96vw"
        padding={0}
        radius="lg"
        centered
        styles={{ content: { height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--vt-surface)' }, body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}
      >
        {/* maroon title band */}
        <div style={{ background: 'linear-gradient(180deg, var(--vt-g2) 0%, var(--vt-g3) 100%)', color: '#FBF6EC', padding: '10px 16px', textAlign: 'center', position: 'relative' }}>
          <Text fw={700} tt="uppercase" style={{ letterSpacing: 1, fontFamily: 'Marcellus, Georgia, serif' }}>{title || data?.title || 'Listing'}</Text>
          <Text size="xs" c="#F4E1A6">Listing of {data?.title || title || ''}</Text>
          <ActionIcon variant="subtle" c="#F4E1A6" size="lg" aria-label="Close" onClick={onClose} style={{ position: 'absolute', right: 12, top: 8 }}>
            <X size={18} />
          </ActionIcon>
        </div>

        {/* search row */}
        <Group gap="xs" p="sm" wrap="nowrap" style={{ borderBottom: '1px solid var(--vt-line)' }}>
          <TextInput
            data-autofocus
            style={{ flex: 1, maxWidth: 520 }}
            leftSection={<Search size={16} />}
            placeholder="Global search across all columns..."
            value={global}
            onChange={(e) => setGlobal(e.currentTarget.value)}
            rightSection={global ? <ActionIcon variant="subtle" color="gray" size={28} aria-label="Clear search" onClick={() => setGlobal('')}><X size={14} /></ActionIcon> : null}
          />
          <Tooltip label="Reload from the database" withArrow>
            <ActionIcon variant="default" size={36} aria-label="Reload" loading={isFetching} onClick={() => refetch()}>
              <RotateCcw size={16} />
            </ActionIcon>
          </Tooltip>
          {anyFilter && (
            <Button variant="subtle" color="kumkum" size="xs" onClick={() => { setGlobal(''); setFilters({}) }}>
              Clear filters
            </Button>
          )}
          {onOpen && (
            <Group gap={4} ml="auto" visibleFrom="sm" c="dimmed" wrap="nowrap">
              <MousePointerClick size={14} aria-hidden />
              <Text size="xs">Double-click row to load</Text>
            </Group>
          )}
        </Group>

        {/* grid */}
        <div
          style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) setLimit((l) => (l < rows.length ? l + PAGE : l))
          }}
        >
          {isLoading ? (
            <Skeleton m="md" height={320} radius="md" />
          ) : cols.length === 0 ? (
            <EmptyState icon={Columns3} title="No columns selected" hint="Use Select Columns to choose what to show." />
          ) : (
            <table style={{ tableLayout: 'fixed', width: totalW, borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
              <colgroup>{rp.can && <col style={{ width: ACTIONS_W }} />}{cols.map((c) => <col key={c.key} style={{ width: widthOf(c) }} />)}</colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--vt-sandal)' }}>
                <tr>
                  {rp.can && <th style={th}>Print</th>}
                  {cols.map((c) => {
                    const dir = sort?.key === c.key ? sort.dir : null
                    return (
                      <th key={c.key} aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ ...th, position: 'relative' }}>
                        <button type="button" onClick={() => cycleSort(c.key)} title="Sort" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.label}</span>
                          {dir === 'asc' ? <ArrowUp size={12} /> : dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUpDown size={12} style={{ opacity: 0.45 }} />}
                        </button>
                        <span
                          onMouseDown={(e) => startResize(e, c)}
                          onDoubleClick={() => { setWidth(c.key, 140); setTimeout(() => writePrefs(docId, widths.current)) }}
                          aria-hidden
                          title="Drag to resize"
                          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'col-resize', borderRight: '2px solid var(--vt-line)' }}
                        />
                      </th>
                    )
                  })}
                </tr>
                <tr>
                  {rp.can && <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--vt-line)' }} />}
                  {cols.map((c) => (
                    <th key={c.key} style={{ padding: '4px 6px', borderBottom: '1px solid var(--vt-line)' }}>
                      <input
                        aria-label={`Filter ${c.label}`}
                        placeholder="Filter..."
                        value={filters[c.key] || ''}
                        onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', height: 26, padding: '0 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', color: 'inherit' }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => {
                  const id = r[data.id_col]
                  const on = selected === id
                  return (
                    <tr
                      key={`${id}-${i}`}
                      onClick={() => setSelected(id)}
                      onDoubleClick={onOpen ? () => open(r) : undefined}
                      aria-selected={on}
                      style={{ cursor: 'pointer', background: on ? 'var(--vt-gold-chip)' : i % 2 ? 'var(--vt-sandal)' : 'transparent' }}
                    >
                      {rp.can && (
                        <td style={{ ...td, padding: '2px 4px' }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          <Group gap={2} wrap="nowrap">
                            <Tooltip label="Preview" withArrow>
                              <ActionIcon variant="subtle" color="kumkum" size={28} aria-label={`Preview ${id}`} onClick={() => rp.preview(id)}>
                                <Eye size={15} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Print" withArrow>
                              <ActionIcon variant="light" color="kumkum" size={28} aria-label={`Print ${id}`} onClick={() => rp.print(id)}>
                                <Printer size={15} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </td>
                      )}
                      {cols.map((c) => {
                        const t = show(c, r[c.key])
                        return <td key={c.key} title={t} style={{ ...td, textAlign: c.type === 'number' ? 'right' : 'left' }}>{t}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {!isLoading && cols.length > 0 && rows.length === 0 && <EmptyState icon={Search} title="No records match" hint="Change or clear the filters." />}
        </div>

        {/* footer */}
        <Group justify="space-between" p="sm" wrap="wrap" gap="xs" style={{ borderTop: '1px solid var(--vt-line)' }}>
          <Group gap="md" wrap="wrap">
            <Text size="sm" fw={700} px={10} py={4} style={{ border: '1px solid var(--vt-line)', borderRadius: 8 }}>
              Total Records: {isLoading ? '...' : `${rows.length} / ${data?.rows?.length ?? 0}`}
            </Text>
            {onOpen && <Checkbox size="xs" color="kumkum" label="Do NOT hide after loading the record." checked={keepOpen} onChange={(e) => setKeepOpen(e.currentTarget.checked)} />}
            {data?.truncated && <Text size="xs" c="orange">Showing the latest {data.rows.length} records.</Text>}
          </Group>
          <Group gap="xs" wrap="wrap">
            <Button variant="default" leftSection={<Columns3 size={15} />} onClick={() => setPickOpen(true)} disabled={!data}>
              Select Columns
            </Button>
            <Button
              variant="default"
              leftSection={<FileSpreadsheet size={15} />}
              disabled={!rows.length}
              onClick={() => downloadXls(data?.title || 'list', rows, cols.map((c) => ({ label: c.label, value: (r) => show(c, r[c.key]) })), title || data?.title)}
            >
              Export to Excel
            </Button>
            {onOpen && <Button
              color="kumkum"
              disabled={selected == null}
              onClick={() => {
                const r = rows.find((x) => x[data.id_col] === selected)
                if (r) open(r)
              }}
            >
              Open Selected
            </Button>}
            <Button variant="light" color="red" leftSection={<X size={15} />} onClick={onClose}>
              Close
            </Button>
          </Group>
        </Group>
      </Modal>

      {rp.dialog}

      {pickOpen && data && (
        <ColumnPicker
          columns={allCols}
          isShown={isShown}
          onClose={() => setPickOpen(false)}
          onApply={(order, shown) => {
            const next = { ...(prefs || {}), order, hidden: order.filter((k) => !shown.includes(k)) }
            setPrefs(next)
            writePrefs(docId, next)
            setPickOpen(false)
          }}
          onReset={() => {
            setPrefs(null)
            writePrefs(docId, null)
            setPickOpen(false)
          }}
        />
      )}
    </>
  )
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', userSelect: 'none' }
const td = { padding: '6px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '1px solid var(--vt-line)' }

/** "Select Columns to Display": tick to show, click a name then Top / Up / Down / Bottom to reorder. */
export function ColumnPicker({ columns, isShown, onApply, onReset, onClose }) {
  const [order, setOrder] = useState(() => columns.map((c) => c.key))
  const [shown, setShown] = useState(() => columns.filter(isShown).map((c) => c.key))
  const [cur, setCur] = useState(null)
  const [q, setQ] = useState('')
  const label = Object.fromEntries(columns.map((c) => [c.key, c.label]))
  const move = (to) =>
    setOrder((o) => {
      const i = o.indexOf(cur)
      if (i < 0) return o
      const j = to === 'top' ? 0 : to === 'bottom' ? o.length - 1 : Math.min(o.length - 1, Math.max(0, i + (to === 'up' ? -1 : 1)))
      const n = o.filter((k) => k !== cur)
      n.splice(j, 0, cur)
      return n
    })
  const list = order.filter((k) => label[k].toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (k) => setShown((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
  return (
    <Modal
      opened
      onClose={onClose}
      size={460}
      radius="lg"
      centered
      zIndex={400}
      title={<Group gap={8}><Columns3 size={18} /><Text fw={700}>Select Columns to Display</Text></Group>}
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <Button size="xs" variant="light" color="kumkum" onClick={() => setShown(order)}>Select All</Button>
          <Button size="xs" variant="default" onClick={() => setShown([])}>Deselect All</Button>
        </Group>
        <TextInput size="xs" placeholder="Search columns..." value={q} onChange={(e) => setQ(e.currentTarget.value)} w={170} />
      </Group>
      <Group gap={6} mb={4} wrap="wrap">
        <Text size="xs" c="dimmed">Order:</Text>
        <Button size="compact-xs" variant="default" leftSection={<ArrowUpToLine size={12} />} disabled={!cur} onClick={() => move('top')}>Top</Button>
        <Button size="compact-xs" variant="default" leftSection={<ArrowUp size={12} />} disabled={!cur} onClick={() => move('up')}>Up</Button>
        <Button size="compact-xs" variant="default" leftSection={<ArrowDown size={12} />} disabled={!cur} onClick={() => move('down')}>Down</Button>
        <Button size="compact-xs" variant="default" leftSection={<ArrowDownToLine size={12} />} disabled={!cur} onClick={() => move('bottom')}>Bottom</Button>
        <Text size="xs" c="dimmed" ml="auto">Click a column to select it</Text>
      </Group>
      <div style={{ height: 340, overflowY: 'auto', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
        {list.map((k) => (
          <div
            key={k}
            onClick={() => setCur(k)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--vt-line)', background: cur === k ? 'var(--vt-gold-chip)' : 'transparent' }}
          >
            <Checkbox size="xs" color="kumkum" checked={shown.includes(k)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(k)} aria-label={label[k]} />
            <Text size="sm">{label[k]}</Text>
          </div>
        ))}
      </div>
      <Group justify="space-between" mt="md">
        <Button size="xs" variant="default" onClick={onReset}>Reset to Default</Button>
        <Group gap="xs">
          <Button size="xs" color="kumkum" onClick={() => onApply(order, shown)}>Apply Changes</Button>
          <Button size="xs" variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Group>
    </Modal>
  )
}
