import { useState } from 'react'
import { ActionIcon, Grid, Group, Kbd, NumberInput, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { Building, Receipt } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hallApi from '../../api/endpoints/hall'
import LookupSelect from '../../components/LookupSelect'
import PrintPickerModal from '../../components/PrintPickerModal'
import DynamicField from '../../components/DynamicField'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'
import HallPaymentPanel from './HallPaymentPanel'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR } from '../../utils/format'

const DOC_ID = 1281
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — same pattern as SevaEntryPage/DonationReceiptPage (CLAUDE.md rule 5).
const FIELD_CODE_MAP = {
  TYPE: 'booking_type', HALLID: 'hall_id', NMEOFFUNC: 'function_name',
  CONPRS: 'contact_person', CONTACTNO: 'contact_no', MOBNO: 'mobile',
  ADDRESS: 'address', EMAILID: 'email', PAN: 'pan', RMKS: 'remarks',
  AMOUNT: 'amount', CGSTPER: 'cgst_pct', SGSTPER: 'sgst_pct',
  SDEPAMT: 'deposit', LEDGER: 'ledger_id', LEDID: 'cash_bank_ledger_id',
}

export default function HallBookingPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    booking_type: 'HALL BOOKING',
    hall_id: '',
    function_name: '',
    contact_person: '',
    contact_no: '',
    mobile: '',
    address: '',
    email: '',
    pan: '',
    remarks: '',
    amount: 0,
    cgst_pct: 9,
    sgst_pct: 9,
    deposit: 0,
    ledger_id: '',
    cash_bank_ledger_id: '',
  })
  const [extra, setExtra] = useState({})
  const [startAt, setStartAt] = useState(null)
  const [endAt, setEndAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [paymentFor, setPaymentFor] = useState(null)

  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const knownCodes = new Set(Object.keys(FIELD_CODE_MAP))
  const extraDesignerFields = Object.values(fieldMeta).filter(
    (f) => !knownCodes.has(f.FldCode) && !hidden(f.FldCode) && f.FldSection === 'Header'
  )

  const { data: bookings, isLoading: recentLoading, refetch } = useQuery({
    queryKey: ['hall-bookings', 'recent'],
    queryFn: () => hallApi.listBookings({ top: 15 }),
  })

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const gross = Number(form.amount) || 0
  const cgst = (gross * (Number(form.cgst_pct) || 0)) / 100
  const sgst = (gross * (Number(form.sgst_pct) || 0)) / 100
  const net = gross + cgst + sgst

  function fmtTime(d) {
    return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  }

  async function onSave() {
    if (mandatory('HALLID') && !form.hall_id) {
      notifications.show({ message: `${caption('HALLID', 'Name of the Hall / Room')} is mandatory`, color: 'red' })
      return
    }
    if (mandatory('CONTACTNO') && !form.contact_no) {
      notifications.show({ message: `${caption('CONTACTNO', 'Contact Number')} is mandatory`, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        ...form,
        hall_id: form.hall_id ? Number(form.hall_id) : null,
        amount: Number(form.amount),
        cgst_pct: Number(form.cgst_pct),
        sgst_pct: Number(form.sgst_pct),
        deposit: Number(form.deposit) || 0,
        ledger_id: Number(form.ledger_id),
        cash_bank_ledger_id: Number(form.cash_bank_ledger_id),
        start_at: startAt ? startAt.toISOString() : null,
        end_at: endAt ? endAt.toISOString() : null,
        start_time_text: fmtTime(startAt),
        end_time_text: fmtTime(endAt),
        extra_fields: extra,
      }
      const result = await hallApi.createBooking(body)
      setLastSaved(result)
      setPrintFor(result.hb_id)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setExtra({})
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
      refetch()
    } catch (err) {
      const detail = err?.response?.data?.detail
      notifications.show({ message: detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  useDocShortcuts({ onSave, onPrint: () => lastSaved && setPrintFor(lastSaved.hb_id) })

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Hall Booking</Title>
            <Text size="sm" c="dimmed">
              Book the community hall and record advance and final payments
            </Text>
          </div>
        </Group>
        <Group gap="md" visibleFrom="sm" c="dimmed">
          <Group gap={6}>
            <Kbd size="xs">Alt+S</Kbd>
            <Text size="xs">Save</Text>
          </Group>
          <Group gap={6}>
            <Kbd size="xs">Alt+P</Kbd>
            <Text size="xs">Print last</Text>
          </Group>
        </Group>
      </Group>

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Booking" hint="Which hall, for what function, and when.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Select
                    label={caption('TYPE', 'Type')}
                    required={mandatory('TYPE')}
                    data={['HALL BOOKING', 'CARPUS FUND']}
                    value={form.booking_type}
                    onChange={(v) => set('booking_type', v)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <LookupSelect docId={DOC_ID} field="HALLID" label={caption('HALLID', 'Name of the Hall / Room')} required={mandatory('HALLID')} value={form.hall_id} onChange={(v) => set('hall_id', v)} />
                </Grid.Col>
                {!hidden('NMEOFFUNC') && (
                  <Grid.Col span={12}>
                    <TextInput label={caption('NMEOFFUNC', 'Name of Function')} required={mandatory('NMEOFFUNC')} value={form.function_name} onChange={(e) => set('function_name', e.currentTarget.value)} />
                  </Grid.Col>
                )}
                {!hidden('HBSTARTDT') && (
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <DateTimePicker label={caption('HBSTARTDT', 'Start Date & Time')} required={mandatory('HBSTARTDT')} valueFormat="DD/MM/YYYY hh:mm A" value={startAt} onChange={setStartAt} />
                  </Grid.Col>
                )}
                {!hidden('HBENDDT') && (
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <DateTimePicker label={caption('HBENDDT', 'End Date & Time')} required={mandatory('HBENDDT')} valueFormat="DD/MM/YYYY hh:mm A" value={endAt} onChange={setEndAt} />
                  </Grid.Col>
                )}
              </Grid>
            </SectionCard>

            <SectionCard title="Contact" hint="Who is booking the hall.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput label={caption('CONPRS', 'Contact Person')} required={mandatory('CONPRS')} value={form.contact_person} onChange={(e) => set('contact_person', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput label={caption('CONTACTNO', 'Contact Number')} required={mandatory('CONTACTNO')} value={form.contact_no} onChange={(e) => set('contact_no', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput label={caption('MOBNO', 'Mobile No')} required={mandatory('MOBNO')} value={form.mobile} onChange={(e) => set('mobile', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput label={caption('EMAILID', 'Email ID')} required={mandatory('EMAILID')} value={form.email} onChange={(e) => set('email', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 8 }}>
                  <TextInput label={caption('ADDRESS', 'Address')} required={mandatory('ADDRESS')} value={form.address} onChange={(e) => set('address', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <TextInput label={caption('PAN', 'PAN NO')} required={mandatory('PAN')} value={form.pan} onChange={(e) => set('pan', e.currentTarget.value)} />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput label={caption('RMKS', 'Remarks')} required={mandatory('RMKS')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>

            <SectionCard title="Charges and accounts" hint="Hall charges with GST, the security deposit, and the accounts it posts to.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <NumberInput label={caption('AMOUNT', 'Hall Charges Amount')} required={mandatory('AMOUNT')} value={form.amount} onChange={(v) => set('amount', v)} decimalScale={2} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <NumberInput label={caption('CGSTPER', 'CGST %')} required={mandatory('CGSTPER')} value={form.cgst_pct} onChange={(v) => set('cgst_pct', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, sm: 3 }}>
                  <NumberInput label={caption('SGSTPER', 'SGST %')} required={mandatory('SGSTPER')} value={form.sgst_pct} onChange={(v) => set('sgst_pct', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <NumberInput label={caption('SDEPAMT', 'Security Deposit Amount')} required={mandatory('SDEPAMT')} value={form.deposit} onChange={(v) => set('deposit', v)} decimalScale={2} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <LookupSelect docId={DOC_ID} field="LEDGER" label={caption('LEDGER', 'Income Ledger')} required={mandatory('LEDGER')} value={form.ledger_id} onChange={(v) => set('ledger_id', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <LookupSelect docId={DOC_ID} field="LEDID" label={caption('LEDID', 'Cash / Bank Account')} required={mandatory('LEDID')} value={form.cash_bank_ledger_id} onChange={(v) => set('cash_bank_ledger_id', v)} />
                </Grid.Col>
                {extraDesignerFields.map((f) => (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }} key={f.FldCode}>
                    <DynamicField
                      docId={DOC_ID}
                      field={f}
                      value={extra[f.FldCode]}
                      onChange={(v) => setExtra((e) => ({ ...e, [f.FldCode]: v }))}
                      required={mandatory(f.FldCode)}
                    />
                  </Grid.Col>
                ))}
              </Grid>
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: 'Hall charges', value: formatINR(gross) },
                { label: `CGST ${Number(form.cgst_pct) || 0}%`, value: formatINR(cgst) },
                { label: `SGST ${Number(form.sgst_pct) || 0}%`, value: formatINR(sgst) },
                { label: 'Security deposit', value: formatINR(Number(form.deposit) || 0) },
              ]}
              totalLabel="Net payable"
              total={formatINR(net)}
              words={net}
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && (
              <SavedPanel
                lines={[`Booking ${lastSaved.hb_no}`, `Net ${formatINR(lastSaved.net_pay)}`]}
                printLabel="Print booking receipt"
                onPrint={() => setPrintFor(lastSaved.hb_id)}
              />
            )}
            <RecentCard
              title="Recent bookings"
              icon={Building}
              loading={recentLoading}
              rows={bookings || []}
              emptyTitle="No bookings yet"
              emptyHint="Saved bookings will be listed here. Tap the receipt icon to add a payment."
              renderRow={(b) => ({
                key: b.HBID,
                title: b.PrintHBNO,
                subtitle: `${b.NMEOFFUNC} \u00b7 Bal ${formatINR(b.BALAMT)}`,
                printLabel: `Print ${b.PrintHBNO}`,
                onPrint: () => setPrintFor(b.HBID),
                extra: (
                  <ActionIcon variant="light" color="gold" size={36} aria-label={`Add payment to ${b.PrintHBNO}`} onClick={() => setPaymentFor(b.HBID)}>
                    <Receipt size={16} />
                  </ActionIcon>
                ),
              })}
            />
          </>
        }
      />

      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Hall Booking Receipt" />
      <HallPaymentPanel hbId={paymentFor} onClose={() => setPaymentFor(null)} />
    </Stack>
  )
}
