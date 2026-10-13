import { useState } from 'react'
import { Button, Card, Checkbox, Grid, Group, MultiSelect, Select, Stack } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import ItemListPicker from './ItemListPicker'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { PageHeader } from '../../components/ui/EntryParts'
import { downloadXls } from '../../utils/xls'
import { isoDate } from '../../utils/format'

const q2 = (v) => (v == null ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

/**
 * Stock Ledger Report (legacy frmRptStockLed): for the chosen items (or every item of the chosen groups) and location,
 * each item's opening, then every movement with a running balance, and a total line per item. The grid is virtualised,
 * so a long ledger stays smooth, and its columns can be resized.
 */
export default function StockLedgerReportPage() {
  const navigate = useNavigate()
  const [from, setFrom] = useState(dayjs().month() >= 3 ? dayjs().month(3).startOf('month').toDate() : dayjs().subtract(1, 'year').month(3).startOf('month').toDate())
  const [to, setTo] = useState(new Date())
  const [locId, setLocId] = useState(null)
  const [items, setItems] = useState([])
  const [useGroup, setUseGroup] = useState(false)
  const [groups, setGroups] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const { data: lookups } = useQuery({ queryKey: ['stock-report-lookups'], queryFn: inventoryApi.stockReportLookups })

  async function view() {
    if (useGroup && groups.length === 0) return notifications.show({ message: 'Select the item group(s)', color: 'red' })
    if (!useGroup && items.length === 0) return notifications.show({ message: 'Select at least one item', color: 'red' })
    setLoading(true)
    try {
      const r = await inventoryApi.stockLedger({
        from_date: isoDate(from),
        to_date: isoDate(to),
        loc_id: locId || undefined,
        item_ids: useGroup ? undefined : items.map((i) => i.id).join(','),
        group_ids: useGroup ? groups.join(',') : undefined,
      })
      setResult(r)
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not run the report', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { key: 'item_code', label: 'Item Code', width: 120 },
    { key: 'item_name', label: 'Item Name', width: 220 },
    { key: 'uom', label: 'UOM', width: 80 },
    { key: 'doc_date', label: 'Doc Date', width: 110, render: (r) => (r.doc_date ? dayjs(r.doc_date).format('DD/MM/YYYY') : '') },
    { key: 'doc_type', label: 'Doc Type', width: 150 },
    { key: 'doc_no', label: 'Doc No', width: 130 },
    { key: 'particulars', label: 'Particulars', width: 220 },
    { key: 'receipts', label: 'Receipts', width: 110, num: true, render: (r) => q2(r.receipts) },
    { key: 'issues', label: 'Issues', width: 110, num: true, render: (r) => q2(r.issues) },
    { key: 'rate', label: 'Rate', width: 100, num: true, render: (r) => q2(r.rate) },
    { key: 'balance', label: 'Balance', width: 110, num: true, render: (r) => q2(r.balance) },
  ]

  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Stock Ledger Report" subtitle="Every movement of the chosen items, with a running balance" shortcuts={[]} />
      <Card withBorder p="md">
        <Grid align="flex-start">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="sm">
              <Group gap="md" align="flex-end" wrap="wrap">
                <DatePickerInput className="vt-field-required" label="For the Period from" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={160} />
                <DatePickerInput className="vt-field-required" label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={160} />
              </Group>
              <Group gap="md" align="flex-end" wrap="wrap">
                <Select label="Select Location" placeholder="All locations" clearable searchable data={(lookups?.locations || []).map((l) => ({ value: String(l.id), label: l.name }))} value={locId ? String(locId) : null} onChange={(v) => setLocId(v ? Number(v) : null)} w={300} />
                <Checkbox color="kumkum" label="Select Item Group" checked={useGroup} onChange={(e) => setUseGroup(e.currentTarget.checked)} mb={8} />
              </Group>
              {useGroup && (
                <MultiSelect aria-label="Item groups" placeholder="Select item groups" searchable clearable data={(lookups?.item_groups || []).map((g) => ({ value: String(g.id), label: g.name }))} value={groups} onChange={setGroups} />
              )}
              <Group>
                <Button color="kumkum" leftSection={<Eye size={16} />} loading={loading} onClick={view}>View</Button>
              </Group>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            {!useGroup && <ItemListPicker value={items} onChange={setItems} />}
          </Grid.Col>
        </Grid>
      </Card>

      {result ? (
        <ScaleGrid columns={columns} rows={result.rows} loading={loading} emptyTitle="No stock movements" emptyHint="There are no stock entries for these items in this period." footer={`${result.count} movement(s)`} />
      ) : (
        <ScaleGrid columns={columns} rows={[]} emptyTitle="Press View" emptyHint="Choose the period and items, then press View." />
      )}

      <Group justify="space-between">
        <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!result?.rows?.length} onClick={() => downloadXls('Stock Ledger.xls', result.rows, columns.map((c) => ({ label: c.label, value: (r) => (c.key === 'doc_date' ? (r.doc_date ? dayjs(r.doc_date).format('DD/MM/YYYY') : '') : r[c.key]) })))}>
          Export to Excel
        </Button>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
    </Stack>
  )
}
