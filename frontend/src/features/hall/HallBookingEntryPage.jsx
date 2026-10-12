import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Divider, Grid, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hbeApi from '../../api/endpoints/hallBookingEntry'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'

const DOC_ID = 1280
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

const TYPE_OPTIONS = ['HALL BOOKING', 'CARPUS FUND', 'KESHAVA SADANA', 'ANNAPOORNA DHYANA MANDIRA']
const PAYMENT_MODES = ['Cash', 'Card', 'Cheque', 'UPI']

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — same pattern as every other transaction screen (CLAUDE.md rule 5).
const FIELD_CODE_MAP = {
  TYPE: 'type', NMEOFFUNC: 'name_of_func', CONPRS: 'contact_person', CONTACTNO: 'contact_no',
  SECCONTNO: 'mobile_no', ADDRESS: 'address', PAYMNTMODE: 'payment_mode', REFNO: 'reference_no',
  EMAILID: 'email_id', PAN: 'pan', RMKS: 'remarks', ISSUEDBY: 'issued_by',
}

const EMPTY_LINE = { name_of_hall: '', amount: 0, rate: 0, hrs: 0 }

/**
 * Hall Booking Entry (DocID 1280, table TrnHdrHBE) — a simpler, non-ledger
 * receipt screen, confirmed distinct from the already-built Hall Booking
 * (DocID 1281/TrnHdrHB, which posts to the GL). Zero real rows in this
 * client's data today — built anyway per explicit request, faithfully
 * against the real schema. See app/services/hall_booking_entry.py.
 */
