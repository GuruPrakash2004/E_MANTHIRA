import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Grid, Group, Modal, ScrollArea, Select, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { Eraser, FileSpreadsheet, KeyRound, ListFilter, Mail, Palette, Play, Printer, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as reportsApi from '../../api/endpoints/reports'
import { useAuth } from '../../hooks/useAuth'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { isoDate } from '../../utils/format'

const fmtCell = (v) => {
  if (v == null) return ''
  if (typeof v === 'number') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dayjs(v).format('DD/MM/YYYY')
  return String(v)
}
const keyOf = (f) => `${f.table}|${f.code}`

/**
 * Customised Reports (legacy frmRptCustomiseRptView). Left: search + the reports you may use, grouped, with the
 * description. Right: the report's filters (date ranges, and "..." value pickers collected into Selected Filters),
 * then View Report / Print Report / Email / Excel. Reports are definitions in the database (UtlReportsCR*), so every
 * client sees its own. Design and Import are the legacy report designer and are not part of the web app.
 */
export default function CustomReportsPanel() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isAdmin = user?.user_code?.toUpperCase() === 'ADMIN'
  const [search, setSearch] = useState('')
  const [crid, setCrid] = useState(null)
  const [dates, setDates] = useState({}) // key -> { from, to }
  const [picked, setPicked] = useState([]) // [{ table, code, caption, value }]
  const [selRow, setSelRow] = useState(null)
  const [pickFor, setPickFor] = useState(null)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [rightsOpen, setRightsOpen] = useState(false)

  const { data: reports = [], isLoading } = useQuery({ queryKey: ['custom-reports'], queryFn: reportsApi.listCustomReports })
  const { data: def } = useQuery({ queryKey: ['custom-report-fields', crid], queryFn: () => reportsApi.getCustomReportFields(crid), enabled: Boolean(crid) })

  useEffect(() => {
    if (!def) return
    // legacy fillFilterFields: date filters start at the financial-year start and end today
    const start = dayjs().month() >= 3 ? dayjs().month(3).startOf('month') : dayjs().subtract(1, 'year').month(3).startOf('month')
    const d = {}
    def.filters.filter((f) => f.data_type === 'DATE').forEach((f) => { d[keyOf(f)] = { from: start.toDate(), to: new Date() } })
    setDates(d)
    setPicked([])
    setSelRow(null)
    setResult(null)
  }, [def])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = reports.filter((r) => !q || r.name.toLowerCase().includes(q))
    const groups = []
    list.forEach((r) => {
      let g = groups.find((x) => x.name === r.group)
      if (!g) groups.push((g = { name: r.group, items: [] }))
      g.items.push(r)
    })
    return groups
  }, [reports, search])
  const current = reports.find((r) => r.crid === crid)

  const body = () => ({
    date_filters: (def?.filters || []).filter((f) => f.data_type === 'DATE').map((f) => ({ table: f.table, code: f.code, from: isoDate(dates[keyOf(f)]?.from), to: isoDate(dates[keyOf(f)]?.to) })),
    list_filters: Object.values(
      picked.reduce((acc, p) => {
        const k = keyOf(p)
        acc[k] = acc[k] || { table: p.table, code: p.code, values: [] }
        acc[k].values.push(p.value)
        return acc
      }, {})
    ),
  })
  async function view() {
    if (!crid) return notifications.show({ message: 'Choose a report first', color: 'red' })
    setRunning(true)
    try {
      setResult(await reportsApi.runCustomReport(crid, body()))
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not run the report', color: 'red' })
    } finally {
      setRunning(false)
    }
  }
  async function toExcel() {
    try {
      const blob = await reportsApi.exportCustomReport(crid, body())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${current?.name || 'report'}.xls`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not export', color: 'red' })
    }
  }
  function print() {
    if (!result) return
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
    const head = result.columns.map((c) => `<th>${esc(c.caption)}</th>`).join('')
    const rows = result.rows.map((r) => `<tr>${r.map((v, i) => `<td${typeof v === 'number' ? ' style="text-align:right"' : ''}>${esc(fmtCell(v))}</td>`).join('')}</tr>`).join('')
    const tot = Object.keys(result.totals).length ? `<tr>${result.columns.map((c, i) => `<th style="text-align:right">${i === 0 ? 'Grand Total' : result.totals[c.key] != null ? esc(fmtCell(result.totals[c.key])) : ''}</th>`).join('')}</tr>` : ''
    const w = window.open('', '_blank')
    if (!w) return notifications.show({ message: 'Allow pop-ups to print the report', color: 'yellow' })
    w.document.write(`<!doctype html><title>${esc(result.title)}</title><style>body{font:12px Arial,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 6px}th{background:#eee}</style><h3>${esc(result.title)}</h3><p>${esc(result.period_text)} ${esc(result.filter_text)}</p><table><thead><tr>${head}</tr></thead><tbody>${rows}${tot}</tbody></table>`)
    w.document.close()
    w.focus()
    w.print()
  }

  const listFilters = (def?.filters || []).filter((f) => f.data_type !== 'DATE')
  const dateFilters = (def?.filters || []).filter((f) => f.data_type === 'DATE')

  return (
    <Stack gap="md">
      <Grid>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder p="md">
            <Stack gap="xs">
              <TextInput label="Search Report Name" leftSection={<Search size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
              <ScrollArea h={300} type="auto">
                {isLoading ? null : shown.length === 0 ? (
                  <EmptyState icon={ListFilter} title="No reports" hint="No customised report is available to you." />
                ) : (
                  shown.map((g) => (
                    <div key={g.name}>
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt={6} mb={2}>{g.name}</Text>
                      {g.items.map((r) => (
                        <div
                          key={r.crid}
                          role="button"
                          tabIndex={0}
                          onClick={() => setCrid(r.crid)}
                          onDoubleClick={() => { setCrid(r.crid); setTimeout(view, 0) }}
                          onKeyDown={(e) => e.key === 'Enter' && setCrid(r.crid)}
                          style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', background: r.crid === crid ? 'var(--vt-gold-chip)' : undefined, fontWeight: r.crid === crid ? 600 : 400 }}
                        >
                          {r.name}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </ScrollArea>
              <Textarea label="Report Description" readOnly autosize minRows={2} value={current?.desc || ''} styles={{ input: { color: 'var(--vt-readonly-ink)' } }} />
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder p="md" h="100%">
            <Stack gap="sm">
              <Text fw={600}>{current ? `Report to be Viewed : ${current.name}` : 'Choose a report on the left'}</Text>
              {def && def.filters.length === 0 && <Text size="sm" c="dimmed">This report has no filters.</Text>}
              {dateFilters.map((f) => (
                <Group key={keyOf(f)} align="flex-end" gap="sm" wrap="wrap">
                  <Text w={180} size="sm">{f.caption}</Text>
                  <DatePickerInput aria-label={`${f.caption} from`} valueFormat="DD/MM/YYYY" value={dates[keyOf(f)]?.from || null} onChange={(v) => setDates((d) => ({ ...d, [keyOf(f)]: { ...d[keyOf(f)], from: v } }))} w={140} />
                  <DatePickerInput aria-label={`${f.caption} to`} valueFormat="DD/MM/YYYY" value={dates[keyOf(f)]?.to || null} onChange={(v) => setDates((d) => ({ ...d, [keyOf(f)]: { ...d[keyOf(f)], to: v } }))} w={140} />
                </Group>
              ))}
              {listFilters.map((f) => (
                <Group key={keyOf(f)} gap="sm">
                  <Text w={180} size="sm">{f.caption}</Text>
                  <Tooltip label="Select values to filter on" withArrow>
                    <Button size="compact-md" variant="default" onClick={() => setPickFor(f)} aria-label={`Select ${f.caption}`}>
                      ...
                    </Button>
                  </Tooltip>
                </Group>
              ))}
              {listFilters.length > 0 && (
                <>
                  <Text size="sm" fw={600} mt="xs">Selected Filters</Text>
                  <Table.ScrollContainer minWidth={320} mah={150} type="native">
                    <Table highlightOnHover>
                      <Table.Thead>
                        <Table.Tr><Table.Th>Filtered On</Table.Th><Table.Th>Filtered Value</Table.Th></Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {picked.map((p, i) => (
                          <Table.Tr key={i} onClick={() => setSelRow(i)} style={{ cursor: 'pointer', background: selRow === i ? 'var(--vt-gold-chip)' : undefined }}>
                            <Table.Td>{p.caption}</Table.Td>
                            <Table.Td>{p.value}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                  <Group gap="sm">
                    <Button variant="default" size="xs" leftSection={<Trash2 size={14} />} disabled={selRow == null} onClick={() => { setPicked((p) => p.filter((_, i) => i !== selRow)); setSelRow(null) }}>Remove Filter</Button>
                    <Button
                      variant="default"
                      size="xs"
                      leftSection={<Eraser size={14} />}
                      disabled={picked.length === 0}
                      onClick={async () => { if (await confirm({ title: 'Clear all filters?', message: 'All selected filter values will be removed.', confirmLabel: 'Clear' })) { setPicked([]); setSelRow(null) } }}
                    >
                      Clear All Filters
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Button color="kumkum" leftSection={<Play size={16} />} loading={running} disabled={!crid} onClick={view}>View Report</Button>
          <Button variant="light" color="kumkum" leftSection={<Printer size={16} />} disabled={!result} onClick={print}>Print Report</Button>
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!result?.rows?.length} onClick={toExcel}>Excel</Button>
          <Button variant="light" color="kumkum" leftSection={<Mail size={16} />} disabled={!crid} onClick={() => setEmailOpen(true)}>Email</Button>
        </Group>
        <Group gap="sm">
          <Tooltip label="The report designer is part of the legacy desktop program" withArrow><span><Button variant="default" leftSection={<Palette size={16} />} disabled>Design</Button></span></Tooltip>
          <Tooltip label="Importing report definitions is part of the legacy desktop program" withArrow><span><Button variant="default" leftSection={<Upload size={16} />} disabled>Import</Button></span></Tooltip>
          {isAdmin && <Button variant="default" leftSection={<KeyRound size={16} />} onClick={() => setRightsOpen(true)}>Assign Rights</Button>}
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
        </Group>
      </Group>

      {result && (
        <Card withBorder p={0} style={{ overflow: 'hidden' }}>
          <Group justify="space-between" p="sm">
            <div>
              <Text fw={700}>{result.title}</Text>
              <Text size="xs" c="dimmed">{[result.period_text, result.filter_text].filter(Boolean).join('  ')}</Text>
            </div>
            <Text size="sm" c="dimmed">{result.count} record(s)</Text>
          </Group>
          {result.rows.length === 0 ? (
            <EmptyState icon={ListFilter} title="No records" hint="No records match these filters." />
          ) : (
            <Table.ScrollContainer minWidth={640} mah={560} type="native">
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>{result.columns.map((c) => <Table.Th key={c.key}>{c.caption}</Table.Th>)}</Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.rows.map((r, i) => (
                    <Table.Tr key={i}>{r.map((v, j) => <Table.Td key={j} ta={typeof v === 'number' ? 'right' : undefined} className={typeof v === 'number' ? 'vt-num' : undefined}>{fmtCell(v)}</Table.Td>)}</Table.Tr>
                  ))}
                </Table.Tbody>
                {Object.keys(result.totals).length > 0 && (
                  <Table.Tfoot>
                    <Table.Tr>
                      {result.columns.map((c, i) => (
                        <Table.Th key={c.key} ta={result.totals[c.key] != null ? 'right' : undefined} className="vt-num">{i === 0 ? 'Grand Total' : result.totals[c.key] != null ? fmtCell(result.totals[c.key]) : ''}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Tfoot>
                )}
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      {pickFor && (
        <ValuePicker
          crid={crid}
          field={pickFor}
          already={picked.filter((p) => keyOf(p) === keyOf(pickFor)).map((p) => p.value)}
          onClose={() => setPickFor(null)}
          onApply={(vals) => {
            setPicked((p) => [...p, ...vals.map((value) => ({ table: pickFor.table, code: pickFor.code, caption: pickFor.caption, value }))].sort((a, b) => a.caption.localeCompare(b.caption)))
            setPickFor(null)
          }}
        />
      )}
      {emailOpen && <EmailDialog crid={crid} title={current?.name} body={body} onClose={() => setEmailOpen(false)} />}
      {rightsOpen && <RightsDialog reports={reports} onClose={() => setRightsOpen(false)} />}
    </Stack>
  )
}

/** "..." picker: distinct values of the filter column, tick any number (legacy frmUtlMultiSelection). */
function ValuePicker({ crid, field, already, onClose, onApply }) {
  const { data: values = [], isLoading } = useQuery({ queryKey: ['custom-filter-values', crid, field.table, field.code], queryFn: () => reportsApi.customFilterValues(crid, { table: field.table, code: field.code }) })
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(new Set())
  const list = values.filter((v) => !already.includes(v) && v.toLowerCase().includes(q.toLowerCase()))
  const toggle = (v) => setSel((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n })
  return (
    <Modal opened onClose={onClose} size="md" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Select [Multiple] {field.caption}</Text>}>
      <Stack gap="sm">
        <TextInput data-autofocus leftSection={<Search size={16} />} placeholder="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Checkbox color="kumkum" label="Select All" checked={list.length > 0 && list.every((v) => sel.has(v))} onChange={(e) => setSel(e.currentTarget.checked ? new Set([...sel, ...list]) : new Set([...sel].filter((v) => !list.includes(v))))} />
        <ScrollArea h={300}>
          {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : list.length === 0 ? <Text size="sm" c="dimmed">Nothing to select.</Text> : list.map((v) => (
            <Checkbox key={v} color="kumkum" mb={6} label={v} checked={sel.has(v)} onChange={() => toggle(v)} />
          ))}
        </ScrollArea>
        <Group justify="flex-end">
          <Button color="kumkum" disabled={sel.size === 0} onClick={() => onApply([...sel])}>OK</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function EmailDialog({ crid, title, body, onClose }) {
  const [f, setF] = useState({ to: '', cc: '', subject: title || '', message: '' })
  const [sending, setSending] = useState(false)
  async function send() {
    setSending(true)
    try {
      const r = await reportsApi.emailCustomReport(crid, { ...body(), ...f })
      notifications.show({ message: r.message, color: 'teal' })
      onClose()
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not send the email', color: 'red' })
    } finally {
      setSending(false)
    }
  }
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Email Report</Text>}>
      <Stack gap="sm">
        <TextInput className="vt-field-required" label="To" required description="Separate addresses with ;" value={f.to} onChange={(e) => setF({ ...f, to: e.currentTarget.value })} />
        <TextInput label="CC" value={f.cc} onChange={(e) => setF({ ...f, cc: e.currentTarget.value })} />
        <TextInput label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.currentTarget.value })} />
        <Textarea label="Message" autosize minRows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.currentTarget.value })} />
        <Text size="xs" c="dimmed">The report, with the current filters, is attached as an Excel file.</Text>
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Mail size={16} />} loading={sending} onClick={send}>Send</Button>
          <Button variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function RightsDialog({ reports, onClose }) {
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['catalog-users'], queryFn: reportsApi.customRightsUsers })
  const [userId, setUserId] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const { data: current } = useQuery({ queryKey: ['custom-rights', userId], queryFn: () => reportsApi.customRights(userId), enabled: Boolean(userId) })
  useEffect(() => { if (current) setSel(new Set(current)) }, [current])
  async function save() {
    setSaving(true)
    try {
      await reportsApi.saveCustomRights(userId, [...sel])
      qc.invalidateQueries({ queryKey: ['custom-rights', userId] })
      notifications.show({ message: 'Rights saved', color: 'teal' })
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not save', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Assign Rights</Text>}>
      <Stack gap="sm">
        <Select className="vt-field-required" label="User" required searchable data={users.map((u) => ({ value: String(u.user_id), label: `${u.code} · ${u.name}` }))} value={userId ? String(userId) : null} onChange={(v) => setUserId(v ? Number(v) : null)} />
        {userId && (
          <>
            <Checkbox color="kumkum" label="Select All" checked={reports.length > 0 && sel.size === reports.length} onChange={(e) => setSel(e.currentTarget.checked ? new Set(reports.map((r) => r.crid)) : new Set())} />
            <ScrollArea h={300}>
              {reports.map((r) => <Checkbox key={r.crid} color="kumkum" mb={6} label={`${r.group} · ${r.name}`} checked={sel.has(r.crid)} onChange={() => toggle(r.crid)} />)}
            </ScrollArea>
          </>
        )}
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={!userId} onClick={save}>Save</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
