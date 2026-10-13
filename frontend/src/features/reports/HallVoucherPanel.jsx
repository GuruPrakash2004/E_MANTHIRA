import { useState } from 'react'
import { Button, Card, Checkbox, Group, MultiSelect, Stack, Table, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { notifications } from '@mantine/notifications'
import * as reportsApi from '../../api/endpoints/reports'
import EmptyState from '../../components/ui/EmptyState'
import { formatINR, isoDate } from '../../utils/format'
import { downloadXls } from '../../utils/xls'

const d = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '')
const m = (v) => (v == null ? '' : formatINR(v))

const COLUMNS = [
  { key: 'HBENDDT', label: 'HB End Date', value: (r) => d(r.HBENDDT) },
  { key: 'HBSTARTDT', label: 'HB Start Date', value: (r) => d(r.HBSTARTDT) },
  { key: 'PrintHBNO', label: 'Print HBNO' },
  { key: 'HBDate', label: 'HB Date', value: (r) => d(r.HBDate) },
  { key: 'NMEOFFUNC', label: 'Name of Function' },
  { key: 'CONPRS', label: 'Contact Person' },
  { key: 'CONTACTNO', label: 'Contact No' },
  { key: 'MOBNO', label: 'Mobile No' },
  { key: 'AMOUNT', label: 'Amount', num: true, value: (r) => m(r.AMOUNT) },
  { key: 'BALAMT', label: 'Balance Amount', num: true, value: (r) => m(r.BALAMT) },
  { key: 'Cancelled', label: 'Cancelled' },
  { key: 'RCPTVCHNO', label: 'Receipt Voucher No' },
  { key: 'RCPTVCHDate', label: 'Receipt Voucher Date', value: (r) => d(r.RCPTVCHDate) },
  { key: 'RCPTTYPE', label: 'Receipt Type' },
  { key: 'TOTCR', label: 'Receipt Amount', num: true, value: (r) => m(r.TOTCR) },
  { key: 'VCHTYP', label: 'Voucher Type' },
  { key: 'PREFIX', label: 'Prefix' },
  { key: 'PRINTDONRECNO', label: 'Donation Receipt No' },
  { key: 'DONAMT', label: 'Donation Amount', num: true, value: (r) => m(r.DONAMT) },
]

/** Hall Booking With Voucher Detail Report — port of legacy frmRptVIRNew (period, "Select Invoice" subset, View, Excel, Close). */
export default function HallVoucherPanel() {
  const navigate = useNavigate()
  const [from, setFrom] = useState(dayjs().startOf('month').toDate())
  const [to, setTo] = useState(new Date())
  const [pickOn, setPickOn] = useState(false)
  const [picked, setPicked] = useState([])
  const range = { from_date: isoDate(from), to_date: isoDate(to) }

  const { data: bookings = [] } = useQuery({ queryKey: ['hv-bookings', range.from_date, range.to_date], queryFn: () => reportsApi.hallVoucherBookings(range), enabled: pickOn && Boolean(from && to) })
  const run = useMutation({
    mutationFn: () => reportsApi.runHallBookingVoucher({ ...range, hb_ids: pickOn && picked.length ? picked.map(Number) : undefined }),
    onError: (e) => notifications.show({ message: e?.response?.data?.detail || 'Could not run the report', color: 'red' }),
  })
  const result = run.data

  return (
    <Stack gap="md">
      <Card withBorder p="md">
        <Group align="flex-end" gap="md" wrap="wrap">
          <DatePickerInput className="vt-field-required" label="For the Period from" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={170} />
          <DatePickerInput className="vt-field-required" label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={170} />
          <Checkbox color="kumkum" label="Select Invoice" checked={pickOn} onChange={(e) => { setPickOn(e.currentTarget.checked); setPicked([]) }} mb={8} />
          {pickOn && (
            <MultiSelect
              aria-label="Hall bookings"
              placeholder="Select hall booking no(s)"
              data={bookings.map((b) => ({ value: String(b.id), label: `${b.no} · ${b.func || ''}` }))}
              value={picked}
              onChange={setPicked}
              searchable
              clearable
              w={320}
            />
          )}
          <Button color="kumkum" leftSection={<Eye size={16} />} loading={run.isPending} disabled={!from || !to} onClick={() => run.mutate()}>
            View
          </Button>
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!result?.rows?.length} onClick={() => downloadXls('Hall Booking With Voucher Detail.xls', result.rows, COLUMNS)}>
            Export to Excel
          </Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        </Group>
      </Card>

      {result && (
        <Card withBorder p={0} style={{ overflow: 'hidden' }}>
          {result.rows.length === 0 ? (
            <EmptyState title="No hall bookings with receipts in this period" hint="Change the dates or the invoice selection." />
          ) : (
            <Table.ScrollContainer minWidth={1500} mah={620} type="native">
              <Table striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    {COLUMNS.map((c) => (
                      <Table.Th key={c.key} ta={c.num ? 'right' : undefined}>{c.label}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.rows.map((r, i) => (
                    <Table.Tr key={i} style={r.Cancelled === 'Y' ? { color: 'var(--vt-required-ink)' } : undefined}>
                      {COLUMNS.map((c) => (
                        <Table.Td key={c.key} ta={c.num ? 'right' : undefined} className={c.num ? 'vt-num' : undefined}>
                          {c.value ? c.value(r) : r[c.key] ?? ''}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr>
                    <Table.Td colSpan={8}><b>Grand Total ({result.total_count} bookings)</b></Table.Td>
                    <Table.Td ta="right" className="vt-num"><b>{m(result.total_amount)}</b></Table.Td>
                    <Table.Td colSpan={5} />
                    <Table.Td ta="right" className="vt-num"><b>{m(result.total_received)}</b></Table.Td>
                    <Table.Td colSpan={3} />
                    <Table.Td ta="right" className="vt-num"><b>{m(result.total_donation)}</b></Table.Td>
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
      <Text size="xs" c="dimmed">Rows in red are cancelled bookings. Amount is the total received plus the balance still due.</Text>
    </Stack>
  )
}
