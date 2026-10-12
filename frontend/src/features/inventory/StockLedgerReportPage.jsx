import { useState } from 'react'
import { Card, Grid, Group, Stack, Table, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'

const ITEM_DOC_ID = 1114
const LOCATION_DOC_ID = 1123
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Stock Ledger Report — port of frmRptStockLed: a transaction-by-
 * transaction movement history for one item, with a running balance.
 * Zero real rows in this client's data today (see
 * app/services/inventory.py) but schema/logic-verified against the
 * decompiled legacy source (a real, distinct screen).
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

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Stock Ledger Report
          </Title>
          <Text size="sm" c="dimmed">
            Every movement of one item, with a running balance
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
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
          <Grid.Col span={{ base: 6, md: 2 }}>
            <DateInput label="To" value={toDate} onChange={setToDate} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
        </Grid>
      </Card>

      <Card withBorder radius="lg" p={0} style={{ overflow: 'hidden' }}>
        <Table.ScrollContainer minWidth={700}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Document</Table.Th>
                <Table.Th>Particulars</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>In</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Out</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Balance</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {!itemId && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="md">
                      Choose an item to see its stock ledger
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {itemId && isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="md">
                      Loading…
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {itemId && !isLoading && (rows || []).length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="md">
                      No movements in this range
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {(rows || []).map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{dayjs(r.doc_date).format('DD/MM/YYYY')}</Table.Td>
                  <Table.Td>
                    {r.doc_name} · {r.doc_no}
                  </Table.Td>
                  <Table.Td>{r.particulars}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.in_qty) || ''}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.out_qty) || ''}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{Number(r.running_balance).toLocaleString('en-IN')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  )
}
