import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import SevakartharuModal from './SevakartharuModal'
import GroupSevaModal from './GroupSevaModal'
import DocNavBar from '../../components/ui/DocNavBar'
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Grid,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  ActionIcon,
 
  Skeleton,
} from '@mantine/core'
import { DateInput, TimeInput } from '@mantine/dates'
import { Plus, Trash2, Printer, Search, Receipt, CalendarPlus, CheckCircle2, Users } from 'lucide-react'
import dayjs from 'dayjs'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as sevaApi from '../../api/endpoints/seva'
import * as mastersApi from '../../api/endpoints/masters'
import LookupSelect from '../../components/LookupSelect'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import DynamicField from '../../components/DynamicField'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import EmptyState from '../../components/ui/EmptyState'
import { EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import { digitsOnly, formatTiming, listToOptions, matchListValue, normaliseName, titleCase } from '../../utils/entryHelpers'

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — lets the SAME live designer metadata that drives frmTrnSeva's hide/
// mandatory rules and captions drive this screen too (CLAUDE.md rule 5),
// without renaming this component's internal state to raw column names.
const FIELD_CODE_MAP = {
  SANNIDHIID: 'sannidhi_id', SVAID: 'seva_id', MOBNUM: 'mobile', KNAME: 'name',
  NAMEINKAN: 'name_kn', GOTHRAID: 'gothra_id', NAKSHATRAID: 'nakshatra_id', RASHIID: 'rashi_id',
  SECKNAME: 'name2', SECNAKSHATRAID: 'nakshatra2_id', SECRASHIID: 'rashi2_id', RMKS: 'timing_text',
  PAYMENT: 'payment_mode', BANKNAME: 'bank_name', CHQNO: 'cheque_no', CHQDATE: 'cheque_date',
  REFNO: 'reference_no', ADDRES: 'address', LEDGER: 'ledger_id', LEDID: 'cash_bank_ledger_id', VCHTYP: 'voucher_type',
}

const PAYMENT_MODES = ['CASH', 'CARD', 'CHEQUE', 'UPI']
const VOUCHER_TYPES = ['Cash', 'Bank', 'Card']
// Which book each payment mode may post to. Payment Mode and Voucher Type were two unrelated pickers, so
// "UPI + Cash" was possible and the receipt would have been posted to the cash book. Voucher Type now follows the
// payment mode and only offers the books that make sense for it.
const VOUCHER_FOR_PAYMENT = { CASH: ['Cash'], CARD: ['Card', 'Bank'], CHEQUE: ['Bank'], UPI: ['Bank'] }
const BANK_NAMES = ['AXIS BANK', 'HDFC BANK', 'STATE BANK OF INDIA', 'BANK OF BARODA', 'PUNJAB NATIONAL BANK', 'UNION BANK OF INDIA', 'KOTAK BANK', 'INDUSIND BANK', 'ICICI BANK', 'IDFC FIRST BANK', 'FEDERAL BANK', 'OTHERS']
const DOC_ID = 1263
// Domain cheat-sheet (CLAUDE.md §6): 1255 Sannidhi, 1265 Seva, 1257 Gothra, 1258 Nakshatra, 1279 Rashi.
const SEVA_MASTER_DOC_ID = 1265
const NAKSHATRA_MASTER_DOC_ID = 1258
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

export default function SevaEntryPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    sannidhi_id: '',
    seva_id: '',
    mobile: '',
    name: '',
    name_kn: '',
    gothra_id: '',
    nakshatra_id: '',
    rashi_id: '',
    name2: '',
    nakshatra2_id: '',
    rashi2_id: '',
    timing_text: '',
    address: '',
    is_regular: false,
    add1: '',
    add2: '',
    add3: '',
    add4: '',
    mobile_no: '',
    prasada: false,
    payment_mode: 'CASH',
    bank_name: '',
    cheque_no: '',
    cheque_date: null,
    reference_no: '',
    ledger_id: '',
    cash_bank_ledger_id: '',
    voucher_type: 'Cash',
    rate: '',
    doc_date: new Date(),
  })
  const [touched, setTouched] = useState({})
  const [dateError, setDateError] = useState('')
  const [dates, setDates] = useState([])
  const [newDate, setNewDate] = useState(new Date())
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [viewId, setViewId] = useState(null) // a saved seva being looked at (read-only)
  const [viewNo, setViewNo] = useState('')
  const [pickLimit, setPickLimit] = useState('')

  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  // Live raw values keyed by legacy FldCode, for evaluating hide/mandatory
  // conditions exactly like `#PAYMENT# <> 'CASH'` against the CURRENT form.
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  // Any designer field not already covered by a hardcoded input above —
  // renders automatically if someone adds a new field via the Designer tool.
  const knownCodes = new Set(Object.keys(FIELD_CODE_MAP))
  const extraDesignerFields = Object.values(fieldMeta).filter(
    (f) => !knownCodes.has(f.FldCode) && !hidden(f.FldCode) && f.FldSection === 'Header'
  )
  const [extra, setExtra] = useState({})

  // Option lists come from the designer metadata (stored values untouched); labels are capitalised consistently.
  const paymentList = fieldListOptions(fieldMeta.PAYMENT, PAYMENT_MODES)
  const voucherList = fieldListOptions(fieldMeta.VCHTYP, VOUCHER_TYPES)
  const allowedVouchers = voucherList.filter((v) => (VOUCHER_FOR_PAYMENT[form.payment_mode] || voucherList).includes(v))

  // The metadata default ("Cash") differs in case from its own list ("CASH"): resolve it to the real entry so the
  // dropdown actually shows it, instead of staying blank while the summary pretends something is selected.
  useEffect(() => {
    const def = matchListValue(paymentList, fieldMeta.PAYMENT?.FldDefStdDefault || 'CASH')
    setForm((f) => {
      const current = matchListValue(paymentList, f.payment_mode) || def
      const wanted = voucherFor(current, voucherList)
      return { ...f, payment_mode: current, voucher_type: (VOUCHER_FOR_PAYMENT[current] || []).includes(f.voucher_type) ? f.voucher_type : wanted }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldMeta.PAYMENT, fieldMeta.VCHTYP])

  function voucherFor(mode, list) {
    return (VOUCHER_FOR_PAYMENT[mode] || [])[0] ? matchListValue(list, VOUCHER_FOR_PAYMENT[mode][0]) : list[0]
  }

  function onPaymentChange(mode) {
    setForm((f) => ({ ...f, payment_mode: mode || '', voucher_type: mode ? voucherFor(mode, voucherList) : f.voucher_type }))
  }

  // ---- inline validation (shown under each field once it is touched or a save was attempted)
  const errors = {}
  if (!form.sannidhi_id) errors.sannidhi_id = `${caption('SANNIDHIID', 'Sannidhi')} is required`
  if (!form.seva_id) errors.seva_id = `${caption('SVAID', 'Seva')} is required`
  if (!form.name.trim()) errors.name = `${caption('KNAME', 'Name')} is required`
  if (form.mobile && form.mobile.length !== 10) errors.mobile = 'Enter a 10-digit mobile number'
  else if (mandatory('MOBNUM') && !form.mobile) errors.mobile = `${caption('MOBNUM', 'Mobile Number')} is required for ${titleCase(form.payment_mode)} payment`
  if (!form.payment_mode) errors.payment_mode = `${caption('PAYMENT', 'Payment Mode')} is required`
  if (form.payment_mode && !allowedVouchers.includes(form.voucher_type)) errors.voucher_type = `${titleCase(form.payment_mode)} payments post to: ${allowedVouchers.map(titleCase).join(' / ')}`
  if (!(Number(form.rate) > 0)) errors.rate = 'Enter a rate greater than 0'
  if (mandatory('REFNO') && !form.reference_no.trim()) errors.reference_no = `${caption('REFNO', 'Reference No')} is required for ${titleCase(form.payment_mode)} payment`
  if (!form.ledger_id) errors.ledger_id = `${caption('LEDGER', 'Income Ledger')} is required`
  if (!form.cash_bank_ledger_id) errors.cash_bank_ledger_id = `${caption('LEDID', 'Cash / Bank Account')} is required`
  if (dates.length === 0) errors.dates = 'Add at least one seva date'
  const firstError = Object.values(errors)[0]
  const canSave = !firstError
  const touch = (k) => setTouched((t) => ({ ...t, [k]: true }))
  const err = (k) => (touched[k] || touched.__all ? errors[k] : undefined)

  const { data: recent, refetch, isLoading: recentLoading } = useQuery({
    queryKey: ['sevas', 'recent'],
    queryFn: () => sevaApi.listSevas({ top: 15 }),
  })

  const totalAmt = (Number(form.rate) || 0) * dates.length

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function onSevaChange(sevaId) {
    set('seva_id', sevaId)
    if (!sevaId) return
    try {
      // Legacy frmTrnSeva auto-fills Rate from the Seva master's Amount the
      // instant a Seva is picked (MstSVA.AMT) — was previously left blank.
      const row = await mastersApi.getMasterRow(SEVA_MASTER_DOC_ID, sevaId)
      if (row?.AMT != null) set('rate', Number(row.AMT))
    } catch {
      /* master row fetch failed — leave rate as-is, don't block data entry */
    }
  }

  async function onNakshatraChange(nakshatraId) {
    set('nakshatra_id', nakshatraId)
    if (!nakshatraId) return
    try {
      // Legacy auto-fills Rashi from the Nakshatra master's linked Rashi
      // (MstNAKSHATRA.RASHIID1) — was previously left as an independent pick.
      const row = await mastersApi.getMasterRow(NAKSHATRA_MASTER_DOC_ID, nakshatraId)
      if (row?.RASHIID1 != null) set('rashi_id', Number(row.RASHIID1))
    } catch {
      /* master row fetch failed — leave rashi as-is */
    }
  }

  async function onMobileBlur() {
    touch('mobile')
    if (!form.mobile || form.mobile.length !== 10) return
    try {
      const devotee = await sevaApi.lookupDevotee(form.mobile)
      if (devotee) {
        // Port of legacy SevaDetails() auto-fill — pulls every field from the
        // devotee's last non-cancelled seva, not just the name.
        setForm((f) => ({
          ...f,
          name: devotee.KNAME || '',
          name_kn: devotee.NAMEINKAN || '',
          gothra_id: devotee.GOTHRAID ?? '',
          nakshatra_id: devotee.NAKSHATRAID ?? '',
          rashi_id: devotee.RASHIID ?? '',
          name2: devotee.SECKNAME || '',
          nakshatra2_id: devotee.SECNAKSHATRAID ?? '',
          rashi2_id: devotee.SECRASHIID ?? '',
        }))
        notifications.show({ message: `Found: ${devotee.KNAME}`, color: 'teal' })
      }
    } catch {
      /* no previous devotee found — fine, first-time visitor */
    }
  }

  function addDate() {
    if (!newDate) {
      setDateError('Pick a date first')
      return
    }
    const iso = isoDate(newDate)
    if (dates.some((d) => d.perform_date === iso)) {
      setDateError(`${dayjs(iso).format('DD/MM/YYYY')} is already added`)
      return
    }
    setDateError('')
    setDates((d) => [...d, { perform_date: iso, remarks: '' }].sort((a, b) => a.perform_date.localeCompare(b.perform_date)))
  }

  function removeDate(idx) {
    setDates((d) => d.filter((_, i) => i !== idx))
  }

  // Select Sevakartharu: copy the chosen regular devotee's details into this entry (legacy fillSevaDetails)
  function applyDevotee(r) {
    setForm((f) => ({
      ...f,
      name: r.KNAME || '',
      name_kn: r.NAMEINKAN || f.name_kn,
      gothra_id: r.GOTHRAID ?? '',
      nakshatra_id: r.NAKSHATRAID ?? '',
      rashi_id: r.RASHIID ?? '',
      name2: r.SECKNAME || '',
      nakshatra2_id: r.SECNAKSHATRAID ?? '',
      rashi2_id: r.SECRASHIID ?? '',
      add1: r.Add1 || '',
      add2: r.Add2 || '',
      add3: r.Add3 || '',
      add4: r.Add4 || '',
      mobile_no: r.MOBNO || '',
    }))
    setPickOpen(false)
  }

  // Map a saved TrnHdrSEVA row (+ its dates) into the entry form
  function fillFromSeva(l, { withDates = false } = {}) {
    setForm((f) => ({
      ...f,
      sannidhi_id: l.SANNIDHIID ?? f.sannidhi_id,
      seva_id: l.SVAID ?? f.seva_id,
      mobile: l.MOBNUM || '',
      mobile_no: l.MOBNO || '',
      name: l.KNAME || '',
      name_kn: l.NAMEINKAN || '',
      gothra_id: l.GOTHRAID ?? '',
      nakshatra_id: l.NAKSHATRAID ?? '',
      rashi_id: l.RASHIID ?? '',
      name2: l.SECKNAME || '',
      nakshatra2_id: l.SECNAKSHATRAID ?? '',
      rashi2_id: l.SECRASHIID ?? '',
      timing_text: l.RMKS || '',
      add1: l.Add1 || '',
      add2: l.Add2 || '',
      add3: l.Add3 || '',
      add4: l.Add4 || '',
      is_regular: (l.RegularD || 'N') === 'Y',
      rate: l.SevaRate ?? f.rate,
      ...(withDates
        ? {
            payment_mode: l.PAYMENT || f.payment_mode,
            bank_name: l.BANKNAME || '',
            cheque_no: l.CHQNO || '',
            cheque_date: l.CHQDATE ? new Date(l.CHQDATE) : null,
            reference_no: l.REFNO || '',
            address: l.ADDRES || '',
            ledger_id: l.LEDGER ?? f.ledger_id,
            cash_bank_ledger_id: l.LEDID ?? f.cash_bank_ledger_id,
            voucher_type: l.VCHTYP || f.voucher_type,
            doc_date: l.SEVADate ? new Date(l.SEVADate) : f.doc_date,
          }
        : {}),
    }))
    if (withDates) setDates((l.dates || []).map((d) => ({ perform_date: dayjs(d.PDate).format('YYYY-MM-DD'), remarks: d.PRemarks || '' })))
  }

  // F6 loads the last entry so it can be re-entered (legacy frmTrnSeva: Add mode only)
  async function loadLastEntry() {
    try {
      const l = await sevaApi.lastSeva()
      if (!l) return notifications.show({ message: 'No previous entry found', color: 'yellow' })
      fillFromSeva(l)
      notifications.show({ message: `Loaded last entry ${l.PrintSEVANO || l.SEVANO}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not load the last entry', color: 'red' })
    }
  }

  // Record navigation: show a saved seva read-only; New goes back to a blank entry
  async function viewRecord(id) {
    try {
      const l = await sevaApi.getSeva(id)
      fillFromSeva(l, { withDates: true })
      setViewId(id)
      setViewNo(l.PrintSEVANO || l.SEVANO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewNo('')
    setDates([])
    setTouched({})
    setForm((f) => ({ ...f, rate: '', mobile: '', mobile_no: '', name: '', name_kn: '', name2: '', timing_text: '', add1: '', add2: '', add3: '', add4: '', doc_date: new Date() }))
  }
  async function findSevas(q) {
    const rows = await sevaApi.listSevas({ search: q, top: 30 })
    return rows.map((r) => ({ id: r.SEVAID, label: r.PrintSEVANO || r.SEVANO, sub: `${r.KNAME || ''} ${r.MOBNUM || ''}`.trim() }))
  }
  useHotkeys('f6', (e) => { e.preventDefault(); if (!viewId) loadLastEntry() }, { enableOnFormTags: true }, [viewId])

  async function onSave(mode) {
    touch('__all')
    if (!canSave) return
    setSaving(true)
    try {
      const body = {
        ...form,
        name: normaliseName(form.name),
        name2: normaliseName(form.name2),
        timing_text: formatTiming(form.timing_text),
        sannidhi_id: Number(form.sannidhi_id),
        seva_id: Number(form.seva_id),
        ledger_id: Number(form.ledger_id),
        cash_bank_ledger_id: Number(form.cash_bank_ledger_id),
        gothra_id: form.gothra_id ? Number(form.gothra_id) : null,
        nakshatra_id: form.nakshatra_id ? Number(form.nakshatra_id) : null,
        rashi_id: form.rashi_id ? Number(form.rashi_id) : null,
        nakshatra2_id: form.nakshatra2_id ? Number(form.nakshatra2_id) : null,
        rashi2_id: form.rashi2_id ? Number(form.rashi2_id) : null,
        cheque_date: form.cheque_date ? isoDate(form.cheque_date) : null,
        rate: Number(form.rate),
        doc_date: isoDate(form.doc_date),
        dates,
        extra_fields: extra,
      }
      const result = await sevaApi.createSeva(body)
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.seva_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.seva_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setDates([])
      setTouched({})
      setForm((f) => ({ ...f, rate: '', mobile: '', name: '', name_kn: '', name2: '', timing_text: '' }))
      queryClient.invalidateQueries({ queryKey: ['sevas'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const [printFor, setPrintFor] = useState(null)

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  useDocShortcuts({
    onSave: () => !viewId && onSave('save'),
    onPrint: () => lastSaved && setPrintFor(lastSaved.seva_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : onSave('print')),
  })

  return (
    <Stack gap="lg" className="vt-rise">
      {/* Page header */}
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Seva Entry</Title>
            <Text size="sm" c="dimmed">
              Record a devotee's seva booking and print the receipt
            </Text>
          </div>
        </Group>
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <>
        <Stack gap="lg">
          <Card withBorder p="lg">
            <Title order={4} mb={2}>Seva and devotee</Title>
            <Text size="xs" c="dimmed" mb="md">Choose the seva, then the devotee. A known mobile number fills the rest.</Text>
            <Grid>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <LookupSelect docId={DOC_ID} field="SANNIDHIID" label={caption('SANNIDHIID', 'Sannidhi')} required={mandatory('SANNIDHIID')} value={form.sannidhi_id} onChange={(v) => { set('sannidhi_id', v); touch('sannidhi_id') }} error={err('sannidhi_id')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <LookupSelect docId={DOC_ID} field="SVAID" label={caption('SVAID', 'Seva')} required={mandatory('SVAID')} value={form.seva_id} onChange={(v) => { onSevaChange(v); touch('seva_id') }} error={err('seva_id')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput
              label={caption('MOBNUM', 'Mobile Number')}
              required={mandatory('MOBNUM')}
              value={form.mobile}
              onChange={(e) => set('mobile', digitsOnly(e.currentTarget.value))}
              onBlur={onMobileBlur}
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="10-digit number"
              error={err('mobile')}
              rightSection={<Search size={16} aria-hidden />}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput label={caption('KNAME', 'Name')} required value={form.name} onChange={(e) => set('name', e.currentTarget.value)} onBlur={() => { set('name', normaliseName(form.name)); touch('name') }} error={err('name')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <LookupSelect docId={DOC_ID} field="GOTHRAID" label={caption('GOTHRAID', 'Gothra')} required={mandatory('GOTHRAID')} value={form.gothra_id} onChange={(v) => set('gothra_id', v)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <LookupSelect docId={DOC_ID} field="NAKSHATRAID" label={caption('NAKSHATRAID', 'Nakshatra')} required={mandatory('NAKSHATRAID')} value={form.nakshatra_id} onChange={onNakshatraChange} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <LookupSelect docId={DOC_ID} field="RASHIID" label={caption('RASHIID', 'Rashi')} required={mandatory('RASHIID')} value={form.rashi_id} onChange={(v) => set('rashi_id', v)} />
          </Grid.Col>
          {/* Second devotee on this seva — tracked/saved already, but was
              missing its own inputs entirely (metadata: visible, optional). */}
          {!hidden('SECKNAME') && (
            <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
              <TextInput label={caption('SECKNAME', 'Name-2')} required={mandatory('SECKNAME')} value={form.name2} onChange={(e) => set('name2', e.currentTarget.value)} onBlur={() => set('name2', normaliseName(form.name2))} />
            </Grid.Col>
          )}
          {!hidden('SECNAKSHATRAID') && (
            <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
              <LookupSelect docId={DOC_ID} field="SECNAKSHATRAID" label={caption('SECNAKSHATRAID', 'Nakshatra-2')} required={mandatory('SECNAKSHATRAID')} value={form.nakshatra2_id} onChange={(v) => set('nakshatra2_id', v)} />
            </Grid.Col>
          )}
          {!hidden('SECRASHIID') && (
            <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
              <LookupSelect docId={DOC_ID} field="SECRASHIID" label={caption('SECRASHIID', 'Rashi-2')} required={mandatory('SECRASHIID')} value={form.rashi2_id} onChange={(v) => set('rashi2_id', v)} />
            </Grid.Col>
          )}
            </Grid>
          </Card>

          <Card withBorder p="lg">
            <Title order={4} mb={2}>Booking and payment</Title>
            <Text size="xs" c="dimmed" mb="md">Rate, payment mode and the accounts this receipt posts to.</Text>
            <Grid>
          {/* Rate/Document Date have no UtlDocDsgrFlds row for DocID 1263 (confirmed via live audit) — plain static labels are correct, nothing to wire. */}
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <NumberInput label="Rate" required value={form.rate} onChange={(v) => set('rate', v)} onBlur={() => touch('rate')} decimalScale={2} min={0.01} allowNegative={false} hideControls placeholder="0.00" error={err('rate')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <Select
              label={caption('PAYMENT', 'Payment Mode')}
              required
              data={listToOptions(paymentList)}
              value={form.payment_mode || null}
              onChange={onPaymentChange}
              allowDeselect={false}
              error={err('payment_mode')}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <DateInput label="Document Date" required valueFormat="DD/MM/YYYY" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <TimeInput
              label={caption('RMKS', 'Seva Timing')}
              required={mandatory('RMKS')}
              value={form.timing_text}
              onChange={(e) => set('timing_text', e.currentTarget.value)}
              description={form.timing_text ? `Prints as ${formatTiming(form.timing_text)}` : undefined}
            />
          </Grid.Col>
          {!hidden('ADDRES') && (
            <Grid.Col span={{ base: 12, xl: 8 }}>
              <TextInput
                label={caption('ADDRES', 'Address')}
                required={mandatory('ADDRES')}
                value={form.address}
                onChange={(e) => set('address', e.currentTarget.value)}
              />
            </Grid.Col>
          )}
          <Grid.Col span={12}>
            <Group gap="sm" align="flex-end" wrap="wrap">
              <Button variant="light" color="kumkum" leftSection={<Users size={16} />} onClick={() => setGroupOpen(true)}>
                Group Seva
              </Button>
              <Button variant="light" color="kumkum" leftSection={<Search size={16} />} onClick={() => setPickOpen(true)}>
                Select Sevakartharu
              </Button>
              <NumberInput aria-label="Number of records" placeholder="Nos" w={80} min={0} hideControls value={pickLimit} onChange={setPickLimit} />
              <Text size="xs" c="dimmed">
                F6 loads the last entry
              </Text>
            </Group>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Stack gap={6}>
              <TextInput label="Address" value={form.add1} maxLength={250} onChange={(e) => set('add1', e.currentTarget.value)} />
              <TextInput aria-label="Address line 2" value={form.add2} maxLength={250} onChange={(e) => set('add2', e.currentTarget.value)} />
              <TextInput aria-label="Address line 3" value={form.add3} maxLength={250} onChange={(e) => set('add3', e.currentTarget.value)} />
              <TextInput aria-label="Address line 4" value={form.add4} maxLength={250} onChange={(e) => set('add4', e.currentTarget.value)} />
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Mobile No" inputMode="numeric" maxLength={12} value={form.mobile_no} onChange={(e) => set('mobile_no', e.currentTarget.value.replace(/\D/g, ''))} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Group gap="xl">
              <Checkbox
                label="Regular Devotee"
                checked={form.is_regular}
                onChange={(e) => set('is_regular', e.currentTarget.checked)}
              />
              {/* Prasada is FLdBlnHide='Y'/ReadOnly='Y' on this screen — set
                  via Admin Master > Bulk Update instead, not entered here. */}
            </Group>
          </Grid.Col>
          {!hidden('REFNO') && (
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label={caption('REFNO', 'Reference No')}
                required={mandatory('REFNO')}
                value={form.reference_no}
                onChange={(e) => set('reference_no', e.currentTarget.value)}
                onBlur={() => touch('reference_no')}
                error={err('reference_no')}
              />
            </Grid.Col>
          )}
          {(!hidden('BANKNAME') || !hidden('CHQNO') || !hidden('CHQDATE')) && (
            <>
              {!hidden('BANKNAME') && (
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <Select
                    label={caption('BANKNAME', 'Bank Name')}
                    required={mandatory('BANKNAME')}
                    data={BANK_NAMES}
                    value={form.bank_name}
                    onChange={(v) => set('bank_name', v)}
                  />
                </Grid.Col>
              )}
              {!hidden('CHQNO') && (
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput
                    label={caption('CHQNO', 'Cheque No')}
                    required={mandatory('CHQNO')}
                    value={form.cheque_no}
                    onChange={(e) => set('cheque_no', e.currentTarget.value)}
                  />
                </Grid.Col>
              )}
              {!hidden('CHQDATE') && (
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput
                    label={caption('CHQDATE', 'Cheque Date')}
                    required={mandatory('CHQDATE')}
                    valueFormat="DD/MM/YYYY"
                    value={form.cheque_date}
                    onChange={(v) => set('cheque_date', v)}
                  />
                </Grid.Col>
              )}
            </>
          )}
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <LookupSelect docId={DOC_ID} field="LEDGER" label={caption('LEDGER', 'Income Ledger')} required={mandatory('LEDGER')} value={form.ledger_id} onChange={(v) => { set('ledger_id', v); touch('ledger_id') }} error={err('ledger_id')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <LookupSelect docId={DOC_ID} field="LEDID" label={caption('LEDID', 'Cash / Bank Account')} required={mandatory('LEDID')} value={form.cash_bank_ledger_id} onChange={(v) => { set('cash_bank_ledger_id', v); touch('cash_bank_ledger_id') }} error={err('cash_bank_ledger_id')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Select
              label={caption('VCHTYP', 'Voucher Type')}
              required
              description={`Follows the payment mode: ${titleCase(form.payment_mode) || '-'} posts to ${allowedVouchers.map(titleCase).join(' or ')}`}
              data={listToOptions(allowedVouchers)}
              value={form.voucher_type || null}
              onChange={(v) => set('voucher_type', v || '')}
              allowDeselect={false}
              error={err('voucher_type')}
            />
          </Grid.Col>
          {/* Any field a Designer edit adds later that this screen doesn't
              already know about — renders itself automatically. */}
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
          </Card>

          <Card withBorder p="lg">
            <Group justify="space-between" align="flex-end" mb="md" wrap="wrap">
              <div>
                <Title order={4} mb={2}>Seva dates</Title>
                <Text size="xs" c="dimmed">Add every date this seva will be performed. The total is rate x number of dates.</Text>
              </div>
              <Group align="flex-end" gap="xs">
                <DateInput label="Add date" valueFormat="DD/MM/YYYY" value={newDate} onChange={(v) => { setNewDate(v); setDateError('') }} w={170} error={dateError || undefined} description={newDate && dayjs(newDate).isBefore(dayjs(), 'day') ? 'This date is in the past' : undefined} />
                <Button leftSection={<Plus size={16} />} onClick={addDate} variant="light" color="kumkum">
                  Add
                </Button>
              </Group>
            </Group>
            {dates.length === 0 ? (
              <EmptyState icon={CalendarPlus} title="No dates added yet" hint="Pick a date above and press Add. At least one date is required to save." />
            ) : (
              <Table.ScrollContainer minWidth={320}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={130}>Date</Table.Th>
                      <Table.Th>Remarks</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {dates.map((d, i) => (
                      <Table.Tr key={d.perform_date}>
                        <Table.Td className="vt-num">{dayjs(d.perform_date).format('DD/MM/YYYY')}</Table.Td>
                        <Table.Td>
                          <TextInput
                            aria-label={`Remarks for ${dayjs(d.perform_date).format('DD/MM/YYYY')}`}
                            placeholder="Remarks for this date"
                            size="xs"
                            value={d.remarks}
                            onChange={(e) => setDates((ds) => ds.map((x, xi) => (xi === i ? { ...x, remarks: e.currentTarget.value } : x)))}
                          />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove ${dayjs(d.perform_date).format('DD/MM/YYYY')}`}
                            onClick={async () => { if (await confirm({ title: 'Remove this seva date?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) removeDate(i) }}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            {err('dates') && dates.length === 0 && (
              <Text size="sm" c="red" mt="xs" role="alert">{errors.dates}</Text>
            )}
          </Card>
        </Stack>
          </>
        }
        side={
          <>
        <SummaryCard
          rows={[
            { label: 'Rate', value: formatINR(form.rate) },
            { label: 'Dates', value: dates.length },
            { label: 'Payment', value: form.payment_mode ? titleCase(form.payment_mode) : 'Not selected' },
            { label: 'Posts to', value: form.voucher_type || 'Not selected' },
          ]}
          total={formatINR(totalAmt)}
          words={totalAmt}
          warning={firstError || null}
          saving={saving}
          saveDisabled={!canSave || Boolean(viewId)}
          onSave={() => onSave('save')}
          onSavePrint={() => onSave('print')}
        />
        {lastSaved && (
          <SavedPanel lines={[`Seva ${lastSaved.seva_no}`, `Receipt ${lastSaved.receipt_no}`]} onPrint={() => setPrintFor(lastSaved.seva_id)} />
        )}
        <RecentCard
          title="Recent sevas"
          icon={Receipt}
          loading={recentLoading}
          rows={recent || []}
          emptyTitle="No sevas yet"
          emptyHint="Saved bookings will be listed here."
          renderRow={(s) => ({
            key: s.SEVAID,
            title: s.PrintSEVANO,
            subtitle: `${s.KNAME} \u00b7 ${formatINR(s.TotalAmt)}`,
            printLabel: `Print ${s.PrintSEVANO}`,
            onPrint: () => setPrintFor(s.SEVAID),
          })}
        />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} search={findSevas} />
      <GroupSevaModal opened={groupOpen} onClose={() => setGroupOpen(false)} form={form} dates={dates} onDone={() => { refetch(); setDates([]) }} />
      <SevakartharuModal opened={pickOpen} onClose={() => setPickOpen(false)} onPick={applyDevotee} initialName={form.name} limit={Number(pickLimit) || 0} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Seva Receipt" />
    </Stack>
  )
}
