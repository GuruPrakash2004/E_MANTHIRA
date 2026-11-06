import ExportExcelButton from './ExportExcelButton'
import { getFyShort } from '../../api/api'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Button, Card, Collapse, Divider, Group, Menu, NumberInput, Skeleton, Text, TextInput, Title, Stack, Tooltip } from '@mantine/core'
import useRowPrint from '../../hooks/useRowPrint'
import useRights from '../../hooks/useRights'
import { Check, ChevronDown, ChevronUp, Eye, History, List as ListIcon, Printer, Save, Search, SlidersHorizontal, X } from 'lucide-react'
import ListingGrid from './ListingGrid'
import { HISTORY_TOP, getHistory, historyLabel, setHistory } from '../../lib/history'
import useEnterAsTab from '../../hooks/useEnterAsTab'
import { AnimatePresence, motion } from 'framer-motion'
import EmptyState from './EmptyState'
import amountInWords from '../../utils/amountInWords'

// Building blocks shared by the money-entry screens (Seva, Donation, Hall, Vouchers):
// section cards on the left, a sticky summary / saved panel / recent list on the right.

export function SectionCard({ title, hint, action, children }) {
  return (
    <Card withBorder p="lg">
      <Group justify="space-between" align="flex-end" mb="md" wrap="wrap" gap="xs">
        <div>
          <Title order={4} mb={hint ? 2 : 0}>
            {title}
          </Title>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </div>
        {action}
      </Group>
      {children}
    </Card>
  )
}

// Two-column entry layout built on CSS grid (Mantine's Grid wrapper made position:sticky unreliable).
// >= 1200px: form on the left, a side panel pinned to the viewport on the right that always shows the
// summary and the recent list (the list takes the remaining height and scrolls inside itself).
// Below that: one column, side panel under the form.
export function EntryLayout({ main, side, viewing = false }) {
  const enterAsTab = useEnterAsTab()
  return (
    <>
      <div className="vt-entry-layout">
        <div className="vt-entry-main" onKeyDown={enterAsTab}>{viewing ? <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{main}</fieldset> : main}</div>
        <aside className="vt-entry-side" aria-label="Summary and recent entries">
          {side}
        </aside>
      </div>
      <style>{`
        .vt-entry-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--mantine-spacing-lg); align-items: start; }
        .vt-entry-main { min-width: 0; }
        .vt-entry-side { display: flex; flex-direction: column; gap: var(--mantine-spacing-sm); min-width: 0; }
        .vt-entry-side .vt-recent-list { max-height: calc(15 * 56px + 8px); } /* at least 15 bills are visible, the rest scrolls */
        @media (min-width: 1200px) {
          .vt-entry-layout { grid-template-columns: minmax(0, 1fr) 380px; }
          /* header is 80px: pin 10px below it, and use all the remaining height so the recent list shows more rows */
          .vt-entry-side { position: sticky; top: 90px; height: calc(100dvh - 102px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--vt-accent) transparent; padding-right: 2px; }
          .vt-entry-side > * { flex: 0 0 auto; }
          .vt-entry-side > .vt-recent-card { flex: 0 0 auto; }
          .vt-entry-side .vt-recent-list { max-height: calc(15 * 56px + 8px); }
        }

        /* Recent list: thin themed scrollbar, soft fade at the edges, roomy hover rows */
        .vt-recent-list {
          scrollbar-width: thin;
          scrollbar-color: var(--vt-accent) transparent;
          overscroll-behavior: auto;
          padding: 2px 6px 2px 0;
          -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 14px), transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 14px), transparent 100%);
        }
        .vt-recent-list::-webkit-scrollbar { width: 6px; }
        .vt-recent-list::-webkit-scrollbar-track { background: transparent; }
        .vt-recent-list::-webkit-scrollbar-thumb { background: var(--vt-accent); border-radius: 999px; opacity: .6; }
        .vt-recent-list::-webkit-scrollbar-thumb:hover { background: var(--mantine-color-gold-5); }
        .vt-recent-row { border-radius: 10px; padding: 8px 10px; transition: background-color .15s ease; }
        .vt-recent-row:hover { background: var(--vt-gold-chip); }
      `}</style>
    </>
  )
}

