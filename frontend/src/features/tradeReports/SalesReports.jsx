import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Group, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { api } from '../../api/api'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { PageHeader } from '../../components/ui/EntryParts'
import { downloadXls } from '../../utils/xls'
import { isoDate } from '../../utils/format'

const n2 = (v) => (v == null ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const errText = (e) => e?.response?.data?.detail || 'Could not run the report'

function useSalesReport({ path, daily }) {
  const [from, setFrom] = useState(new Date())
  const [to, setTo] = useState(new Date())
  const [trip, setTrip] = useState(null)
  const [byUser, setByUser] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // legacy fills the Trip No list on load; if the sales tables are missing the database error is shown instead
  const trips = useQuery({ queryKey: ['sales-trips'], queryFn: () => api.get('/trade-reports/sales/trips').then((r) => r.data), retry: false })
  async function view() {
    if (dayjs(from).isAfter(dayjs(to), 'day')) return setError('From date Should Be less than To Date!')
    setLoading(true)
    setError('')
    try {
      const r = await api.get(path, { params: { from_date: isoDate(from), to_date: isoDate(to), trip_no: trip || undefined, by_user: daily ? byUser : undefined } }).then((x) => x.data)
      setResult(r)
    } catch (e) {
      setResult(null)
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }
  return { from, setFrom, to, setTo, trip, setTrip, byUser, setByUser, result, error: error || (trips.error ? errText(trips.error) : ''), loading, view, trips: trips.data || [] }
}

function Filters({ s, daily }) {
  const navigate = useNavigate()
  return (
    <Card withBorder p="md">
      <Stack gap="sm">
        <Group gap="md" align="flex-end" wrap="wrap">
          <Checkbox color="kumkum" label="Date Range" checked disabled mb={8} />
          <DatePickerInput className="vt-field-required" label="From" valueFormat="DD/MM/YYYY" value={s.from} onChange={s.setFrom} w={150} />
          <DatePickerInput className="vt-field-required" label="To" valueFormat="DD/MM/YYYY" value={s.to} onChange={s.setTo} w={150} />
          <Select label="Trip No" placeholder="All trips" clearable searchable data={s.trips} value={s.trip} onChange={s.setTrip} w={220} />
          {daily && <Checkbox color="kumkum" label="Select Sales Person" checked={s.byUser} onChange={(e) => s.setByUser(e.currentTarget.checked)} mb={8} />}
          <Button color="kumkum" leftSection={<Eye size={16} />} loading={s.loading} onClick={s.view}>View</Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
        </Group>
        {s.error && (
          <Alert color="red" variant="light" role="alert" title="vTemple7">
            <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s.error}</Text>
          </Alert>
        )}
      </Stack>
    </Card>
  )
}

/** Daily Sales Report (legacy frmRptDSR): one line per invoice with each item's quantity as a column. */
export function DailySalesPage() {
  const s = useSalesReport({ path: '/trade-reports/sales/daily', daily: true })
  const r = s.result
  const columns = useMemo(() => {
    if (!r) return []
    const base = [
      { key: 'inv_no', label: 'Inv No', width: 130 },
      { key: 'cancelled', label: 'Cancelled', width: 90 },
      { key: 'customer', label: 'Customer Name', width: 220 },
      { key: 'gst_no', label: 'GST NO', width: 150 },
      { key: 'gst', label: 'GST', width: 100, num: true, render: (x) => n2(x.gst) },
      { key: 'net_total', label: 'Net Total', width: 120, num: true, render: (x) => n2(x.net_total) },
    ]
    if (r.show_user) base.push({ key: 'sales_person', label: 'Sales Person', width: 130 })
    if (r.show_credit) base.push({ key: 'vat', label: 'VAT', width: 100, num: true, render: (x) => n2(x.vat) }, { key: 'credit', label: 'Credit', width: 110, num: true, render: (x) => n2(x.credit) })
    return [...base, ...r.item_codes.map((c) => ({ key: `i_${c}`, label: c, width: 100, num: true, render: (x) => (x.items[c] == null ? '' : Number(x.items[c])) }))]
  }, [r])
  const rows = useMemo(() => {
    if (!r?.rows?.length) return []
    const list = r.rows.map((x, i) => ({ ...x, _key: i, ...Object.fromEntries(r.item_codes.map((c) => [`i_${c}`, x.items[c]])) }))
    const sum = (f) => list.reduce((t, x) => t + (f(x) || 0), 0)
    return [...list, { _kind: 'total', _key: 'tot', inv_no: 'Grand Total', gst: sum((x) => x.gst), net_total: sum((x) => x.net_total), vat: sum((x) => x.vat), credit: sum((x) => x.credit), items: Object.fromEntries(r.item_codes.map((c) => [c, sum((x) => x.items[c])])) }]
  }, [r])
  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Daily Sales Report" subtitle="Invoices with the quantity of each item sold" shortcuts={[]} />
      <Filters s={s} daily />
      <ScaleGrid columns={columns} rows={rows} loading={s.loading} emptyTitle={r ? 'No sales in this period' : 'Press View'} emptyHint={r ? undefined : 'Choose the dates and press View.'} />
      <Group>
        <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!rows.length} onClick={() => downloadXls('Daily Sales Report.xls', rows, columns.map((c) => ({ label: c.label, value: (x) => (c.render ? c.render(x) : x[c.key]) })))}>Export to Excel</Button>
      </Group>
    </Stack>
  )
}

/** Product Sales Summary Report (legacy frmRptPdtSLS): quantity, free quantity, average rate and value per product. */
export function ProductSalesPage() {
  const s = useSalesReport({ path: '/trade-reports/sales/product-summary', daily: false })
  const r = s.result
  const columns = [
    { key: 'sl_no', label: 'SlNo', width: 70 },
    { key: 'code', label: 'Code', width: 130 },
    { key: 'product', label: 'Product', width: 280 },
    { key: 'inv_qty', label: 'InvQty', width: 110, num: true, render: (x) => n2(x.inv_qty) },
    { key: 'free_qty', label: 'FreeQty', width: 110, num: true, render: (x) => n2(x.free_qty) },
    { key: 'rate', label: 'Rate', width: 110, num: true, render: (x) => n2(x.rate) },
    { key: 'value', label: 'Value', width: 130, num: true, render: (x) => n2(x.value) },
  ]
  const rows = useMemo(() => {
    if (!r?.rows?.length) return []
    const list = r.rows.map((x, i) => ({ ...x, _key: i }))
    return [...list, { _kind: 'total', _key: 'tot', code: 'Grand Total', inv_qty: list.reduce((t, x) => t + x.inv_qty, 0), free_qty: list.reduce((t, x) => t + x.free_qty, 0), value: list.reduce((t, x) => t + x.value, 0) }]
  }, [r])
  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Product Sales Summary Report" subtitle="What was sold, product by product" shortcuts={[]} />
      <Filters s={s} />
      <ScaleGrid columns={columns} rows={rows} loading={s.loading} emptyTitle={r ? 'No sales in this period' : 'Press View'} emptyHint={r ? undefined : 'Choose the dates and press View.'} />
      <Group>
        <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!rows.length} onClick={() => downloadXls('Product Sales Summary.xls', rows, columns.map((c) => ({ label: c.label, value: (x) => (c.render ? c.render(x) : x[c.key]) })))}>Export to Excel</Button>
      </Group>
    </Stack>
  )
}
