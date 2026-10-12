import { useState } from 'react'
import { Card, Grid, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'

const LOCATION_DOC_ID = 1123
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Stock Balance Report — port of frmRptStockBal: as-of-date balance per
 * item (+ location), valued at the last recorded inward rate. Zero real
 * rows in this client's data today (same as every table in the Inventory
 * module — see app/services/inventory.py), built per explicit request
 * against the real schema/logic (confirmed via the legacy exe's decompiled
 * source — this is a real, distinct screen, not an ad-hoc SQL template).
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

  const totalValue = (rows || []).reduce((s, r) => s + (Number(r.value) || 0), 0)

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Stock Balance Report
          </Title>
          <Text size="sm" c="dimmed">
            Item-wise closing balance and value as of a chosen date
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <DateInput label="As of Date" value={asOfDate} onChange={setAsOfDate} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <MasterOptionsSelect docId={LOCATION_DOC_ID} label="Location" value={locId} onChange={setLocId} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Item code contains" value={itemCode} onChange={(e) => setItemCode(e.currentTarget.value)} placeholder="e.g. RICE" />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item Group</Table.Th>
                <Table.Th>Item Code</Table.Th>
                <Table.Th>Item Name</Table.Th>
                <Table.Th>UOM</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Balance</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Rate</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="md">
                      Loading…
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {!isLoading && (rows || []).length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="md">
                      No stock balances to show
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {(rows || []).map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{r.item_group}</Table.Td>
                  <Table.Td>{r.item_code}</Table.Td>
                  <Table.Td>{r.item_name}</Table.Td>
                  <Table.Td>{r.uom_code}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.balance).toLocaleString('en-IN')}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.rate).toFixed(2)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            {rows?.length > 0 && (
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Th colSpan={6} style={{ textAlign: 'right' }}>
                    Total Value
                  </Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>₹ {totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</Table.Th>
                </Table.Tr>
              </Table.Tfoot>
            )}
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  )
}