export function SummaryCard({ rows = [], totalLabel = 'Total', total, words, warning, saveLabel = 'Save & Print', saveIcon: SaveIcon = Printer, saving, saveDisabled = false, onSave, onSavePrint, compact = false }) {
  const rights = useRights() // Save needs the Add right, printing the Print right
  saveDisabled = saveDisabled || !rights.add
  if (!rights.print) {
    onSavePrint = null
    saveLabel = saveLabel.replace(/\s*&\s*Print/i, '')
  }
  return (
    <Card p={compact ? 'xs' : 'md'} style={{ background: 'linear-gradient(160deg, var(--vt-g1) 0%, var(--vt-g3) 100%)', border: '1px solid rgba(244,225,166,0.3)', color: '#FBF6EC' }}>
      <Text size="xs" fw={700} tt="uppercase" c="#F4E1A6" style={{ letterSpacing: 1 }}>
        Summary
      </Text>
      <Stack gap={compact ? 1 : 4} mt={compact ? 2 : 6}>
        {rows.map((r) => (
          <Group key={r.label} justify="space-between" wrap="nowrap">
            <Text size={compact ? 'xs' : 'sm'} c="#E9D2B8">
              {r.label}
            </Text>
            <Text size={compact ? 'xs' : 'sm'} className="vt-num">
              {r.value}
            </Text>
          </Group>
        ))}
      </Stack>
      <Divider my={compact ? 4 : 'sm'} color="rgba(244,225,166,0.25)" />
      <Text size="xs" c="#E9D2B8">
        {totalLabel}
      </Text>
      <Text className="vt-num" c="#F4E1A6" style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: compact ? 22 : 'clamp(26px,2.4vw,34px)', fontWeight: 700, lineHeight: 1.15 }}>
        {total}
      </Text>
      {amountInWords(words) && (
        <Text size="xs" c="#E9D2B8" mt={4} style={{ fontStyle: 'italic' }} aria-label="Amount in words">
          {amountInWords(words)}
        </Text>
      )}
      {warning && (
        <Text size="xs" c="#F4E1A6" mt={6} role="status">
          {warning}
        </Text>
      )}
      {/* Screens that print get two explicit buttons: Alt+S saves only, F10 saves and prints straight away (shown in the tooltip). */}
      {onSavePrint ? (
        <Group gap={8} mt={compact ? 6 : 'sm'} wrap="nowrap" grow>
          <Button size={compact ? 'compact-sm' : 'sm'} px="xs" color="gold" c="#2B0909" leftSection={<Save size={16} />} loading={saving} disabled={saveDisabled} onClick={onSave} aria-keyshortcuts="Alt+S" title="Save only, nothing is printed (Alt+S)">
            Save
          </Button>
          <Button size={compact ? 'compact-sm' : 'sm'} px="xs" variant="outline" color="gold" leftSection={<Printer size={16} />} disabled={saving || saveDisabled} onClick={onSavePrint} aria-keyshortcuts="F10" title="Save and print straight away, no dialog (F10)">
            Save &amp; Print
          </Button>
        </Group>
      ) : (
        <Button fullWidth size="md" mt="sm" color="gold" c="#2B0909" leftSection={<SaveIcon size={18} />} loading={saving} disabled={saveDisabled} onClick={onSave} aria-keyshortcuts="Alt+S" title="Alt+S">
          {saveLabel}
        </Button>
      )}
    </Card>
  )
}

export function SavedPanel({ lines, onPrint, printLabel = 'Print receipt', extra = null }) {
  const rights = useRights()
  if (!rights.print) onPrint = null
  return (
    <Card withBorder p="md" style={{ borderColor: 'var(--mantine-color-gold-4)', background: 'var(--vt-gold-chip)' }} role="status">
      <Group gap={8} wrap="nowrap" align="flex-start">
        <Diya />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={700}>
            Saved successfully
          </Text>
          {lines.map((l) => (
            <Text key={l} size="xs" c="dimmed" className="vt-num">
              {l}
            </Text>
          ))}
        </div>
      </Group>
      {extra}
      {onPrint && (
        <Button fullWidth mt="sm" variant="light" color="kumkum" leftSection={<Printer size={16} />} onClick={onPrint}>
          {printLabel}
        </Button>
      )}
    </Card>
  )
}

