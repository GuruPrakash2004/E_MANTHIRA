import { useState } from 'react'
import { Card, Grid, SimpleGrid, Stack, Table, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Boxes, Coins, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'
import { ReportTable } from './ReportParts'
import StatCard from '../../components/ui/StatCard'
import { PageHeader } from '../../components/ui/EntryParts'
import { formatINR } from '../../utils/format'

const LOCATION_DOC_ID = 1123

/**
 * Stock Balance Report, port of frmRptStockBal: as-of-date balance per item (+ location), valued at the last
 * recorded inward rate. Updates as you change the filters.
 */
export default function StockBalanceReportPage() {
  const [asOfDate, setAsOfDate] = useState(new Date())
  const [locId, setLocId] = useState('')
  const [itemCode, setItemCode] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['stock-balance-report', asOfDate, locId, itemCode],
    queryFn: () =>
      inventoryApi.getStockBalanceReport({
        as_of_date: dayjs(asOfDate).format('YYYY-MM-DD'),
        loc_id: locId || undefined,
        item_code: itemCode || undefined,
      }),
  })
  const list = rows || []
  const totalValue = list.reduce((s, r) => s + (Number(r.value) || 0), 0)

  const columns = [
    { key: 'item_group', label: 'Item Group' },
    { key: 'item_code', label: 'Item Code' },
    { key: 'item_name', label: 'Item Name', render: (r) => <b>{r.item_name}</b> },
    { key: 'uom_code', label: 'UOM' },
    { key: 'balance', label: 'Balance', num: true, render: (r) => Number(r.balance).toLocaleString('en-IN') },
    { key: 'rate', label: 'Rate', num: true, render: (r) => formatINR(r.rate) },
    { key: 'value', label: 'Value', num: true, render: (r) => formatINR(r.value) },
  ]

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Stock Balance Report" subtitle="Item-wise closing balance and value as of a chosen date" shortcuts={[]} />

      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <DateInput label="As of Date" value={asOfDate} onChange={setAsOfDate} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <MasterOptionsSelect docId={LOCATION_DOC_ID} label="Location" value={locId} onChange={setLocId} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Item code contains" leftSection={<Search size={16} />} value={itemCode} onChange={(e) => setItemCode(e.currentTarget.value)} placeholder="e.g. RICE" />
          </Grid.Col>
        </Grid>
      </Card>

      <SimpleGrid cols={{ base: 1, xs: 2 }}>
        <StatCard label="Stock lines" value={list.length} icon={Boxes} loading={isLoading} footer={`As of ${dayjs(asOfDate).format('DD/MM/YYYY')}`} />
        <StatCard label="Total stock value" value={formatINR(totalValue)} icon={Coins} tone="dark" loading={isLoading} footer="At the last inward rate" />
      </SimpleGrid>

      <ReportTable
        columns={columns}
        rows={list}
        loading={isLoading}
        emptyTitle="No stock balances to show"
        emptyHint="Change the date, location or item code."
        minWidth={760}
        footer={
          <Table.Tr>
            <Table.Th colSpan={6} ta="right">
              Total value
            </Table.Th>
            <Table.Th ta="right" className="vt-num">
              {formatINR(totalValue)}
            </Table.Th>
          </Table.Tr>
        }
      />
    </Stack>
  )
}
