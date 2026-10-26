import { historyParams } from '../../lib/history'
import { useState } from 'react'
import { Button, Group, Menu, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { notifications } from '@mantine/notifications'
import { Building, ChevronDown } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hallApi from '../../api/endpoints/hall'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import useDocFields from '../../hooks/useDocFields'
import HallPaymentPanel from './HallPaymentPanel'
import DocNavBar from '../../components/ui/DocNavBar'
import { useNavigate } from 'react-router-dom'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'

const DOC_ID = 1281
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
// Calculated by the server (or owned by the payment flow), so not drawn as inputs.
const COMPUTED_CODES = [
  'TOTAMT', 'CGSTAMT', 'SGSTAMT', 'TOTGSTAMT', 'AMTAFTTAX', 'NETPAY', 'BALAMT', 'NOD',
  'ADV', 'PMT2', 'FULLPAIDAMT', 'AMTINWORDS', 'TOTAMTIWRDS', 'ISSUEDBY',
  // advance / part / final payment details are recorded through Receipt Info, not on the booking itself
  'PAYMNTMODE', 'REFNO', 'PAYMODE2', 'REFNO3', 'PAYMODE', 'REF2', 'PAYMODFH', 'CASHCHEQ', 'RCPDT', 'BANK',
]

/**
 * Hall Booking (DocID 1281): the booking form is drawn entirely from the temple's Doc Designer (UtlDocDsgrFlds) —
 * which fields exist, their order, captions, lists, mandatory / hide rules. Advance and final payments are added
 * afterwards through Receipt Info. See app/services/hall.py.
 */
export default function HallBookingPage() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [paymentFor, setPaymentFor] = useState(null)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')
  const navigate = useNavigate()
  const { data: hbOptions = [] } = useQuery({ queryKey: ['hall-booking-options'], queryFn: hallApi.bookingOptions, staleTime: 5 * 60_000 })

  const { fields, isLoading: fieldsLoading } = useDocFields(DOC_ID)
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const caption = (code, fallback) => fields.find((f) => f.FldCode === code)?.FldCaption || fallback
  const has = (code) => fields.some((f) => f.FldCode === code)

  const { data: bookings, isLoading: recentLoading, refetch } = useQuery({
    queryKey: ['hall-bookings', 'recent'],
    queryFn: () => hallApi.listBookings(historyParams()),
  })

  const gross = Number(values.AMOUNT) || 0
  const cgst = (gross * (Number(values.CGSTPER) || 0)) / 100
  const sgst = (gross * (Number(values.SGSTPER) || 0)) / 100
  const net = gross + cgst + sgst

  const errors = docFieldErrors(fields, values, COMPUTED_CODES)
  const firstError = Object.values(errors)[0] || (!(gross > 0) ? 'Enter the amount' : null)

  async function onSave(mode) {
    setAttempted(true)
    if (firstError) {
      notifications.show({ message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const fieldsPayload = Object.fromEntries(
        Object.entries(values)
          .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !COMPUTED_CODES.includes(k))
          .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
      )
      const result = await hallApi.createBooking({ fields: fieldsPayload, doc_date: isoDate(docDate) })
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.hb_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.hb_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues({})
      setAttempted(false)
      setResetKey((k) => k + 1)
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  // Record navigation: show a saved booking read-only; New goes back to a blank entry. Columns are the Designer FldCodes.
  async function viewRecord(id) {
    try {
      const b = await hallApi.getBooking(id)
      const next = {}
      for (const f of fields) {
        if (COMPUTED_CODES.includes(f.FldCode)) continue
        const v = b[f.FldCode]
        if (v === null || v === undefined) next[f.FldCode] = ''
        else if (f.FldDataType === 'Date') next[f.FldCode] = new Date(v)
        else if (f.FldBlnComboData === 'Y') next[f.FldCode] = Number(v) || ''
        else next[f.FldCode] = String(v).trim()
      }
      setValues(next)
      if (b.HBDate) setDocDate(new Date(b.HBDate))
      setViewId(id)
      setViewNo(b.PrintHBNO || b.HBNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewNo('')
    setValues({})
    setAttempted(false)
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setDocDate(new Date())
  }
  async function findBookings(q) {
    const rows = await hallApi.listBookings({ search: q, top: 30, days: 0 })
    return rows.map((r) => ({ id: r.HBID, label: r.PrintHBNO || r.HBNO, sub: `${r.NMEOFFUNC || ''} ${r.CONTACTNO || ''}`.trim() }))
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  useDocShortcuts({
    onSave: () => !viewId && onSave('save'),
    onPrint: () => lastSaved && setPrintFor(lastSaved.hb_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : onSave('print')),
  })

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
        <DateInput aria-label="Document date" valueFormat="DD-MMM-YYYY" value={docDate} onChange={(v) => v && setDocDate(v)} disabled={Boolean(viewId)} w={150} />
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <Stack gap="lg">
            {!fieldsLoading && fields.length === 0 ? (
              <SectionCard title="Hall Booking">
                <Text size="sm" c="dimmed">
                  Hall Booking has no fields configured in this temple's Doc Designer, so there is nothing to enter here.
                </Text>
              </SectionCard>
            ) : (
              <SectionCard title="Booking" hint="Drawn from this temple's Doc Designer.">
                <DocFieldsForm
                  docId={DOC_ID}
                  section="Header"
                  values={values}
                  setValue={setValue}
                  setValues={setValues}
                  resetKey={resetKey}
                  errors={attempted ? errors : {}}
                  skip={COMPUTED_CODES}
                  readOnly={Boolean(viewId)}
                />
              </SectionCard>
            )}
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: caption('AMOUNT', 'Hall charges'), value: formatINR(gross) },
                ...(has('CGSTPER') ? [{ label: `${caption('CGSTPER', 'CGST')} ${Number(values.CGSTPER) || 0}%`, value: formatINR(cgst) }] : []),
                ...(has('SGSTPER') ? [{ label: `${caption('SGSTPER', 'SGST')} ${Number(values.SGSTPER) || 0}%`, value: formatINR(sgst) }] : []),
                ...(has('SDEPAMT') ? [{ label: caption('SDEPAMT', 'Security deposit'), value: formatINR(Number(values.SDEPAMT) || 0) }] : []),
              ]}
              totalLabel={caption('NETPAY', 'Net payable')}
              total={formatINR(net)}
              words={net}
              warning={firstError || null}
              saving={saving}
              saveDisabled={Boolean(viewId)}
              onSave={() => onSave('save')}
              onSavePrint={() => onSave('print')}
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
                subtitle: `${b.NMEOFFUNC || ''} · Bal ${formatINR(b.BALAMT)}`,
                printLabel: `Print ${b.PrintHBNO}`,
                onPrint: () => setPrintFor(b.HBID),
                extra: (
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <Button size="compact-sm" variant="light" color="gold" c="var(--vt-badge-ink)" rightSection={<ChevronDown size={14} />} aria-label={`Options for ${b.PrintHBNO}`}>
                        Options
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {hbOptions.map((o) => (
                        <Menu.Item
                          key={o.name}
                          onClick={() => {
                            if (o.kind === 'receipt-info') return setPaymentFor(b.HBID)
                            // Donation for <prefix>: open a new Donation Receipt carrying this booking's contact details
                            navigate('/donations', {
                              state: { prefill: { prefix: o.prefix, hb_id: b.HBID, donor: b.CONPRS || '', contact_no: b.CONTACTNO || '', address: b.ADDRESS || '', pan_no: b.PAN || '', reference_no: o.prefix === 'SLV' ? '' : b.REFNO || '' } },
                            })
                          }}
                        >
                          {o.label}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                ),
              })}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} search={findBookings} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Hall Booking Receipt" />
      <HallPaymentPanel hbId={paymentFor} onClose={() => setPaymentFor(null)} />
    </Stack>
  )
}