// rows: array; renderRow(row) => { key, title, subtitle, onPrint? (omit for no print button), printLabel, extra? (node shown before the print button) }
// Every column the list's rows carry (plain values only), so the export holds all the data, not just the two lines shown.
function exportColumns(rows) {
  const sample = rows[0] || {}
  return Object.keys(sample).filter((k) => sample[k] === null || typeof sample[k] !== 'object').map((k) => ({ label: k, key: k }))
}

// "How far back": all bills, the last N days (any financial year) or this financial year. Saved per browser; every
// "Recent ..." list reloads when it changes.
function HistoryMenu() {
  const queryClient = useQueryClient()
  const [h, setH] = useState(getHistory)
  const [custom, setCustom] = useState(h.days)
  function choose(next) {
    setHistory(next)
    setH(next)
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'recent' })
  }
  const item = (label, active, onClick) => (
    <Menu.Item key={label} onClick={onClick} rightSection={active ? <Check size={14} /> : null} fw={active ? 700 : 400}>
      {label}
    </Menu.Item>
  )
  return (
    <Menu shadow="md" width={230} position="bottom-end" withinPortal closeOnItemClick>
      <Menu.Target>
        <Tooltip label={`History: ${historyLabel(h)}`} withArrow>
          <ActionIcon variant="light" color="kumkum" size={32} aria-label={`Show history: ${historyLabel(h)}`}>
            <History size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Show bills from</Menu.Label>
        {item('All bills', h.mode === 'all', () => choose({ ...h, mode: 'all' }))}
        {[7, 30, 90, 365].map((d) => item(`Last ${d} days`, h.mode === 'days' && h.days === d, () => { setCustom(d); choose({ mode: 'days', days: d }) }))}
        {item('This financial year', h.mode === 'fy', () => choose({ ...h, mode: 'fy' }))}
        <Menu.Divider />
        <Menu.Label>Custom number of days</Menu.Label>
        <Group gap={6} px="xs" pb="xs" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
          <NumberInput aria-label="Number of days" size="xs" min={1} max={36500} hideControls value={custom} onChange={(v) => setCustom(Number(v) || '')} w={90} />
          <Button size="xs" color="kumkum" onClick={() => custom && choose({ mode: 'days', days: Number(custom) })}>Apply</Button>
        </Group>
      </Menu.Dropdown>
    </Menu>
  )
}

/** Everything searchable about a bill: its title / subtitle and every plain value of the row (dates also as DD/MM/YYYY and DD-MMM-YYYY). */
function rowText(row, r) {
  const parts = [r.title, r.subtitle]
  for (const v of Object.values(row || {})) {
    if (v == null || typeof v === 'object') continue
    const t = String(v)
    parts.push(t)
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      const d = dayjs(t)
      if (d.isValid()) parts.push(d.format('DD/MM/YYYY'), d.format('DD-MMM-YYYY'))
    }
  }
  return parts.join(' ').toLowerCase()
}

