import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Grid, Group, Modal, Radio, ScrollArea, Select, Stack, Text, UnstyledButton } from '@mantine/core'
import { DatePickerInput } from '../../components/ui/AppDates'
import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Printer, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import * as inventoryApi from '../../api/endpoints/inventory'
import ItemListPicker from './ItemListPicker'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { PageHeader } from '../../components/ui/EntryParts'
import { downloadXls } from '../../utils/xls'
import { isoDate } from '../../utils/format'
import dayjs from 'dayjs'
import ReportPrintButtons from '../../components/ui/ReportPrint'

const q2 = (v) => (v == null ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

/**
 * The document-wise result as a table whose Item Group Name cell spans all the rows of its group (legacy grid: merged column 0),
 * the group name centred in the merged cell; a grand total row closes it.
 */
function SpanTable({ columns, rows, footer }) {
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--vt-line)', borderRight: '1px solid var(--vt-line)', background: 'var(--vt-sandal)', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
  const td = { padding: '6px 10px', borderBottom: '1px solid var(--vt-line)', borderRight: '1px solid var(--vt-line)', whiteSpace: 'nowrap' }
  // rows of one group = the first row (carries the group name) + the following rows with an empty group, up to the total row
  const spans = rows.map((r, i) => {
    if (r._kind === 'total' || !r.group) return 0
    let n = 1
    while (i + n < rows.length && rows[i + n]._kind !== 'total' && !rows[i + n].group) n += 1
    return n
  })
  return (
    <div style={{ border: '1px solid var(--vt-line)', borderRadius: 12, background: 'var(--vt-surface)', overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 200 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
          <thead>
            <tr>{columns.map((c) => <th key={c.key} style={{ ...th, textAlign: c.num ? 'right' : 'left' }}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const total = r._kind === 'total'
              return (
                <tr key={r._key} style={total ? { background: 'var(--vt-gold-chip)', fontWeight: 700 } : undefined}>
                  {columns.map((c, ci) => {
                    if (ci === 0 && !total) {
                      if (!spans[i]) return null // swallowed by the merged cell above
                      return <td key={c.key} rowSpan={spans[i]} style={{ ...td, verticalAlign: 'middle', background: 'var(--vt-sandal)', fontWeight: 600 }}>{r.group}</td>
                    }
                    return <td key={c.key} className={c.num ? 'vt-num' : undefined} style={{ ...td, textAlign: c.num ? 'right' : 'left' }}>{c.render ? c.render(r) : r[c.key]}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {footer && <div style={{ padding: '6px 12px', fontSize: 12, color: 'var(--mantine-color-dimmed)', borderTop: '1px solid var(--vt-line)' }}>{footer}</div>}
    </div>
  )
}

/**
 * Stock Balance Report (legacy frmRptStockBal), "OP Rcpt Issue Balance": per item - opening, receipts, issues and closing
 * quantity, optionally with values by the client's valuation method. Items can be limited to chosen groups / items and a
 * location. Totals per item group and a grand total are shown, on a virtualised grid.
 */
export default function StockBalanceReportPage() {
  const navigate = useNavigate()
  const fyStart = dayjs().month() >= 3 ? dayjs().month(3).startOf('month').toDate() : dayjs().subtract(1, 'year').month(3).startOf('month').toDate()
  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(new Date())
  const [locId, setLocId] = useState(null)
  const [useGroup, setUseGroup] = useState(false)
  const [groups, setGroups] = useState([])
  const [showValue, setShowValue] = useState(false)
  const [hideZero, setHideZero] = useState(true)
  const [items, setItems] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false) // the "Select [Multiple] Item Groups" window
  const [mode, setMode] = useState('ri') // ri = OP Rcpt Issue Balance, dw = OP << document wise >> Balance

  const { data: lookups } = useQuery({ queryKey: ['stock-report-lookups'], queryFn: inventoryApi.stockReportLookups })

  async function view() {
    if (useGroup && groups.length === 0) return notifications.show({ message: 'Item Group Selection required from the list', color: 'red' })
    setLoading(true)
    try {
      setResult(
        await (mode === 'dw' ? inventoryApi.stockBalanceDocwise : inventoryApi.stockBalance)({
          from_date: isoDate(from), to_date: isoDate(to), loc_id: locId || undefined, show_value: showValue, hide_zero: hideZero,
          item_ids: items.length ? items.map((i) => i.id).join(',') : undefined, group_ids: useGroup ? groups.join(',') : undefined,
        })
      )
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not run the report', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  const dw = result?.mode === 'docwise'
  const withValue = Boolean(result && result.rows.length > 0 && 'op_value' in result.rows[0])
  const numKeys = withValue ? ['op_qty', 'op_value', 'rcpt_qty', 'rcpt_value', 'issue_qty', 'issue_value', 'closing_qty', 'closing_value'] : ['op_qty', 'rcpt_qty', 'issue_qty', 'closing_qty']
  const riColumns = useMemo(
    () => [
      { key: 'group', label: 'Item Group Name', width: 180 },
      { key: 'item_code', label: 'Item Code', width: 120 },
      { key: 'item_name', label: 'Item Name', width: 220 },
      { key: 'uom', label: 'UOM', width: 80 },
      ...[['op_qty', 'Op Qty'], ['op_value', 'Op Value'], ['rcpt_qty', 'Rcpt Qty'], ['rcpt_value', 'Rcpt Value'], ['issue_qty', 'Issue Qty'], ['issue_value', 'Issue Value'], ['closing_qty', 'Closing Quantity'], ['closing_value', 'Closing Value']]
        .filter(([k]) => numKeys.includes(k))
        .map(([k, label]) => ({ key: k, label, width: 130, num: true, render: (r) => q2(r[k]) })),
    ],
    [withValue] // eslint-disable-line react-hooks/exhaustive-deps
  )
  // item rows with a subtotal after each group and a grand total (legacy Subtotal)
  const riRows = useMemo(() => {
    if (!result || dw) return []
    const out = []
    const sum = (list) => Object.fromEntries(numKeys.map((k) => [k, list.reduce((t, r) => t + (r[k] || 0), 0)]))
    let cur = null, bucket = []
    const flush = () => { if (cur !== null) out.push({ _kind: 'subtotal', _key: `s-${cur}`, group: `${cur} Total`, ...sum(bucket) }) }
    result.rows.forEach((r) => {
      if (r.group !== cur) { flush(); cur = r.group; bucket = [] }
      bucket.push(r)
      out.push(r)
    })
    flush()
    if (result.rows.length) out.push({ _kind: 'total', _key: 'total', group: 'Grand Total', ...sum(result.rows) })
    return out
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  // "OP << document wise >> Balance" (legacy ViewClDetailed): OP Qty, one column per document type that moved stock, Cl Qty
  const dwColumns = useMemo(() => {
    if (!dw) return []
    const cols = [
      { key: 'group', label: 'Item Group Name', width: 180 },
      { key: 'item_code', label: 'Item Code', width: 120 },
      { key: 'item_name', label: 'Item Name', width: 220 },
      { key: 'uom', label: 'UOM', width: 80 },
    ]
    const num = (key, label) => cols.push({ key, label, width: 120, num: true, render: (r) => (r[key] == null || r[key] === '' ? '' : q2(r[key])) })
    num('op_qty', 'OP Qty')
    if (withValue) num('op_value', 'OP Value')
    result.doc_types.forEach((dt) => {
      num(`q_${dt}`, `${dt} Qty`)
      if (withValue) num(`v_${dt}`, `${dt} Value`)
    })
    num('cl_qty', 'Cl Qty')
    if (withValue) num('cl_value', 'Cl Value')
    return cols
  }, [result, dw, withValue])
  const dwRows = useMemo(() => {
    if (!dw) return []
    const out = []
    let cur = null
    result.rows.forEach((r) => {
      const row = { _key: `i-${r.item_id}`, group: r.group !== cur ? r.group : '', item_code: r.item_code, item_name: r.item_name, uom: r.uom, op_qty: r.op_qty || '', op_value: r.op_value, cl_qty: r.cl_qty, cl_value: r.cl_value }
      cur = r.group
      result.doc_types.forEach((dt) => {
        row[`q_${dt}`] = r.docs[dt] ?? ''
        if (withValue) row[`v_${dt}`] = r.doc_values?.[dt] ?? ''
      })
      out.push(row)
    })
    if (result.rows.length) {
      // the legacy grid totals the document columns and Cl Qty, not the opening column
      const t = { _kind: 'total', _key: 'total', group: '', cl_qty: result.totals.cl_qty, cl_value: result.totals.cl_value }
      result.doc_types.forEach((dt) => {
        t[`q_${dt}`] = result.totals.docs[dt]
        if (withValue) t[`v_${dt}`] = result.totals.doc_values?.[dt]
      })
      out.push(t)
    }
    return out
  }, [result, dw, withValue])
  const columns = dw ? dwColumns : riColumns
  const rows = dw ? dwRows : riRows

  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Stock Balance Report" subtitle="Opening, receipts, issues and closing stock per item" shortcuts={[]} />
      <Card withBorder p="md">
        <Grid align="flex-start">
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Stack gap="sm">
              <Group gap="md" align="flex-end" wrap="wrap">
                <DatePickerInput className="vt-field-required" label="From" valueFormat="DD-MMM-YYYY" value={from} onChange={setFrom} w={150} />
                <DatePickerInput className="vt-field-required" label="To" valueFormat="DD-MMM-YYYY" value={to} onChange={setTo} w={150} />
                <Button color="kumkum" leftSection={<Eye size={16} />} loading={loading} onClick={view}>View</Button>
              </Group>
              {/* Location with the balance type to its right, so the page keeps its height for the report below */}
              <Group gap="lg" align="flex-end" wrap="nowrap">
                <Select label="Location" placeholder="All locations" clearable searchable data={(lookups?.locations || []).map((l) => ({ value: String(l.id), label: l.name }))} value={locId ? String(locId) : null} onChange={(v) => setLocId(v ? Number(v) : null)} w={220} style={{ flexShrink: 0 }} />
                <Radio.Group value={mode} onChange={setMode} aria-label="Balance type">
                  <Group gap="lg" wrap="nowrap" pb={6}>
                    <Radio color="kumkum" value="ri" label="OP Rcpt Issue Balance" styles={{ label: { whiteSpace: 'nowrap' } }} />
                    <Radio color="kumkum" value="dw" label="OP << document wise >> Balance" styles={{ label: { whiteSpace: 'nowrap' } }} />
                  </Group>
                </Radio.Group>
              </Group>
              <Group gap="lg" wrap="wrap">
                <Group gap={8} wrap="nowrap">
                  <Checkbox color="kumkum" label="Selected Group" checked={useGroup} onChange={(e) => { setUseGroup(e.currentTarget.checked); if (e.currentTarget.checked) setGroupsOpen(true); else setGroups([]) }} />
                  {useGroup && groups.length > 0 && (
                    <UnstyledButton onClick={() => setGroupsOpen(true)} style={{ color: 'var(--vt-accent)', fontSize: 13, fontWeight: 700, textDecoration: 'underline' }} aria-label="Change the selected item groups">
                      {groups.length} group{groups.length === 1 ? '' : 's'} selected
                    </UnstyledButton>
                  )}
                </Group>
                <Checkbox color="kumkum" label="Show Value" checked={showValue} onChange={(e) => setShowValue(e.currentTarget.checked)} />
              </Group>
              {showValue && <Text size="xs" c="dimmed">Valuation Method : {lookups?.valuation_name || ''}</Text>}
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <ItemListPicker value={items} onChange={setItems} />
          </Grid.Col>
        </Grid>
      </Card>

      {dw && result && (
        <Card withBorder p="xs" style={{ background: 'var(--vt-sandal)' }}>
          <Text size="sm" fw={600}>{result.company}</Text>
          <Text size="sm" fw={600}>{result.title}</Text>
          <Text size="sm">{result.period}</Text>
        </Card>
      )}
      {dw && result?.rows?.length > 0 ? (
        <SpanTable columns={columns} rows={rows} footer={`${result.count} item(s)`} />
      ) : (
        <ScaleGrid columns={columns} rows={rows} loading={loading} emptyTitle={result ? 'No items to report' : 'Press View'} emptyHint={result ? 'There are no items with stock under this criteria.' : 'Choose the period and press View.'} footer={result ? `${result.count} item(s)` : undefined} />
      )}

      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!rows.length} onClick={() => downloadXls('Stock Balance.xls', rows, columns.map((c) => ({ label: c.label, value: (r) => (c.num ? (r[c.key] == null ? '' : Number(r[c.key]).toFixed(2)) : r[c.key]) })))}>Excel</Button>
          <ReportPrintButtons
            title={dw ? 'Stock Balance Report - Document wise' : 'Stock Balance Report'}
            period={dw ? result?.period : `Period From ${dayjs(from).format('DD/MM/YYYY')} To ${dayjs(to).format('DD/MM/YYYY')}`}
            filters={[locId && (lookups?.locations || []).find((l) => l.id === locId)?.name && `Location: ${(lookups?.locations || []).find((l) => l.id === locId)?.name}`, items.length && `${items.length} item(s) selected`, useGroup && groups.length && `${groups.length} group(s) selected`].filter(Boolean).join('  |  ')}
            columns={columns}
            rows={rows}
            groupKey={dw ? 'group' : undefined}
            hotkey
          />
          <Checkbox color="kumkum" label="Do Not Show Items With Zero Balance" checked={hideZero} onChange={(e) => setHideZero(e.currentTarget.checked)} />
        </Group>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
      <Modal
        opened={groupsOpen}
        onClose={() => { setGroupsOpen(false); if (!groups.length) setUseGroup(false) }}
        size="sm"
        radius="lg"
        centered
        title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Select [Multiple] Item Groups</Text>}
      >
        <Stack gap="sm">
          <Checkbox
            color="kumkum"
            label="Select All"
            checked={(lookups?.item_groups || []).length > 0 && groups.length === (lookups?.item_groups || []).length}
            indeterminate={groups.length > 0 && groups.length < (lookups?.item_groups || []).length}
            onChange={(e) => setGroups(e.currentTarget.checked ? (lookups?.item_groups || []).map((g) => String(g.id)) : [])}
          />
          <ScrollArea.Autosize mah={320}>
            <Checkbox.Group value={groups} onChange={setGroups} aria-label="Item groups">
              <Stack gap={8}>
                {(lookups?.item_groups || []).map((g) => (
                  <Checkbox key={g.id} color="kumkum" value={String(g.id)} label={g.name} />
                ))}
              </Stack>
            </Checkbox.Group>
          </ScrollArea.Autosize>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{groups.length} selected</Text>
            <Group gap="xs">
              <Button color="kumkum" onClick={() => { if (!groups.length) setUseGroup(false); setGroupsOpen(false) }}>OK</Button>
              <Button variant="default" onClick={() => { setGroupsOpen(false); if (!groups.length) setUseGroup(false) }}>Cancel</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
      {!lookups && <Alert color="gray" variant="light">Loading report options…</Alert>}
    </Stack>
  )
}
