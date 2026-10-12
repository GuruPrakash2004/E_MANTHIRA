import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Divider, Grid, Group, Kbd, NumberInput, Select, Stack, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { Building, Printer } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hallApi from '../../api/endpoints/hall'
import LookupSelect from '../../components/LookupSelect'
import PrintPickerModal from '../../components/PrintPickerModal'
import DynamicField from '../../components/DynamicField'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'
import HallPaymentPanel from './HallPaymentPanel'
import { Receipt } from 'lucide-react'
import useDocShortcuts from '../../hooks/useDocShortcuts'

const DOC_ID = 1281
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

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

  const { data: bookings, refetch } = useQuery({
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
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Hall Booking
            </Title>
            <Text size="sm" c="dimmed">
              Book the community hall and record advance/final payments
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.hb_no} · Net ₹{lastSaved.net_pay}
          </Badge>
        )}
      </Group>

      <Grid>
        <Grid.Col span={8}>
          <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `url(${KOLAM_PATTERN})`,
                backgroundSize: '140px 140px',
                opacity: 0.03,
                pointerEvents: 'none',
              }}
            />
            <Grid style={{ position: 'relative' }}>
              <Grid.Col span={6}>
                <Select
                  label={caption('TYPE', 'Type')}
                  required={mandatory('TYPE')}
                  data={['HALL BOOKING', 'CARPUS FUND']}
                  value={form.booking_type}
                  onChange={(v) => set('booking_type', v)}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="HALLID" label={caption('HALLID', 'Name of the Hall / Room')} required={mandatory('HALLID')} value={form.hall_id} onChange={(v) => set('hall_id', v)} />
              </Grid.Col>
              {!hidden('NMEOFFUNC') && (
                <Grid.Col span={12}>
                  <TextInput label={caption('NMEOFFUNC', 'Name of Function')} required={mandatory('NMEOFFUNC')} value={form.function_name} onChange={(e) => set('function_name', e.currentTarget.value)} />
                </Grid.Col>
              )}
              {!hidden('HBSTARTDT') && (
                <Grid.Col span={6}>
                  <DateTimePicker label={caption('HBSTARTDT', 'Start Date & Time')} required={mandatory('HBSTARTDT')} value={startAt} onChange={setStartAt} />
                </Grid.Col>
              )}
              {!hidden('HBENDDT') && (
                <Grid.Col span={6}>
                  <DateTimePicker label={caption('HBENDDT', 'End Date & Time')} required={mandatory('HBENDDT')} value={endAt} onChange={setEndAt} />
                </Grid.Col>
              )}
              <Grid.Col span={6}>
                <TextInput label={caption('CONPRS', 'Contact Person')} required={mandatory('CONPRS')} value={form.contact_person} onChange={(e) => set('contact_person', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label={caption('CONTACTNO', 'Contact Number')} required={mandatory('CONTACTNO')} value={form.contact_no} onChange={(e) => set('contact_no', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label={caption('MOBNO', 'Mobile No')} required={mandatory('MOBNO')} value={form.mobile} onChange={(e) => set('mobile', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label={caption('EMAILID', 'Email ID')} required={mandatory('EMAILID')} value={form.email} onChange={(e) => set('email', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={8}>
                <TextInput label={caption('ADDRESS', 'Address')} required={mandatory('ADDRESS')} value={form.address} onChange={(e) => set('address', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label={caption('PAN', 'PAN NO')} required={mandatory('PAN')} value={form.pan} onChange={(e) => set('pan', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={12}>
                <TextInput label={caption('RMKS', 'Remarks')} required={mandatory('RMKS')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput label={caption('AMOUNT', 'Hall Charges Amount')} required={mandatory('AMOUNT')} value={form.amount} onChange={(v) => set('amount', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput label={caption('CGSTPER', 'CGST %')} required={mandatory('CGSTPER')} value={form.cgst_pct} onChange={(v) => set('cgst_pct', v)} />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput label={caption('SGSTPER', 'SGST %')} required={mandatory('SGSTPER')} value={form.sgst_pct} onChange={(v) => set('sgst_pct', v)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <NumberInput label={caption('SDEPAMT', 'Security Deposit Amount')} required={mandatory('SDEPAMT')} value={form.deposit} onChange={(v) => set('deposit', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="LEDGER" label={caption('LEDGER', 'Income Ledger')} required={mandatory('LEDGER')} value={form.ledger_id} onChange={(v) => set('ledger_id', v)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="LEDID" label={caption('LEDID', 'Cash / Bank Account')} required={mandatory('LEDID')} value={form.cash_bank_ledger_id} onChange={(v) => set('cash_bank_ledger_id', v)} />
              </Grid.Col>
              {extraDesignerFields.map((f) => (
                <Grid.Col span={4} key={f.FldCode}>
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

            <Card
              mt="lg"
              radius="md"
              style={{ position: 'relative', background: 'linear-gradient(120deg, #7A1F1F 0%, #5A1414 100%)' }}
            >
              <Group justify="space-between">
                <Text c="#F4E1A6" fw={600}>
                  Amount ₹{gross.toFixed(2)} + CGST ₹{cgst.toFixed(2)} + SGST ₹{sgst.toFixed(2)}
                </Text>
                <Title order={3} c="white" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                  Net ₹ {net.toFixed(2)}
                </Title>
              </Group>
            </Card>

            <Group justify="flex-end" mt="lg" style={{ position: 'relative' }}>
              <Kbd size="xs">Alt+S</Kbd>
              <Button size="md" color="kumkum" loading={saving} onClick={onSave}>
                Save &amp; Print
              </Button>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={4}>
          <Card withBorder radius="lg" p="md" shadow="sm">
            <Group gap={8} mb="sm">
              <Building size={18} color="#7A1F1F" />
              <Title order={5} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                Recent Bookings
              </Title>
            </Group>
            <Stack gap={0}>
              {(bookings || []).map((b, i) => (
                <div key={b.HBID}>
                  {i > 0 && <Divider my={8} />}
                  <Group justify="space-between" wrap="nowrap">
                    <UnstyledButton onClick={() => setPaymentFor(b.HBID)} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600}>
                        {b.PrintHBNO}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {b.NMEOFFUNC} · Bal ₹{b.BALAMT}
                      </Text>
                    </UnstyledButton>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon variant="light" color="saffron" onClick={() => setPaymentFor(b.HBID)}>
                        <Receipt size={16} />
                      </ActionIcon>
                      <ActionIcon variant="light" color="kumkum" onClick={() => setPrintFor(b.HBID)}>
                        <Printer size={16} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Hall Booking Receipt" />
      <HallPaymentPanel hbId={paymentFor} onClose={() => setPaymentFor(null)} />
    </Stack>
  )
}