export function RecentCard({ title, icon: Icon, loading, rows, renderRow, emptyTitle, emptyHint, docId }) {
  const [listOpen, setListOpen] = useState(false)
  const [q, setQ] = useState('')
  const rights = useRights()
  const rp = useRowPrint(docId, title) // Preview / Print on every bill, for any document that has a print format
  const needle = q.trim().toLowerCase()
  const shown = needle ? rows.filter((row) => rowText(row, renderRow(row)).includes(needle)) : rows
  return (
    <Card withBorder p="md" className="vt-recent-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Group gap={8} mb="xs" style={{ flex: '0 0 auto' }} wrap="nowrap">
        <Icon size={18} color="var(--vt-accent)" aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title order={5}>{title}</Title>
          <Text size="xs" c="dimmed">{historyLabel()}{!loading ? ` - ${needle ? `${shown.length} of ${rows.length}` : rows.length >= HISTORY_TOP ? `newest ${rows.length}` : rows.length} bill${(needle ? shown.length : rows.length) === 1 ? '' : 's'}` : ''}</Text>
        </div>
        <HistoryMenu />
        {docId && (
          <Tooltip label="List all records" withArrow>
            <ActionIcon variant="light" color="kumkum" size={32} aria-label="List all records" onClick={() => setListOpen(true)}>
              <ListIcon size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {!loading && rows.length > 0 && (
          <ExportExcelButton iconOnly filename={String(title)} rows={rows} columns={exportColumns(rows)} label={`Export ${title} to Excel`} />
        )}
      </Group>
      {!loading && rows.length > 0 && (
        <TextInput
          size="xs"
          mb="xs"
          style={{ flex: '0 0 auto' }}
          leftSection={<Search size={14} />}
          placeholder="Search bills: number, name, mobile, amount, date"
          aria-label={`Search ${title}`}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          rightSection={q ? <ActionIcon variant="subtle" color="gray" size={24} aria-label="Clear search" onClick={() => setQ('')}><X size={13} /></ActionIcon> : null}
        />
      )}
      {listOpen && <ListingGrid docId={docId} opened onClose={() => setListOpen(false)} initialSearch={q} />}
      {rp.dialog}
      {loading ? (
        <Stack gap="xs">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={38} radius="md" />
          ))}
        </Stack>
      ) : rows.length === 0 ? (
        <EmptyState icon={Icon} title={emptyTitle} hint={`${emptyHint} ${historyLabel()}${getHistory().mode === 'fy' && getFyShort() ? ` (${getFyShort()})` : ''} - use the clock button to look further back.`} />
      ) : shown.length === 0 ? (
        <Stack gap="xs" align="center" py="md">
          <Text size="sm" c="dimmed" ta="center">No bill matches "{q.trim()}" in this list.</Text>
          {docId && <Button size="xs" variant="light" color="kumkum" leftSection={<Search size={14} />} onClick={() => setListOpen(true)}>Search all records</Button>}
        </Stack>
      ) : (
        <Stack gap={2} className="vt-recent-list" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <AnimatePresence initial={false}>
          {shown.map((row) => {
            const r = renderRow(row)
            return (
              <motion.div key={r.key} layout={shown.length <= 60 ? 'position' : false} initial={shown.length <= 60 ? { opacity: 0, y: -10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
                <Group justify="space-between" wrap="nowrap" gap="xs" className="vt-recent-row">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} className="vt-num">
                      {r.title}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {r.subtitle}
                    </Text>
                  </div>
                  <Group gap={2} wrap="nowrap">
                    {r.extra}
                    {rp.can ? (
                      <>
                        <Tooltip label="Preview" withArrow>
                          <ActionIcon variant="subtle" color="kumkum" size={32} aria-label={`Preview ${r.title}`} onClick={() => rp.preview(r.key)}>
                            <Eye size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Print" withArrow>
                          <ActionIcon variant="light" color="kumkum" size={32} aria-label={`Print ${r.title}`} onClick={() => rp.print(r.key)}>
                            <Printer size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </>
                    ) : (
                      r.onPrint && rights.print && (
                        <ActionIcon variant="light" color="kumkum" size={36} aria-label={r.printLabel} onClick={r.onPrint}>
                          <Printer size={16} />
                        </ActionIcon>
                      )
                    )}
                  </Group>
                </Group>
              </motion.div>
            )
          })}
          </AnimatePresence>
        </Stack>
      )}
    </Card>
  )
}


