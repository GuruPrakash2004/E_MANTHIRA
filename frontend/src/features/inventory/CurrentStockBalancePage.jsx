import { useState } from 'react'
import { Card, Grid, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'

const LOCATION_DOC_ID = 1123
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Current Stock Balance — port of frmRptCurStockBal, reading TrnQOH (the
 * legacy running closing-balance table). Zero real rows in this client's
 * data today (same as every table in the Inventory module — see
 * app/services/inventory.py), built per explicit request against the
 * real schema so it's ready the moment stock transactions start flowing.
 */
export default function CurrentStockBalancePage() {
  const [locId, setLocId] = useState('')
  const [itemCode, setItemCode] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['stock-balance', locId, itemCode],
    queryFn: () => inventoryApi.getStockBalance({ loc_id: locId || undefined, item_code: itemCode || undefined }),
  })

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Current Stock Balance
          </Title>
          <Text size="sm" c="dimmed">
            Live closing balance per item &amp; location
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <MasterOptionsSelect docId={LOCATION_DOC_ID} label="Location" value={locId} onChange={setLocId} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Item code contains" value={itemCode} onChange={(e) => setItemCode(e.currentTarget.value)} placeholder="e.g. RICE" />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
        <Table.ScrollContainer minWidth={600}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item Code</Table.Th>
                <Table.Th>Item Name</Table.Th>
                <Table.Th>UOM</Table.Th>
                <Table.Th>Location</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Balance</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="md">
                      Loading…
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {!isLoading && (rows || []).length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="md">
                      No stock balances to show
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {(rows || []).map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{r.item_code}</Table.Td>
                  <Table.Td>{r.item_name}</Table.Td>
                  <Table.Td>{r.uom_code}</Table.Td>
                  <Table.Td>{r.loc_name}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.balance).toLocaleString('en-IN')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  )
}
