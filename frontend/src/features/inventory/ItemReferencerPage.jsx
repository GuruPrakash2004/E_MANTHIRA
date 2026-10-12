import { useState } from 'react'
import { Card, Grid, Group, Stack, Table, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'

const ITEM_DOC_ID = 1114
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Item Referencer ("Where Used Report") — port of frmRptWhereUsed. Pick a
 * raw-material/component item and see every Bill of Material it's used
 * in. Zero real BOM rows in this client's data today (see
 * app/services/inventory.py) but the join is schema-verified.
 */
export default function ItemReferencerPage() {
  const [itemId, setItemId] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['where-used', itemId],
    queryFn: () => inventoryApi.getWhereUsed(itemId),
    enabled: Boolean(itemId),
  })

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Item Referencer
          </Title>
          <Text size="sm" c="dimmed">
            Where an item is used — every Bill of Material that consumes it
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <MasterOptionsSelect docId={ITEM_DOC_ID} label="Item" required value={itemId} onChange={setItemId} />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>BOM No</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Finished Item</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Qty per Unit</Table.Th>
                <Table.Th>UOM</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {!itemId && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="md">
                      Choose an item to see where it's used
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {itemId && isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="md">
                      Loading…
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {itemId && !isLoading && (rows || []).length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="md">
                      Not used in any Bill of Material
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {(rows || []).map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{r.bom_no}</Table.Td>
                  <Table.Td>{dayjs(r.bom_date).format('DD/MM/YYYY')}</Table.Td>
                  <Table.Td>
                    {r.finished_item_code} — {r.finished_item_name}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{r.qty_per_unit}</Table.Td>
                  <Table.Td>{r.uom_code}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  )
}
