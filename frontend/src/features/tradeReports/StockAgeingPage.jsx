import { useState } from 'react'
import { Button, Card, Grid, Group, MultiSelect, Stack, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { FileSpreadsheet, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as mastersApi from '../../api/endpoints/masters'
import { downloadCsv } from '../../utils/csv'
import * as tradeApi from '../../api/endpoints/tradeReports'
import { ReportTable } from '../inventory/ReportParts'
import { PageHeader } from '../../components/ui/EntryParts'

const ITEM_GROUP_DOC_ID = 1110
const RANGES_OK = /^\s*\d+\s*-\s*\d*\s*(,\s*\d+\s*-\s*\d*\s*)*$/

/**
 * Stock Ageing Report — port of FrmRptSTKBALAgeing. Inward stock from UtlStockList is bucketed by age (days before
 * the "as on" date); the closing balance is spread over the buckets as FillRangeValues does.
 */
export default function StockAgeingPage() {
  const [asOn, setAsOn] = useState(new Date())
  const [ranges, setRanges] = useState('0-30,31-60,61-90,91-')
  const [groupIds, setGroupIds] = useState([])
  const navigate = useNavigate()
  const { data: groupData } = useQuery({ queryKey: ['master-options', ITEM_GROUP_DOC_ID], queryFn: () => mastersApi.listMaster(ITEM_GROUP_DOC_ID) })
  const gm = groupData?.meta
  const groupOptions = (groupData?.rows || []).filter((r) => r[gm?.id_col] !== 0).map((r) => ({ value: String(r[gm.id_col]), label: r[gm.name_col] }))

  const rangesValid = RANGES_OK.test(ranges)
  const { data, isLoading } = useQuery({
    queryKey: ['stock-ageing', asOn, ranges, groupIds],
    queryFn: () => tradeApi.getStockAgeing({ as_on: dayjs(asOn).format('YYYY-MM-DD'), ranges: ranges.replace(/\s/g, ''), item_group_ids: groupIds.length ? groupIds.join(',') : undefined }),
    enabled: rangesValid,
  })

  const labels = data?.labels || []
  const columns = [
    { key: 'item_group', label: 'Item Group' },
    { key: 'item_code', label: 'Item Code' },
    { key: 'item_name', label: 'Item Name', render: (r) => <b>{r.item_name}</b> },
    { key: 'uom_code', label: 'UOM' },
    { key: 'balance', label: 'Balance', num: true, render: (r) => Number(r.balance).toLocaleString('en-IN') },
    ...labels.map((l, i) => ({ key: `b${i}`, label: l, num: true, render: (r) => (r.buckets[i] == null ? '' : Number(r.buckets[i]).toLocaleString('en-IN')) })),
  ]

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Stock Ageing Report" subtitle="How long the stock on hand has been sitting, in age buckets" shortcuts={[]} />
      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <DateInput label="As On" value={asOn} onChange={setAsOn} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <MultiSelect label="Selected Group" placeholder={groupIds.length ? undefined : 'All item groups'} data={groupOptions} value={groupIds} onChange={setGroupIds} searchable clearable />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput
              label="Age ranges (days)"
              description="From-To pairs, comma separated; leave the end blank for open-ended"
              value={ranges}
              onChange={(e) => setRanges(e.currentTarget.value)}
              error={rangesValid ? null : 'Use the form 0-30,31-60,91-'}
            />
          </Grid.Col>
        </Grid>
      </Card>
      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={() => { setAsOn(new Date()); setRanges('0-30,31-60,61-90,91-'); setGroupIds([]) }}>Clear</Button>
        <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!(data?.rows || []).length} onClick={() => downloadCsv('Stock Ageing.csv', data.rows, columns.map((c, i) => ({ label: c.label, value: (r) => (i >= 5 ? r.buckets[i - 5] : r[c.key]) })))}>Export to Excel</Button>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
      <ReportTable
        columns={columns}
        rows={data?.rows || []}
        loading={isLoading}
        idle={!rangesValid}
        idleTitle="Enter valid age ranges"
        idleHint="For example 0-30,31-60,61-90,91-"
        emptyTitle="No stock to age"
        emptyHint="There are no stock movements up to this date. Ageing reads the stock list written by Purchase Bill, Stock Adjustment and Store Issue."
        minWidth={820}
      />
    </Stack>
  )
}
