import { useState } from 'react'
import { Card, Grid, SimpleGrid, Stack } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ArrowDownToLine, ArrowUpFromLine, Scale } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'
import { ReportTable } from './ReportParts'
import StatCard from '../../components/ui/StatCard'
import { PageHeader } from '../../components/ui/EntryParts'

const ITEM_DOC_ID = 1114
const LOCATION_DOC_ID = 1123
const qty = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })

/**
 * Stock Ledger Report, port of frmRptStockLed: a transaction-by-transaction movement history for one item,
 * with a running balance.
 */
export default function StockLedgerReportPage() {
  const [itemId, setItemId] = useState('')
  const [locId, setLocId] = useState('')
  const [fromDate, setFromDate] = useState(dayjs().startOf('year').toDate())
  const [toDate, setToDate] = useState(new Date())

  const { data: rows, isLoading } = useQuery({
    queryKey: ['stock-ledger-report', itemId, locId, fromDate, toDate],
    queryFn: () =>
      inventoryApi.getStockLedgerReport({
        item_id: itemId,
        loc_id: locId || undefined,
        from_date: dayjs(fromDate).format('YYYY-MM-DD'),
        to_date: dayjs(toDate).format('YYYY-MM-DD'),
      }),
    enabled: Boolean(itemId),
  })
  const list = rows || []
  const totalIn = list.reduce((s, r) => s + (Number(r.in_qty) || 0), 0)
  const totalOut = list.reduce((s, r) => s + (Number(r.out_qty) || 0), 0)
  const closing = list.length ? Number(list[list.length - 1].running_balance) : 0

  const columns = [
    { key: 'doc_date', label: 'Date', render: (r) => dayjs(r.doc_date).format('DD/MM/YYYY') },
    { key: 'doc', label: 'Document', render: (r) => `${r.doc_name} · ${r.doc_no}` },
    { key: 'particulars', label: 'Particulars' },
    { key: 'in_qty', label: 'In', num: true, render: (r) => (Number(r.in_qty) ? qty(r.in_qty) : '') },
    { key: 'out_qty', label: 'Out', num: true, render: (r) => (Number(r.out_qty) ? qty(r.out_qty) : '') },
    { key: 'running_balance', label: 'Balance', num: true, render: (r) => <b>{qty(r.running_balance)}</b> },
  ]

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Stock Ledger Report" subtitle="Every movement of one item, with a running balance" shortcuts={[]} />

      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <MasterOptionsSelect docId={ITEM_DOC_ID} label="Item" required value={itemId} onChange={setItemId} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <MasterOptionsSelect docId={LOCATION_DOC_ID} label="Location" value={locId} onChange={setLocId} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <DateInput label="From" value={fromDate} onChange={setFromDate} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <DateInput label="To" value={toDate} onChange={setToDate} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
        </Grid>
      </Card>

      {itemId && (
        <SimpleGrid cols={{ base: 1, xs: 3 }}>
          <StatCard label="Total in" value={qty(totalIn)} icon={ArrowDownToLine} loading={isLoading} />
          <StatCard label="Total out" value={qty(totalOut)} icon={ArrowUpFromLine} loading={isLoading} />
          <StatCard label="Closing balance" value={qty(closing)} icon={Scale} tone="dark" loading={isLoading} />
        </SimpleGrid>
      )}

      <ReportTable
        columns={columns}
        rows={list}
        loading={Boolean(itemId) && isLoading}
        idle={!itemId}
        idleTitle="Choose an item"
        idleHint="Pick an item above to see its stock ledger."
        emptyTitle="No movements in this range"
        emptyHint="Widen the dates or remove the location filter."
        minWidth={700}
      />
    </Stack>
  )
}