// A small clay lamp that lights up when a document is saved: the flame flickers, a gold ring ripples once.
// Pure CSS (no images), motion is switched off for prefers-reduced-motion.
function Diya() {
  return (
    <div className="vt-diya" aria-hidden>
      <span className="vt-diya-ring" />
      <span className="vt-diya-flame" />
      <span className="vt-diya-bowl" />
      <style>{`
        .vt-diya { position: relative; width: 34px; height: 34px; flex-shrink: 0; }
        .vt-diya-bowl { position: absolute; left: 4px; right: 4px; bottom: 4px; height: 11px; border-radius: 0 0 20px 20px; background: linear-gradient(180deg, #D4A63F, #A97F32); }
        .vt-diya-flame { position: absolute; left: 50%; bottom: 14px; width: 10px; height: 16px; margin-left: -5px; border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; background: radial-gradient(circle at 50% 70%, #FFF3C4 0%, #F5B040 45%, #E07B16 100%); transform-origin: 50% 90%; box-shadow: 0 0 12px 3px rgba(245,176,64,0.55); animation: vt-flicker 1.6s ease-in-out infinite; }
        .vt-diya-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid #D4A63F; opacity: 0; animation: vt-ripple 1.2s ease-out 1; }
        @keyframes vt-flicker { 0%,100% { transform: scale(1) rotate(-2deg); } 35% { transform: scale(1.08, 1.14) rotate(2deg); } 70% { transform: scale(0.96, 1.02) rotate(-1deg); } }
        @keyframes vt-ripple { 0% { opacity: 0.8; transform: scale(0.5); } 100% { opacity: 0; transform: scale(1.5); } }
        @media (prefers-reduced-motion: reduce) { .vt-diya-flame, .vt-diya-ring { animation: none; } }
      `}</style>
    </div>
  )
}

/** Page title row used by entry screens: gopuram mark, title and subtitle. (Keyboard shortcuts still work; the hint chips were removed.) */
/** Title row of an entry screen. `right` = something for the right of the same row (e.g. the bill no and date), kept clear of the summary column. */
export function PageHeader({ title, subtitle, right }) {
  return (
    <Group gap="sm" wrap="wrap" justify="space-between" align="flex-end">
      <Group gap="sm" wrap="nowrap">
        <img src="/illustrations/gopuram-mark.svg" alt="" aria-hidden style={{ height: 40, width: 40 }} />
        <div>
          <Title order={2}>{title}</Title>
          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>
      </Group>
      {right && <div className="vt-header-right">{right}</div>}
    </Group>
  )
}

const stripStyle = { border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', borderRadius: 16, overflow: 'hidden' }

/**
 * A card of the entry screens like the Purchase Bill's top strip: a header row (title, optional key content, a "Doc Details" button)
 * and a collapsible body for the document's detail fields.
 */
export function DetailsStrip({ title, hint, top, children, defaultOpen = true, toggleLabel = 'Doc Details' }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={stripStyle}>
      <Group justify="space-between" align="center" p="sm" wrap="wrap" gap="xs" style={{ borderBottom: open ? '1px solid var(--vt-line)' : undefined }}>
        <div>
          <Text fw={700}>{title}</Text>
          {hint && <Text size="xs" c="dimmed">{hint}</Text>}
        </div>
        <Group gap="sm" wrap="wrap">
          {top}
          <Button variant="default" leftSection={<SlidersHorizontal size={15} />} rightSection={open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {toggleLabel}
          </Button>
        </Group>
      </Group>
      <Collapse in={open}>
        <div style={{ padding: 16, background: 'var(--vt-sandal)' }}>{children}</div>
      </Collapse>
    </div>
  )
}

/** The line-items card of the entry screens: title, count chips and an action (Add item ...) on top, the grid below. */
export function LineItemsCard({ title, chips = [], action, children }) {
  return (
    <div style={stripStyle}>
      <Group justify="space-between" align="center" p="sm" wrap="wrap" gap="xs" style={{ borderBottom: '1px solid var(--vt-line)' }}>
        <Group gap={8} wrap="wrap">
          <Text fw={700}>{title}</Text>
          {chips.map((c) => (
            <Badge key={c.label} variant="light" color={c.color || 'kumkum'} tt="none">{c.label}: {c.value}</Badge>
          ))}
        </Group>
        {action}
      </Group>
      <div style={{ padding: 12, overflow: 'auto' }}>{children}</div>
    </div>
  )
}