export default function HallBookingEntryPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    type: 'HALL BOOKING',
    hb_start_dt: new Date(),
    hb_end_dt: new Date(),
    start_time: '',
    end_time: '',
    name_of_func: '',
    contact_person: '',
    contact_no: '',
    mobile_no: '',
    address: '',
    payment_mode: 'Cash',
    reference_no: '',
    email_id: '',
    pan: '',
    cgst: 0,
    sgst: 0,
    security_deposit_amt: 0,
    advance_amt: 0,
    bank: '',
    cash_cheque_no: '',
    remarks: '',
    issued_by: '',
  })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, refetch } = useQuery({ queryKey: ['hbe', 'recent'], queryFn: () => hbeApi.listHbe({ top: 15 }) })
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }
  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { ...EMPTY_LINE }])
  }
  function removeLine(i) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))
  }

  const totalAmt = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const totGst = (Number(form.cgst) || 0) + (Number(form.sgst) || 0)
  const netPay = totalAmt + totGst - (Number(form.security_deposit_amt) || 0) - (Number(form.advance_amt) || 0)

  async function onSave() {
    if (!form.contact_no) {
      notifications.show({ message: `${caption('CONTACTNO', 'Contact Number')} is mandatory`, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        ...form,
        hb_start_dt: form.hb_start_dt.toISOString().slice(0, 10),
        hb_end_dt: form.hb_end_dt.toISOString().slice(0, 10),
        cgst: Number(form.cgst) || 0,
        sgst: Number(form.sgst) || 0,
        security_deposit_amt: Number(form.security_deposit_amt) || 0,
        advance_amt: Number(form.advance_amt) || 0,
        lines: lines.map((l) => ({ name_of_hall: l.name_of_hall, amount: Number(l.amount), rate: Number(l.rate) || 0, hrs: Number(l.hrs) || 0 })),
      }
      const result = await hbeApi.createHbe(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines([{ ...EMPTY_LINE }])
      queryClient.invalidateQueries({ queryKey: ['hbe'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Hall Booking Entry
            </Title>
            <Text size="sm" c="dimmed">
              Quick receipt for Hall Booking, Corpus Fund and other venue bookings
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.hbe_no}
          </Badge>
        )}
      </Group>

      <Grid>
        <Grid.Col span={8}>
          <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
            <div
              aria-hidden
              style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
            />
            <Grid style={{ position: 'relative' }}>
              <Grid.Col span={4}>
                <Select label={caption('TYPE', 'Type')} required={mandatory('TYPE')} data={fieldListOptions(fieldMeta.TYPE, TYPE_OPTIONS)} value={form.type} onChange={(v) => set('type', v)} />
              </Grid.Col>
              {!hidden('NMEOFFUNC') && (
                <Grid.Col span={8}>
                  <TextInput label={caption('NMEOFFUNC', 'Name of Function')} required={mandatory('NMEOFFUNC')} value={form.name_of_func} onChange={(e) => set('name_of_func', e.currentTarget.value)} />
                </Grid.Col>
              )}
              <Grid.Col span={3}>
                <DateInput label={caption('HBSTARTDT', 'Start Date')} required={mandatory('HBSTARTDT')} value={form.hb_start_dt} onChange={(v) => set('hb_start_dt', v)} />
              </Grid.Col>
              <Grid.Col span={3}>
                <TextInput label={caption('STTIME', 'Start Time')} value={form.start_time} onChange={(e) => set('start_time', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={3}>
                <DateInput label={caption('HBENDDT', 'End Date')} required={mandatory('HBENDDT')} value={form.hb_end_dt} onChange={(v) => set('hb_end_dt', v)} />
              </Grid.Col>
              <Grid.Col span={3}>
                <TextInput label={caption('ENDTIME', 'End Time')} value={form.end_time} onChange={(e) => set('end_time', e.currentTarget.value)} />
              </Grid.Col>

              <Grid.Col span={4}>
                <TextInput label={caption('CONPRS', 'Contact Person')} value={form.contact_person} onChange={(e) => set('contact_person', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('CONTACTNO', 'Contact Number')} required={mandatory('CONTACTNO')} value={form.contact_no} onChange={(e) => set('contact_no', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('SECCONTNO', 'Mobile No')} value={form.mobile_no} onChange={(e) => set('mobile_no', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={12}>
                <TextInput label={caption('ADDRESS', 'Address')} value={form.address} onChange={(e) => set('address', e.currentTarget.value)} />
              </Grid.Col>

              <Grid.Col span={4}>
                <Select
                  label={caption('PAYMNTMODE', 'Payment Mode')}
                  required={mandatory('PAYMNTMODE')}
                  data={fieldListOptions(fieldMeta.PAYMNTMODE, PAYMENT_MODES)}
                  value={form.payment_mode}
                  onChange={(v) => set('payment_mode', v)}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('REFNO', 'Reference Number')} required={mandatory('REFNO')} value={form.reference_no} onChange={(e) => set('reference_no', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('EMAILID', 'Email ID')} value={form.email_id} onChange={(e) => set('email_id', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('PAN', 'PAN No')} value={form.pan} onChange={(e) => set('pan', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('BANK', 'Bank Branch')} value={form.bank} onChange={(e) => set('bank', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('CASHCHEQ', 'Cash / Cheque No')} value={form.cash_cheque_no} onChange={(e) => set('cash_cheque_no', e.currentTarget.value)} />
              </Grid.Col>
            </Grid>

            <Group justify="space-between" mt="md">
              <Text size="sm" fw={600}>
                Hall / Item Lines
              </Text>
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                Add Line
              </Button>
            </Group>
            <Table mt="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{caption('NAMEOFHALL', 'Name of the Hall / Room')}</Table.Th>
                  <Table.Th w={100}>Rate</Table.Th>
                  <Table.Th w={100}>Hrs</Table.Th>
                  <Table.Th w={120}>{caption('AMOUNT', 'Amount')}</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <TextInput value={l.name_of_hall} onChange={(e) => updateLine(i, { name_of_hall: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.rate} onChange={(v) => updateLine(i, { rate: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.hrs} onChange={(v) => updateLine(i, { hrs: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.amount} onChange={(v) => updateLine(i, { amount: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" disabled={lines.length <= 1} onClick={() => removeLine(i)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Grid mt="md">
              <Grid.Col span={3}>
                <NumberInput label="CGST" value={form.cgst} onChange={(v) => set('cgst', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput label="SGST" value={form.sgst} onChange={(v) => set('sgst', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput label={caption('SDEPAMT', 'Security Deposit Amount')} value={form.security_deposit_amt} onChange={(v) => set('security_deposit_amt', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput label={caption('ADV', 'Advance Amount')} value={form.advance_amt} onChange={(v) => set('advance_amt', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={12}>
                <TextInput label={caption('RMKS', 'Remarks')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
              </Grid.Col>
            </Grid>

            <Group justify="flex-end" mt="lg">
              <Button size="md" color="kumkum" loading={saving} onClick={onSave}>
                Save
              </Button>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={4}>
          <Card withBorder radius="lg" p="md" shadow="sm" mb="md">
            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                Total Amount
              </Text>
              <Text fw={600}>₹ {totalAmt.toFixed(2)}</Text>
            </Group>
            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                {caption('TOTGSTAMT', 'Total GST Amount')}
              </Text>
              <Text fw={600}>₹ {totGst.toFixed(2)}</Text>
            </Group>
            <Divider my={6} />
            <Group justify="space-between">
              <Text fw={700}>{caption('NETPAY', 'Net Pay')}</Text>
              <Text fw={700} c="kumkum">
                ₹ {netPay.toFixed(2)}
              </Text>
            </Group>
          </Card>
          <Card withBorder radius="lg" p="md" shadow="sm">
            <Title order={5} mb="sm" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Recent Entries
            </Title>
            <Stack gap={0}>
              {(recent || []).map((r, i) => (
                <div key={r.HBEID}>
                  {i > 0 && <Divider my={8} />}
                  <Text size="sm" fw={600}>
                    {r.PrintHBENO} · {r.TYPE}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.NMEOFFUNC} · ₹{r.NETPAY}
                  </Text>
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
