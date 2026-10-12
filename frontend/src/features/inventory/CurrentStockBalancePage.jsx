import { useState } from 'react'
import { Card, Grid, SimpleGrid, Stack, TextInput } from '@mantine/core'
import { Boxes, MapPin, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'
import { ReportTable } from './ReportParts'
import StatCard from '../../components/ui/StatCard'
import { PageHeader } from '../../components/ui/EntryParts'

const LOCATION_DOC_ID = 1123

/**
 * Current Stock Balance, port of frmRptCurStockBal, reading TrnQOH (the legacy running closing-balance table).
 * Updates as you change the filters.
 */
export default function CurrentStockBalancePage() {
  const [locId, setLocId] = useState('')
  const [itemCode, setItemCode] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['stock-balance', locId, itemCode],
    queryFn: () => inventoryApi.getStockBalance({ loc_id: locId || undefined, item_code: itemCode || undefined }),
  })
  const list = rows || []
  const locations = new Set(list.map((r) => r.loc_name)).size

  const columns = [
    { key: 'item_code', label: 'Item Code' },
    { key: 'item_name', label: 'Item Name', render: (r) => <b>{r.item_name}</b> },
    { key: 'uom_code', label: 'UOM' },
    { key: 'loc_name', label: 'Location' },
    { key: 'balance', label: 'Balance', num: true, render: (r) => Number(r.balance).toLocaleString('en-IN') },
  ]

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Current Stock Balance" subtitle="Live closing balance per item and location" shortcuts={[]} />

      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <MasterOptionsSelect docId={LOCATION_DOC_ID} label="Location" value={locId} onChange={setLocId} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <TextInput label="Item code contains" leftSection={<Search size={16} />} value={itemCode} onChange={(e) => setItemCode(e.currentTarget.value)} placeholder="e.g. RICE" />
          </Grid.Col>
        </Grid>
      </Card>

      <SimpleGrid cols={{ base: 1, xs: 2 }}>
        <StatCard label="Stock lines" value={list.length} icon={Boxes} loading={isLoading} footer="Item and location combinations" />
        <StatCard label="Locations" value={locations} icon={MapPin} tone="dark" loading={isLoading} footer="With stock in this view" />
      </SimpleGrid>

      <ReportTable columns={columns} rows={list} loading={isLoading} emptyTitle="No stock balances to show" emptyHint="Change the location or item code, or post a purchase bill to bring stock in." minWidth={600} />
    </Stack>
  )
}
