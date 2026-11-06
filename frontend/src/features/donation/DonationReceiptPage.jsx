import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useEffect, useState } from 'react'
import { Button, Group, NumberInput, Select, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Copy, Gift } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as donationApi from '../../api/endpoints/donation'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import SplitPaymentPanel, { refRequiredModes, splitError, splitFromSaved, splitPayload } from '../../components/ui/SplitPaymentPanel'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import usePrefixes from '../../hooks/usePrefixes'
import { useHotkeys } from 'react-hotkeys-hook'
import DonorHistoryModal from './DonorHistoryModal'
import DocNavBar from '../../components/ui/DocNavBar'
import CopyFromDialog from '../../components/ui/CopyFromDialog'
import useDocRules from '../../hooks/useDocRules'
import { useLocation } from 'react-router-dom'
import useDocFields from '../../hooks/useDocFields'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import dayjs from 'dayjs'
import { useAuth } from '../../hooks/useAuth'
import useBillAlertify from '../alertify/useBillAlertify'
import { columnsFromLines, computeFormulas } from '../../utils/docCompute'

const DOC_ID = 1261
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
// Computed by the server / shown in the summary, so not drawn as inputs.
const COMPUTED_CODES = ['AMTINWORDS', 'ISSUEDBY', 'TOTAMT']
// Entered fresh for each donor (the payment mode etc. carry over to the next receipt).
// the single-payment fields: with a split receipt the main part supplies them, so they are not shown
const SPLIT_PAY_CODES = ['PAYMNTMODE', 'LEDID', 'REFNO', 'CHEQUENO', 'CHEQUEDATE', 'BANKNAME']
const PER_DONOR_CODES = ['DONOR', 'CONTACTNO', 'ADDRESS', 'PANNO', 'REFNO', 'CHEQUENO', 'CHEQUEDATE', 'BANKNAME', 'RMKS', 'HBID']

