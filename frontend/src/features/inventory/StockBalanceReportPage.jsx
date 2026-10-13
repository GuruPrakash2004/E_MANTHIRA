import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Grid, Group, MultiSelect, Radio, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Printer, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import * as inventoryApi from '../../api/endpoints/inventory'
import ItemListPicker from './ItemListPicker'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { PageHeader } from '../../components/ui/EntryParts'
import { downloadCsv } from '../../utils/csv'
import { isoDate } from '../../utils/format'
import dayjs from 'dayjs'

const q2 = (v) => (v == null ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

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

  const { data: lookups } = useQuery({ queryKey: ['stock-report-lookups'], queryFn: inventoryApi.stockReportLookups })

  async function view() {
    if (useGroup && groups.length === 0) return notifications.show({ message: 'Item Group Selection required from the list', color: 'red' })
    setLoading(true)
    try {
      setResult(
        await inventoryApi.stockBalance({
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

  const withValue = result && result.rows.length > 0 && 'op_value' in result.rows[0]
  const numKeys = withValue ? ['op_qty', 'op_value', 'rcpt_qty', 'rcpt_value', 'issue_qty', 'issue_value', 'closing_qty', 'closing_value'] : ['op_qty', 'rcpt_qty', 'issue_qty', 'closing_qty']
  const columns = useMemo(
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
  const rows = useMemo(() => {
    if (!result) return []
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

  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Stock Balance Report" subtitle="Opening, receipts, issues and closing stock per item" shortcuts={[]} />
      <Card withBorder p="md">
        <Grid align="flex-start">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="sm">
              <Group gap="md" align="flex-end" wrap="wrap">
                <DatePickerInput className="vt-field-required" label="From" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={150} />
                <DatePickerInput className="vt-field-required" label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={150} />
                <Button color="kumkum" leftSection={<Eye size={16} />} loading={loading} onClick={view}>View</Button>
              </Group>
              <Select label="Location" placeholder="All locations" clearable searchable data={(lookups?.locations || []).map((l) => ({ value: String(l.id), label: l.name }))} value={locId ? String(locId) : null} onChange={(v) => setLocId(v ? Number(v) : null)} w={300} />
              <Group gap="lg">
                <Checkbox color="kumkum" label="Selected Group" checked={useGroup} onChange={(e) => setUseGroup(e.currentTarget.checked)} />
                <Checkbox color="kumkum" label="Show Value" checked={showValue} onChange={(e) => setShowValue(e.currentTarget.checked)} />
              </Group>
              {useGroup && <MultiSelect aria-label="Item groups" placeholder="Select item groups" searchable clearable data={(lookups?.item_groups || []).map((g) => ({ value: String(g.id), label: g.name }))} value={groups} onChange={setGroups} />}
              {showValue && <Text size="xs" c="dimmed">Valuation Method : {lookups?.valuation_name || ''}</Text>}
              <Radio.Group value="ri" aria-label="Balance type">
                <Stack gap={6}>
                  <Radio color="kumkum" value="ri" label="OP Rcpt Issue Balance" />
                  <Radio color="kumkum" value="dw" label="OP << document wise >> Balance" disabled title="Not available in the web app yet" />
                </Stack>
              </Radio.Group>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <ItemListPicker value={items} onChange={setItems} />
          </Grid.Col>
        </Grid>
      </Card>

      {result?.rows?.length === 0 && null}
      <ScaleGrid columns={columns} rows={rows} loading={loading} emptyTitle={result ? 'No items to report' : 'Press View'} emptyHint={result ? 'There are no items with stock under this criteria.' : 'Choose the period and press View.'} footer={result ? `${result.count} item(s)` : undefined} />

      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!rows.length} onClick={() => downloadCsv('Stock Balance.csv', rows, columns.map((c) => ({ label: c.label, value: (r) => (c.num ? (r[c.key] == null ? '' : Number(r[c.key]).toFixed(2)) : r[c.key]) })))}>Excel</Button>
          <Button variant="light" color="kumkum" leftSection={<Printer size={16} />} disabled={!rows.length} onClick={() => window.print()}>Print</Button>
          <Checkbox color="kumkum" label="Do Not Show Items With Zero Balance" checked={hideZero} onChange={(e) => setHideZero(e.currentTarget.checked)} />
        </Group>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
      {!lookups && <Alert color="gray" variant="light">Loading report options…</Alert>}
    </Stack>
  )
}
