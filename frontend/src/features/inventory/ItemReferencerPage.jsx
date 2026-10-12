import { useState } from 'react'
import { Card, Grid, Stack } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'
import { ReportTable } from './ReportParts'
import { PageHeader } from '../../components/ui/EntryParts'

const ITEM_DOC_ID = 1114

/**
 * Item Referencer ("Where Used Report"), port of frmRptWhereUsed. Pick a raw-material/component item and see
 * every Bill of Material it is used in.
 */
export default function ItemReferencerPage() {
  const [itemId, setItemId] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['where-used', itemId],
    queryFn: () => inventoryApi.getWhereUsed(itemId),
    enabled: Boolean(itemId),
  })

  const columns = [
    { key: 'bom_no', label: 'BOM No', render: (r) => <b>{r.bom_no}</b> },
    { key: 'bom_date', label: 'Date', render: (r) => dayjs(r.bom_date).format('DD/MM/YYYY') },
    { key: 'finished', label: 'Finished Item', render: (r) => `${r.finished_item_code} · ${r.finished_item_name}` },
    { key: 'qty_per_unit', label: 'Qty per Unit', num: true },
    { key: 'uom_code', label: 'UOM' },
  ]

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Item Referencer" subtitle="Where an item is used: every Bill of Material that consumes it" shortcuts={[]} />

      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <MasterOptionsSelect docId={ITEM_DOC_ID} label="Item" required value={itemId} onChange={setItemId} />
          </Grid.Col>
        </Grid>
      </Card>

      <ReportTable
        columns={columns}
        rows={rows || []}
        loading={Boolean(itemId) && isLoading}
        idle={!itemId}
        idleTitle="Choose an item"
        idleHint="Pick an item above to see which Bills of Material use it."
        emptyTitle="Not used in any Bill of Material"
        emptyHint="This item is not a component of any finished item yet."
        minWidth={640}
      />
    </Stack>
  )
}