export default function DonationReceiptPage() {
  const queryClient = useQueryClient()
  // The receipt is rendered from the Doc Designer (UtlDocDsgrFlds): header/footer fields by FldCode, detail lines.
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [prefix, setPrefix] = useState(null) // null = not loaded yet; '' is a valid (blank) prefix
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [donorOpen, setDonorOpen] = useState(false)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')
  const [donorLimit, setDonorLimit] = useState('')
  const [copyOpen, setCopyOpen] = useState(false)
  const rules = useDocRules(DOC_ID) // UtlTransactions switches: Copy From, document-date lock ...

  const { fields } = useDocFields(DOC_ID)
  const { user } = useAuth()
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))

  const total = lines.reduce((sum, l) => sum + (Number(l.AMOUNT) || 0), 0)
  // Split payment: the receipt paid in parts by different modes (WebSplitPayment). The header mirrors the main part.
  const [splitOn, setSplitOn] = useState(false)
  const [splitParts, setSplitParts] = useState([])
  const refModes = refRequiredModes(fields, 'PAYMNTMODE')
  // the Designer's formulas (TOTAMT, AMTINWORDS, ISSUEDBY ...) for a new receipt; a saved one shows what was stored
  const computed = viewId ? undefined : computeFormulas(fields, values, columnsFromLines(lines), { userCode: user?.user_code || '' })

  // Always at least one line, like the legacy grid.
  useEffect(() => {
    if (fields.length && lines.length === 0 && !viewId) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length, viewId])

  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values, COMPUTED_CODES)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError =
    splitError(splitOn, splitParts, total, refModes) ||
    Object.values(headErrors)[0] ||
    Object.values(Object.values(lineErrors)[0] || {})[0] ||
    (prefix === null ? 'No document-number prefix configured' : null) ||
    (!(total > 0) ? 'Enter an amount greater than 0' : null)
  const canSave = !firstError
  const alertify = useBillAlertify({
    docId: DOC_ID, label: 'Donation', user: user?.user_code, fields, values, savedNo: viewId ? viewNo : '',
    totals: [{ caption: 'Doc Date', value: dayjs(docDate).format('DD/MM/YYYY') }, { caption: 'Total Amount', value: formatINR(total) }, { caption: 'Net Amount', value: formatINR(total) }],
    anchors: [isoDate(docDate)], defaultDir: 'after', valid: canSave, hint: firstError || 'Fill the bill details first',
  })

  async function onBlurField(code) {
    if (code !== 'CONTACTNO') return
    const contact = String(values.CONTACTNO || '')
    if (contact.length < 10) return
    try {
      const donor = await donationApi.lookupDonor(contact)
      if (donor) {
        setValues((cur) => ({ ...cur, DONOR: donor.DONOR || cur.DONOR, ADDRESS: donor.ADDRESS || cur.ADDRESS, PANNO: donor.PANNO || cur.PANNO }))
        notifications.show({ message: `Found: ${donor.DONOR}`, color: 'teal' })
      }
    } catch {
      /* no previous donor found — fine, first-time donor */
    }
  }

  const { data: prefixes } = usePrefixes(DOC_ID)
  // "Donation for <prefix>" on a Hall Booking opens this screen with the booking's details filled in (legacy FillHBEHdrData).
  const location = useLocation()
  useEffect(() => {
    const p = location.state?.prefill
    if (!p) return
    if (p.prefix) setPrefix(p.prefix)
    setValues((cur) => ({ ...cur, HBID: p.hb_id, DONOR: p.donor, CONTACTNO: p.contact_no, ADDRESS: p.address, PANNO: p.pan_no, REFNO: p.reference_no }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
  useEffect(() => {
    if (prefixes?.length && prefix === null && !location.state?.prefill) setPrefix(prefixes[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixes])
  const { data: recent, refetch, isLoading: recentLoading } = useQuery({
    queryKey: ['donations', 'recent'],
    queryFn: () => donationApi.listDonations(historyParams()),
  })

  // Show Donor: copy the chosen earlier donor's details and first seva line (legacy btnShowDonars_Click)
  function applyDonor(r) {
    setValues((cur) => ({ ...cur, DONOR: r.DONOR || '', ADDRESS: r.ADDRESS || '', CONTACTNO: r.CONTACTNO || '', REFNO: r.REFNO || cur.REFNO, PANNO: r.PANNO || cur.PANNO }))
    if (r.SEVAID) {
      setLines((ls) =>
        ls.length ? ls.map((l, i) => (i === 0 ? { ...l, SEVAID: r.SEVAID, SEVANME: r.SEVANME || l.SEVANME } : l)) : [{ ...blankLine(fields), SEVAID: r.SEVAID, SEVANME: r.SEVANME }]
      )
    }
    setDonorOpen(false)
  }

  // Map a saved TrnHdrDONREC row (+ lines) into the entry: its columns are the Designer FldCodes
  function fillFromDonation(l, withMeta = false) {
    const next = {}
    for (const f of fields) {
      if (f.FldSection === 'Detail') continue
      const v = l[f.FldCode]
      if (v === null || v === undefined) next[f.FldCode] = ''
      else if (f.FldDataType === 'Date') next[f.FldCode] = new Date(v)
      else if (f.FldBlnComboData === 'Y') next[f.FldCode] = Number(v) || ''
      else next[f.FldCode] = String(v).trim()
    }
    setValues(next)
    setLines((l.lines || []).map((x) => ({ SEVAID: x.SEVAID || '', SEVANME: (x.SEVANME || '').trim(), AMOUNT: Number(x.AMOUNT) || 0 })))
    if (withMeta && l.DONRECDate) setDocDate(new Date(l.DONRECDate))
  }

  // F6 loads the last receipt so it can be re-entered (legacy: Add mode)
  async function loadLastEntry() {
    try {
      const l = await donationApi.lastDonation()
      if (!l) return notifications.show({ message: 'No previous entry found', color: 'yellow' })
      fillFromDonation(l)
      notifications.show({ message: `Loaded last entry ${l.PrintDONRECNO || l.DONRECNO}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not load the last entry', color: 'red' })
    }
  }

  // Record navigation: show a saved receipt read-only; New goes back to a blank entry
  async function viewRecord(id) {
    try {
      const l = await donationApi.getDonation(id)
      fillFromDonation(l, true)
      setSplitParts(splitFromSaved(l.split_payments))
      setSplitOn((l.split_payments || []).length > 1)
      setViewId(id)
      setViewNo(l.PrintDONRECNO || l.DONRECNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewNo('')
    setSplitOn(false)
    setSplitParts([])
    setLines([])
    setValues({})
    setAttempted(false)
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setDocDate(new Date())
  }
  async function findDonations(q, { allFy = true } = {}) {
    const rows = await donationApi.listDonations({ search: q, top: 30, ...(allFy ? { days: 0 } : {}) })
    return rows.map((r) => ({ id: r.DONRECID, label: r.PrintDONRECNO || r.DONRECNO, sub: `${r.DONOR || ''} ${r.CONTACTNO || ''}`.trim() }))
  }
  // Copy From: the chosen saved receipt's details become a new entry (nothing is opened for viewing)
  async function copyFrom(id) {
    try {
      const l = await donationApi.getDonation(id)
      fillFromDonation(l)
      notifications.show({ message: `Copied from ${l.PrintDONRECNO || l.DONRECNO}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not copy that document', color: 'red' })
    }
  }
  useHotkeys('f6', (e) => { e.preventDefault(); if (!viewId) loadLastEntry() }, { enableOnFormTags: true }, [viewId])

  function payload() {
    return Object.fromEntries(
      Object.entries(values)
        .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !COMPUTED_CODES.includes(k))
        .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
    )
  }

  async function onSave(mode) {
    setAttempted(true)
    if (!canSave) {
      if (firstError) notifications.show({ message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const cleanLines = lines.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== '' && v !== null && v !== undefined)))
      const result = await donationApi.createDonation({ prefix, doc_date: isoDate(docDate), fields: payload(), lines: cleanLines, ...(splitOn ? { split_payments: splitPayload(splitParts) } : {}) })
      setLastSaved(result)
      alertify.afterSave({ 'Doc No': result.donrec_no }) // the Alertify reminder asked for before saving; it never blocks the bill
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.donrec_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.donrec_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues((cur) => {
        const keep = { ...cur }
        PER_DONOR_CODES.forEach((c) => delete keep[c])
        return keep
      })
      setLines([])
      setSplitOn(false)
      setSplitParts([])
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['donations'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  useDocShortcuts({
    onSave: () => !viewId && onSave('save'),
    onPrint: () => lastSaved && setPrintFor(lastSaved.donrec_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : onSave('print')),
  })

  const paymentLabel = values.PAYMNTMODE ? String(values.PAYMNTMODE) : null

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Donation Receipt Entry</Title>
            <Text size="sm" c="dimmed">
              Record a donation and issue its receipt
            </Text>
          </div>
        </Group>
        <Group gap="xs" align="flex-end">
          {(prefixes || []).filter(Boolean).length > 1 && (
            <Select aria-label="Prefix" w={110} data={prefixes.filter(Boolean)} value={prefix || null} onChange={(v) => setPrefix(v || '')} allowDeselect={false} disabled={Boolean(viewId)} />
          )}
          <DocNoDate docId={DOC_ID} prefix={prefix ?? undefined} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateDisabled={Boolean(viewId) || !rules.edit_doc_date} />
        </Group>
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <Stack gap="lg">
            <SectionCard title="Receipt and donor" hint="Drawn from this temple's Doc Designer. A known contact number fills the donor's details.">
              <DocFieldsForm
                docId={DOC_ID}
                section="Header"
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                errors={attempted ? headErrors : {}}
                computed={computed}
                readOnly={Boolean(viewId)}
                onBlurField={onBlurField}
                skip={splitOn ? SPLIT_PAY_CODES : undefined}
              />
              {!viewId && (
                <Group gap="xs" align="flex-end" mt="md">
                  <NumberInput aria-label="Show No. of records" placeholder="Nos" w={70} min={0} hideControls value={donorLimit} onChange={setDonorLimit} />
                  <Button variant="light" color="kumkum" onClick={() => setDonorOpen(true)}>
                    Show Donor
                  </Button>
                  {rules.allow_copy_from && (
                    <Button variant="light" color="kumkum" leftSection={<Copy size={16} />} onClick={() => setCopyOpen(true)}>
                      Copy From
                    </Button>
                  )}
                </Group>
              )}
            </SectionCard>

            <SectionCard title="Amount" hint="Each line is a donation (optionally for a seva); the lines add up to the receipt total.">
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} readOnly={Boolean(viewId)} />
            </SectionCard>

            <SectionCard title="Payment details">
              <DocFieldsForm
                docId={DOC_ID}
                section="Footer"
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                errors={attempted ? headErrors : {}}
                computed={computed}
                readOnly={Boolean(viewId)}
                skip={splitOn ? SPLIT_PAY_CODES : undefined}
              />
              <SplitPaymentPanel
                docType="DONREC"
                docId={DOC_ID}
                enabled={splitOn}
                setEnabled={setSplitOn}
                parts={splitParts}
                setParts={setSplitParts}
                total={total}
                readOnly={Boolean(viewId)}
                refModes={refModes}
                onMain={(m) => setValues((cur) => ({ ...cur, PAYMNTMODE: m.mode, LEDID: m.led_id, REFNO: m.ref_no || '', ...(String(m.mode).toUpperCase() === 'CHEQUE' ? { CHEQUENO: m.ref_no || '', CHEQUEDATE: m.chq_date || '', BANKNAME: m.bank_name || '' } : {}) }))}
              />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                ...(paymentLabel ? [{ label: 'Payment', value: paymentLabel }] : []),
                { label: 'Lines', value: lines.length },
              ]}
              totalLabel="Donation amount"
              total={formatINR(total)}
              words={total}
              warning={firstError || null}
              saving={saving}
              saveDisabled={!canSave || Boolean(viewId)}
              onSave={() => onSave('save')}
              onSavePrint={() => onSave('print')}
            />
            {lastSaved && (
              <SavedPanel
                lines={[`Donation ${lastSaved.donrec_no}`, ...(lastSaved.receipt_no ? [`Receipt ${lastSaved.receipt_no}`] : [])]}
                onPrint={() => setPrintFor(lastSaved.donrec_id)}
              />
            )}
            <RecentCard
              docId={DOC_ID}
              title="Recent donations"
              icon={Gift}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No donations yet"
              emptyHint="Saved receipts will be listed here."
              renderRow={(d) => ({
                key: d.DONRECID,
                title: d.PrintDONRECNO,
                subtitle: `${d.DONOR} · ${formatINR(d.TOTAMT)}`,
                printLabel: `Print ${d.PrintDONRECNO}`,
                onPrint: () => setPrintFor(d.DONRECID),
              })}
            />
          </>
        }
      />

      <CopyFromDialog opened={copyOpen} onClose={() => setCopyOpen(false)} docName="Donation Reciept Entry" search={findDonations} onLoad={copyFrom} />
      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} lastSaved={lastSaved ? { id: lastSaved.donrec_id, label: lastSaved.donrec_no } : null} onLoad={viewRecord} onNew={startNew} search={findDonations} alertify={alertify.nav} />
      {alertify.modal}
      <DonorHistoryModal opened={donorOpen} onClose={() => setDonorOpen(false)} onPick={applyDonor} initialName={values.DONOR || ''} limit={Number(donorLimit) || 0} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Donation Receipt" />
    </Stack>
  )
}
