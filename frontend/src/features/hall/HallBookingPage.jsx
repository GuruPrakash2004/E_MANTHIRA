import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useState } from 'react'
import { Badge, Button, Group, Menu, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { notifications } from '@mantine/notifications'
import { Building, ChevronDown, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hallApi from '../../api/endpoints/hall'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import usePrintFormats from '../../hooks/usePrintFormats'
import { pickFormat } from '../../lib/printing'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import useDocFields from '../../hooks/useDocFields'
import HallPaymentPanel from './HallPaymentPanel'
import HallCalendarBox from './HallCalendarBox'
import DocNavBar from '../../components/ui/DocNavBar'
import { useNavigate } from 'react-router-dom'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import useDocRules from '../../hooks/useDocRules'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { SectionCard, DetailsStrip, LineItemsCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import dayjs from 'dayjs'
import { formatINR, isoDate } from '../../utils/format'
import useBillAlertify from '../alertify/useBillAlertify'
import { useAuth } from '../../hooks/useAuth'

const DOC_ID = 1281
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const SIDE_OPEN_KEY = 'vt-hall-side-open' // per-browser: whether the Recent bookings list is shown under the summary

function readSideOpen() {
  try {
    return localStorage.getItem(SIDE_OPEN_KEY) !== '0'
  } catch {
    return true // storage blocked: show it
  }
}
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
  const [editing, setEditing] = useState(false)
  const [stamp, setStamp] = useState(null) // legacy CANCELLED / AUTHORISED label of the booking being viewed
  const rules = useDocRules(DOC_ID) // UtlTransactions switches: authorisation, document-date lock ...
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [idle, setIdle] = useState(true) // opens empty and locked (also after Cancel) until New is pressed
  const readOnly = (Boolean(viewId) && !editing) || idle
  const [sideOpen, setSideOpen] = useState(readSideOpen)
  function toggleSide() {
    setSideOpen((o) => {
      try {
        localStorage.setItem(SIDE_OPEN_KEY, o ? '0' : '1')
      } catch {
        /* storage blocked: the choice just is not remembered */
      }
      return !o
    })
  }
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
  const { user } = useAuth()
  const startIso = values.HBSTARTDT ? isoDate(values.HBSTARTDT) : ''
  const alertify = useBillAlertify({
    docId: DOC_ID, label: 'Hall Booking', user: user?.user_code, fields, values, savedNo: viewId ? viewNo : '',
    totals: [{ caption: 'Doc Date', value: dayjs(docDate).format('DD/MM/YYYY') }, { caption: 'Gross Amount', value: formatINR(gross) }, { caption: 'Net Amount', value: formatINR(net) }],
    anchors: startIso ? [startIso] : [], timingCaption: /start.*time|time.*from|^time$/i, defaultDir: 'before', valid: !firstError && Boolean(startIso), hint: firstError || (startIso ? '' : 'Choose the booking start date first'),
  })

  async function onSave(mode = 'save') {
    if (readOnly) return
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
      if (editing && viewId) {
        await hallApi.updateBooking(viewId, { fields: fieldsPayload, doc_date: isoDate(docDate) })
        notifications.show({ message: 'Updated successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
        refetch()
        await viewRecord(viewId)
        setEditing(false)
        return
      }
      const result = await hallApi.createBooking({ fields: fieldsPayload, doc_date: isoDate(docDate) })
      setLastSaved(result)
      alertify.afterSave({ 'Doc No': result.print_no || result.hb_no }) // the Alertify reminder asked for before saving; it never blocks the bill
      // Save only saves (the preview opens from Print / the Options menu); F10 = save and print at once
      if (mode === 'print') directPrint(result.hb_id)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
      refetch()
      // the saved booking stays on screen (read-only) so it can be checked before printing; New starts the next one
      await viewRecord(result.hb_id)
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
      const yes = (v) => String(v || 'N').trim().toUpperCase() === 'Y'
      setStamp(yes(b.Cancelled) ? { text: 'CANCELLED', color: 'red' } : rules.auth_req ? (yes(b.Authorised) ? { text: 'AUTHORISED', color: 'green' } : { text: 'NOT AUTHORISED', color: 'orange' }) : null)
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(b.PrintHBNO || b.HBNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  // Edit / Cancel / Delete (legacy toolbar). The server applies the legacy rules and says why when it refuses.
  async function startEdit() {
    await viewRecord(viewId) // show what is saved right now, not what was loaded a while ago
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function cancelDocument() {
    if (stamp?.text === 'CANCELLED') return notifications.show({ message: 'Document Is already cancelled', color: 'red' })
    if (!(await confirm({ title: 'Cancel this document?', message: `Booking ${viewNo} will be cancelled and its receipts voided.`, confirmLabel: 'Cancel document' }))) return
    try {
      const r = await hallApi.cancelBooking(viewId, 'Cancelled')
      notifications.show({ message: r.message, color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
      refetch()
      await viewRecord(viewId)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not cancel the booking', color: 'red' })
    }
  }
  async function deleteDocument() {
    if (!(await confirm({ title: 'Delete this document?', message: `Booking ${viewNo} will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await hallApi.deleteBooking(viewId)
      notifications.show({ message: r.message, color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
      refetch()
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete the booking', color: 'red' })
    }
  }

  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setStamp(null)
    setViewNo('')
    setValues({}) // no resetKey bump: the Designer defaults come back only when New is pressed
    setAttempted(false)
    setLastSaved(null)
    setIdle(true)
  }
  function startNew() {
    setIdle(false)
    setViewId(null)
    setEditing(false)
    setStamp(null)
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
  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'booking' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave('save'),
    onNew: () => (viewId || idle) && startNew(),
    onPrint: () => (viewId ? printWithFormat(pickFormat(printFormats)) : lastSaved && setPrintFor(lastSaved.hb_id)),
    onDirectPrint: () => (viewId ? directPrint(viewId) : !idle && onSave('print')),
  })

  // The Options button of the open booking (legacy svtBtnCtrl): Receipt Info and Donation for <prefix>, from the same list as the Recent bookings menu
  const navOptions = hbOptions.map((o) => ({
    name: o.name,
    label: o.label,
    onClick: (id) => {
      if (o.kind === 'receipt-info') return setPaymentFor(id)
      navigate('/donations', {
        state: { prefill: { prefix: o.prefix, hb_id: id, donor: values.CONPRS || '', contact_no: values.CONTACTNO || '', address: values.ADDRESS || '', pan_no: values.PAN || '', reference_no: o.prefix === 'SLV' ? '' : values.REFNO || '' } },
      })
    },
  }))

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Group gap="sm" align="center">
              <Title order={2}>Hall Booking</Title>
              {viewId && stamp && <Badge color={stamp.color} variant="light" size="lg">{stamp.text}</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              Book the community hall and record advance and final payments
            </Text>
          </div>
        </Group>
        <DocNoDate docId={DOC_ID} type={values.TYPE || undefined} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateDisabled={readOnly || !rules.edit_doc_date} />
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
              <DetailsStrip title="Booking" hint="Drawn from this temple's Doc Designer.">
                <DocFieldsForm
                  docId={DOC_ID}
                  section="Header"
                  values={values}
                  setValue={setValue}
                  setValues={setValues}
                  resetKey={resetKey}
                  seedDefaults={!idle}
                  errors={attempted ? errors : {}}
                  skip={COMPUTED_CODES}
                  readOnly={readOnly}
                  singleAddress
                />
              </DetailsStrip>
            )}
          </Stack>
        }
        side={
          <>
            <HallCalendarBox />
            <SummaryCard
              compact
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
              hideActions // Save lives in the ribbon below (no separate Save & Print)
            />
            {lastSaved && (
              <SavedPanel
                lines={[`Booking ${lastSaved.hb_no}`, `Net ${formatINR(lastSaved.net_pay)}`]}
                printLabel="Print booking receipt"
                onPrint={() => setPrintFor(lastSaved.hb_id)}
              />
            )}
            <Button
              variant="subtle"
              color="kumkum"
              size="compact-sm"
              onClick={toggleSide}
              aria-expanded={sideOpen}
              leftSection={sideOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              style={{ alignSelf: 'flex-end' }}
            >
              {sideOpen ? 'Hide recent bookings' : 'Show recent bookings'}
            </Button>
            {sideOpen && (
            <RecentCard
              docId={DOC_ID}
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
              onLoad={viewRecord}
            />
            )}
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} lastSaved={lastSaved ? { id: lastSaved.hb_id, label: lastSaved.print_no || lastSaved.hb_no } : null} onLoad={viewRecord} onNew={startNew} showNew={Boolean(viewId) && !editing} entryMode={!viewId && !idle} newOnly={idle} cancelEditLabel="Cancel" onCancelEntry={cancelEntry} onClose={() => navigate('/')} onPrint={() => printWithFormat(pickFormat(printFormats))} printFormats={printFormats} onPrintFormat={printWithFormat} onEdit={startEdit} onCancelEdit={cancelEdit} onSave={() => onSave('save')} saving={saving} editing={editing} onCancelDoc={cancelDocument} onDelete={deleteDocument} search={findBookings} extraOptions={navOptions} alertify={alertify.nav} />
      {alertify.modal}
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Hall Booking Receipt" initialOption={printOption} />
      <HallPaymentPanel hbId={paymentFor} onClose={() => setPaymentFor(null)} />
    </Stack>
  )
}
