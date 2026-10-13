import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Button, Grid, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { CalendarRange, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hbeApi from '../../api/endpoints/hallBookingEntry'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'

const DOC_ID = 1280
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

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
  const confirm = useConfirm()
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

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['hbe', 'recent'], queryFn: () => hbeApi.listHbe({ top: 15 }) })
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
        hb_start_dt: isoDate(form.hb_start_dt),
        hb_end_dt: isoDate(form.hb_end_dt),
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

  useDocShortcuts({ onSave })

  const dateFmt = 'DD/MM/YYYY'

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Hall Booking Entry</Title>
            <Text size="sm" c="dimmed">
              Quick receipt for hall booking, corpus fund and other venue bookings
            </Text>
          </div>
        </Group>
      </Group>

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Booking" hint="What the booking is for and when.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <Select label={caption('TYPE', 'Type')} required={mandatory('TYPE')} data={fieldListOptions(fieldMeta.TYPE, TYPE_OPTIONS)} value={form.type} onChange={(v) => set('type', v)} />
                </Grid.Col>
                {!hidden('NMEOFFUNC') && (
                  <Grid.Col span={{ base: 12, sm: 8 }}>
                    <TextInput label={caption('NMEOFFUNC', 'Name of Function')} required={mandatory('NMEOFFUNC')} value={form.name_of_func} onChange={(e) => set('name_of_func', e.currentTarget.value)} />
                  </Grid.Col>
                )}
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <DateInput label={caption('HBSTARTDT', 'Start Date')} required={mandatory('HBSTARTDT')} valueFormat={dateFmt} value={form.hb_start_dt} onChange={(v) => set('hb_start_dt', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <TextInput label={caption('STTIME', 'Start Time')} value={form.start_time} onChange={(e) => set('start_time', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <DateInput label={caption('HBENDDT', 'End Date')} required={mandatory('HBENDDT')} valueFormat={dateFmt} value={form.hb_end_dt} onChange={(v) => set('hb_end_dt', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <TextInput label={caption('ENDTIME', 'End Time')} value={form.end_time} onChange={(e) => set('end_time', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>

            <SectionCard title="Contact" hint="Who is booking.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <TextInput label={caption('CONPRS', 'Contact Person')} value={form.contact_person} onChange={(e) => set('contact_person', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <TextInput label={caption('CONTACTNO', 'Contact Number')} required={mandatory('CONTACTNO')} value={form.contact_no} onChange={(e) => set('contact_no', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 4 }}>
                  <TextInput label={caption('SECCONTNO', 'Mobile No')} value={form.mobile_no} onChange={(e) => set('mobile_no', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput label={caption('ADDRESS', 'Address')} value={form.address} onChange={(e) => set('address', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>

            <SectionCard title="Payment details" hint="How it is paid, plus billing details.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <Select
                    label={caption('PAYMNTMODE', 'Payment Mode')}
                    required={mandatory('PAYMNTMODE')}
                    data={fieldListOptions(fieldMeta.PAYMNTMODE, PAYMENT_MODES)}
                    value={form.payment_mode}
                    onChange={(v) => set('payment_mode', v)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('REFNO', 'Reference Number')} required={mandatory('REFNO')} value={form.reference_no} onChange={(e) => set('reference_no', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('EMAILID', 'Email ID')} value={form.email_id} onChange={(e) => set('email_id', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('PAN', 'PAN No')} value={form.pan} onChange={(e) => set('pan', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('BANK', 'Bank Branch')} value={form.bank} onChange={(e) => set('bank', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('CASHCHEQ', 'Cash / Cheque No')} value={form.cash_cheque_no} onChange={(e) => set('cash_cheque_no', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>

            <SectionCard
              title="Halls and items"
              hint="One line per hall or item; the line amounts make up the total."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                  Add line
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{caption('NAMEOFHALL', 'Name of the Hall / Room')}</Table.Th>
                      <Table.Th w={110}>Rate</Table.Th>
                      <Table.Th w={100}>Hrs</Table.Th>
                      <Table.Th w={140}>{caption('AMOUNT', 'Amount')}</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <TextInput aria-label={`Hall or item, line ${i + 1}`} value={l.name_of_hall} onChange={(e) => updateLine(i, { name_of_hall: e.currentTarget.value })} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Rate, line ${i + 1}`} value={l.rate} onChange={(v) => updateLine(i, { rate: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Hours, line ${i + 1}`} value={l.hrs} onChange={(v) => updateLine(i, { hrs: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Amount, line ${i + 1}`} value={l.amount} onChange={(v) => updateLine(i, { amount: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove line ${i + 1}`}
                            disabled={lines.length <= 1}
                            onClick={async () => {
                              if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) removeLine(i)
                            }}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </SectionCard>

            <SectionCard title="Taxes and adjustments" hint="GST is entered as an amount here. Deposit and advance are deducted from the net.">
              <Grid>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <NumberInput label="CGST" value={form.cgst} onChange={(v) => set('cgst', v)} decimalScale={2} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <NumberInput label="SGST" value={form.sgst} onChange={(v) => set('sgst', v)} decimalScale={2} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <NumberInput label={caption('SDEPAMT', 'Security Deposit Amount')} value={form.security_deposit_amt} onChange={(v) => set('security_deposit_amt', v)} decimalScale={2} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 3 }}>
                  <NumberInput label={caption('ADV', 'Advance Amount')} value={form.advance_amt} onChange={(v) => set('advance_amt', v)} decimalScale={2} />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput label={caption('RMKS', 'Remarks')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: caption('TOTAMT', 'Total amount'), value: formatINR(totalAmt) },
                { label: caption('TOTGSTAMT', 'Total GST amount'), value: formatINR(totGst) },
                { label: 'Security deposit', value: `- ${formatINR(Number(form.security_deposit_amt) || 0)}` },
                { label: 'Advance', value: `- ${formatINR(Number(form.advance_amt) || 0)}` },
              ]}
              totalLabel={caption('NETPAY', 'Net pay')}
              total={formatINR(netPay)}
              words={netPay}
              saveLabel="Save"
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`Entry ${lastSaved.hbe_no}`]} />}
            <RecentCard
              title="Recent entries"
              icon={CalendarRange}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No entries yet"
              emptyHint="Saved entries will be listed here."
              renderRow={(r) => ({
                key: r.HBEID,
                title: `${r.PrintHBENO} \u00b7 ${r.TYPE}`,
                subtitle: `${r.NMEOFFUNC} \u00b7 ${formatINR(r.NETPAY)}`,
              })}
            />
          </>
        }
      />
    </Stack>
  )
}
