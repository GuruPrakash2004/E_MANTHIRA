import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import SevakartharuModal from './SevakartharuModal'
import GroupSevaModal from './GroupSevaModal'
import DocNavBar from '../../components/ui/DocNavBar'
import { Badge, Button, Card, Checkbox, Group, NumberInput, Stack, Table, Text, TextInput, Title, ActionIcon } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Trash2, Search, Receipt, CalendarPlus, CalendarRange, Users, Copy } from 'lucide-react'
import dayjs from 'dayjs'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as sevaApi from '../../api/endpoints/seva'
import * as mastersApi from '../../api/endpoints/masters'
import useDirectPrint from '../../hooks/useDirectPrint'
import ExtraSevas from './ExtraSevas'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave, loadFormats, pickFormat, printErrorMessage, printNow, rememberFormat } from '../../lib/printing'
import SplitPaymentPanel, { refRequiredModes, splitError, splitFromSaved, splitPayload } from '../../components/ui/SplitPaymentPanel'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import CopyFromDialog from '../../components/ui/CopyFromDialog'
import useDocRules from '../../hooks/useDocRules'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import EmptyState from '../../components/ui/EmptyState'
import { EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import usePanchangaMonth from '../panchanga/usePanchangaMonth'
import SevaDatesDialog from './SevaDatesDialog'
import { useAuth } from '../../hooks/useAuth'
import useBillAlertify from '../alertify/useBillAlertify'

const DOC_ID = 1263
// the single-payment fields: with a split bill the main part supplies them, so they are not shown
const SPLIT_PAY_CODES = ['PAYMENT', 'LEDID', 'VCHTYP', 'REFNO', 'CHQNO', 'CHQDATE', 'BANKNAME']
// Domain cheat-sheet (CLAUDE.md §6): 1265 = Seva master. Only used to show the rate the server will charge (MstSVA.AMT).
const SEVA_MASTER_DOC_ID = 1265
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

// Devotee details copied from an earlier seva / regular devotee. Keyed by FldCode (== TrnHdrSEVA column);
// a code the temple's Designer does not have is simply not shown, and the server ignores it.
const DEVOTEE_CODES = ['KNAME', 'NAMEINKAN', 'GOTHRAID', 'NAKSHATRAID', 'RASHIID', 'SECKNAME', 'SECNAKSHATRAID', 'SECRASHIID']
// Cleared after each save so the next devotee starts fresh (the rest — sannidhi, payment mode — carries over).
// The nakshatra, gothra and rashi are read together, so they share one row of the form.
const ROW_GROUPS = [['GOTHRAID', 'NAKSHATRAID', 'RASHIID']]
// A new entry starts with today as its seva date (the user can change or remove it).
const todayDates = () => [{ perform_date: isoDate(new Date()), remarks: '' }]
const errorText = (err, fallback) => {
  const d = err?.response?.data?.detail
  if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join('; ')
  return d || fallback
}

export default function SevaEntryPage() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Every Designer field lives here keyed by its FldCode; the form is rendered from UtlDocDsgrFlds (DocFieldsForm).
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [docDate, setDocDate] = useState(new Date())
  const [rate, setRate] = useState(0) // the Seva master's amount
  const [amountEdit, setAmountEdit] = useState(null) // the Amount box when typed: { svaid, days, rate, value }; it stops applying as soon as the Seva, the number of dates or the Rate change (legacy recalculates)
  const [rateEdit, setRateEdit] = useState({ svaid: 0, value: '' }) // the Rate box when the counter changed it (open-rate sevas have a master amount of 0); only valid for the Seva it was typed for
  const [attempted, setAttempted] = useState(false)
  const [dates, setDates] = useState([]) // empty until New (todayDates)
  // false = the dates are just today's (nothing chosen yet): the grid stays hidden. True once Dates selection, a saved bill or Copy From supplied dates.
  const [datesPicked, setDatesPicked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [extraSevas, setExtraSevas] = useState([]) // more sevas for this devotee: [{ id, label, rate }], each saved as its own bill
  const [batch, setBatch] = useState([]) // the bills of the last multi-seva save
  const [pickOpen, setPickOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [viewId, setViewId] = useState(null) // a saved seva being looked at (read-only until Edit is pressed)
  const [editing, setEditing] = useState(false)
  const [rangeOpen, setRangeOpen] = useState(false) // the Dates Selection dialog
  const [daysText, setDaysText] = useState('') // its Date Text (TrnHdrSEVA.DaysPrintText), kept only while the dates are the ones it was made for
  const [daysTextFor, setDaysTextFor] = useState('')
  const [viewMonth, setViewMonth] = useState(new Date())
  const [viewNo, setViewNo] = useState('')
  const [printFor, setPrintFor] = useState(null)
  const [printOption, setPrintOption] = useState(null) // the Options-menu format the preview should open on (null = the user's last / the default)
  const [regular, setRegular] = useState(false) // legacy "Regular Devotee" tick (TrnHdrSEVA.RegularD)
  const rules = useDocRules(DOC_ID)
  const [stamp, setStamp] = useState(null) // legacy CANCELLED / AUTHORISED labels of the record being viewed

  const [idle, setIdle] = useState(true) // the screen opens empty and locked (also after Cancel) until New is pressed
  const readOnly = (Boolean(viewId) && !editing) || idle
  const { user } = useAuth()
  const { fields } = useDocFields(DOC_ID)
  const panchanga = usePanchangaMonth(viewMonth)
  // the calendars report the month they show; only a different month is news (a new Date object every time would re-render forever)
  const changeMonth = (d) => setViewMonth((cur) => (d && !dayjs(cur).isSame(d, 'month') ? d : cur))

  const has = (code) => fields.some((f) => f.FldCode === code && !isFieldHidden(f, values))
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))

  // The Designer's own mandatory rules, evaluated against what is on screen.
  const errors = docFieldErrors(fields, values)
  if (has('KNAME') && !String(values.KNAME || '').trim()) errors.KNAME = errors.KNAME || 'Name should not be blank'
  const extraBad = extraSevas.find((s) => !(s.rate > 0))
  const firstError = Object.values(errors)[0] || (dates.length === 0 ? 'Add at least one seva date' : null) || (extraBad ? `${extraBad.label}: ${extraBad.rate === null ? 'the rate is still loading' : 'no rate is set for this seva'}` : null)
  const canSave = !firstError
  const shownErrors = attempted ? errors : {}

  // The bill no the next save will get, shown while the form is being filled (nothing is reserved; the save returns the real one).
  const { data: nextNo } = useQuery({
    queryKey: ['seva-next-no', values.SANNIDHIID || 0],
    queryFn: () => sevaApi.nextSevaNo(values.SANNIDHIID),
    enabled: !viewId && Boolean(values.SANNIDHIID),
    staleTime: 0,
  })

  const { data: recent, refetch, isLoading: recentLoading } = useQuery({
    queryKey: ['sevas', 'recent'],
    queryFn: () => sevaApi.listSevas(historyParams()),
  })

  const extraRate = extraSevas.reduce((n, s) => n + (Number(s.rate) || 0), 0)
  const effRate = rateEdit.svaid === Number(values.SVAID) && Number(rateEdit.value) > 0 ? Number(rateEdit.value) : Number(rate) || 0
  const amountTyped = Boolean(amountEdit) && amountEdit.svaid === Number(values.SVAID) && amountEdit.days === dates.length && amountEdit.rate === effRate && Number(amountEdit.value) > 0
  const mainAmount = amountTyped ? Number(amountEdit.value) : effRate * dates.length
  const totalAmt = mainAmount + extraRate * dates.length
  // Split payment: the bill paid in parts by different modes (WebSplitPayment). The header mirrors the main part.
  const [splitOn, setSplitOn] = useState(false)
  const [splitParts, setSplitParts] = useState([])
  const refModes = refRequiredModes(fields, 'PAYMENT')
  const splitErr = splitError(splitOn, splitParts, totalAmt, refModes)
  const alertify = useBillAlertify({
    docId: DOC_ID, label: 'Seva', user: user?.user_code, fields, values, savedNo: viewId ? viewNo : '',
    totals: [{ caption: 'Doc Date', value: dayjs(docDate).format('DD/MM/YYYY') }, { caption: 'Total Amount', value: formatINR(totalAmt) }, { caption: 'Net Amount', value: formatINR(totalAmt) }, { caption: 'Seva Dates', value: dates.map((d) => dayjs(d.perform_date).format('DD/MM/YYYY')).join(', ') }, { caption: 'Number of Dates', value: String(dates.length) }],
    anchors: dates.map((d) => d.perform_date), timingCaption: /timing/i, defaultDir: 'before', valid: canSave && !splitErr, hint: splitErr || firstError || 'Fill the bill details first',
  })

  // The rate is the Seva master's amount (the server charges the same); shown in the summary only.
  useEffect(() => {
    if (!values.SVAID) {
      setRate(0)
      return
    }
    let live = true
    mastersApi
      .getMasterRow(SEVA_MASTER_DOC_ID, values.SVAID)
      .then((row) => live && setRate(Number(row?.AMT) || 0))
      .catch(() => live && setRate(0))
    return () => {
      live = false
    }
  }, [values.SVAID])

  async function onBlurField(code) {
    if (code !== 'MOBNUM') return
    const mobile = String(values.MOBNUM || '')
    if (mobile.length !== 10) return
    try {
      const devotee = await sevaApi.lookupDevotee(mobile)
      if (devotee) {
        // Port of legacy SevaDetails() auto-fill — pulls the devotee fields from the last non-cancelled seva.
        setValues((cur) => ({ ...cur, ...Object.fromEntries(DEVOTEE_CODES.map((c) => [c, devotee[c] ?? ''])) }))
        notifications.show({ message: `Found: ${devotee.KNAME}`, color: 'teal' })
      }
    } catch {
      /* no previous devotee found — fine, first-time visitor */
    }
  }

  // the Dates Selection dialog hands back the whole list and its Date Text
  function applyDatesDialog({ dates: picked, daysText: text }) {
    setDates(picked)
    setDatesPicked(true)
    setDaysText(text)
    setDaysTextFor(JSON.stringify(picked.map((d) => d.perform_date)))
    notifications.show({ message: `${picked.length} date${picked.length === 1 ? '' : 's'} selected`, color: 'teal' })
  }

  // Change one performance date in place (keeps the list sorted and free of duplicates).
  function changeDate(idx, value) {
    if (!value) return
    const iso = isoDate(value)
    if (dates.some((d, i) => i !== idx && d.perform_date === iso)) return notifications.show({ message: `${dayjs(iso).format('DD-MMM-YYYY')} is already added`, color: 'red' })
    setDates((ds) => ds.map((x, i) => (i === idx ? { ...x, perform_date: iso } : x)).sort((a, b) => a.perform_date.localeCompare(b.perform_date)))
  }

  // Any row can be removed, the first included. Taking out the last one puts the bill back on today (nothing chosen, grid hidden).
  function removeDate(idx) {
    const left = dates.filter((_, i) => i !== idx)
    if (left.length === 0) {
      setDates(todayDates())
      setDatesPicked(false)
      setDaysText('')
      setDaysTextFor('')
      return
    }
    setDates(left)
  }

  // Select Sevakartharu: copy the chosen regular devotee's details into this entry (legacy fillSevaDetails)
  function applyDevotee(r) {
    setValues((cur) => ({ ...cur, ...Object.fromEntries(DEVOTEE_CODES.map((c) => [c, r[c] ?? cur[c] ?? ''])) }))
    setPickOpen(false)
  }

  // Map a saved TrnHdrSEVA row (+ its dates) into the entry: its columns are the Designer FldCodes
  function fillFromSeva(l, { withDates = false } = {}) {
    const next = {}
    for (const f of fields) {
      if (['ISSUEDBY', 'GRPSEVAID'].includes(f.FldCode)) continue
      const v = l[f.FldCode]
      if (v === null || v === undefined) next[f.FldCode] = ''
      else if (f.FldDataType === 'Date') next[f.FldCode] = new Date(v)
      else if (f.FldBlnComboData === 'Y') next[f.FldCode] = Number(v) || ''
      else next[f.FldCode] = String(v).trim()
    }
    setValues(next)
    setRegular(String(l.RegularD || 'N').trim().toUpperCase() === 'Y')
    setRateEdit({ svaid: Number(l.SVAID) || 0, value: l.SevaRate != null ? String(l.SevaRate) : '' })
    setAmountEdit({ svaid: Number(l.SVAID) || 0, days: (l.dates || []).length || 1, rate: Number(l.SevaRate) || 0, value: l.TotalAmt != null ? String(l.TotalAmt) : '' })
    if (withDates) {
      const yes = (v) => String(v || 'N').trim().toUpperCase() === 'Y'
      setStamp(yes(l.Cancelled) ? { text: 'CANCELLED', color: 'red' } : l.auth_req ? (yes(l.Authorised) ? { text: 'AUTHORISED', color: 'green' } : { text: 'NOT AUTHORISED', color: 'orange' }) : null)
      if (l.SEVADate) setDocDate(new Date(l.SEVADate))
      const loaded = (l.dates || []).map((d) => ({ perform_date: dayjs(d.PDate).format('YYYY-MM-DD'), remarks: d.PRemarks || '' }))
      setDates(loaded)
      setDatesPicked(true)
      setDaysText(String(l.DaysPrintText || '').trim())
      setDaysTextFor(JSON.stringify(loaded.map((d) => d.perform_date)))
    }
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
      setSplitParts(splitFromSaved(l.split_payments))
      setSplitOn((l.split_payments || []).length > 1)
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(l.PrintSEVANO || l.SEVANO)
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not open that record'), color: 'red' })
    }
  }
  function startNew() {
    setIdle(false)
    setViewId(null)
    setEditing(false)
    setSplitOn(false)
    setSplitParts([])
    setViewNo('')
    setDates(todayDates())
    setDatesPicked(false)
    setDaysText('')
    setDaysTextFor('')
    setAttempted(false)
    // legacy AddProc: clearFlds() blanks every field, then only the Designer defaults are applied (resetKey below);
    // the one value carried over is the Sannidhi
    setValues((cur) => (cur.SANNIDHIID ? { SANNIDHIID: cur.SANNIDHIID } : {}))
    setExtraSevas([])
    setBatch([])
    setRegular(false)
    setRateEdit({ svaid: 0, value: '' })
    setAmountEdit(null)
    setStamp(null)
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setDocDate(new Date())
  }
  // Cancel a new entry: back to the last saved bill when there is one, else a fully blank form
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    // clear everything (Sannidhi included) and show an empty, locked form with only New in the ribbon
    setViewId(null)
    setEditing(false)
    setSplitOn(false)
    setSplitParts([])
    setViewNo('')
    setDates([])
    setDatesPicked(false)
    setDaysText('')
    setDaysTextFor('')
    setAttempted(false)
    setValues({}) // no resetKey bump here: the Designer defaults come back only when New is pressed
    setExtraSevas([])
    setBatch([])
    setLastSaved(null)
    setRegular(false)
    setRateEdit({ svaid: 0, value: '' })
    setAmountEdit(null)
    setStamp(null)
    setIdle(true)
  }
  async function deleteSeva() {
    if (!(await confirm({ title: 'Delete this seva?', message: `Seva ${viewNo} and its receipt will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await sevaApi.deleteSeva(viewId)
      notifications.show({ message: r?.message || 'Deleted Seva Entry Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['sevas'] })
      queryClient.invalidateQueries({ queryKey: ['seva-next-no'] })
      refetch()
      setLastSaved(null)
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
      setValues({})
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not delete the seva'), color: 'red' })
    }
  }
  async function startEdit() {
    // the screen must show what is saved right now, not what was loaded a while ago
    await viewRecord(viewId)
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function findSevas(q) {
    const rows = await sevaApi.listSevas({ search: q, top: 30, days: 0 })
    return rows.map((r) => ({ id: r.SEVAID, label: r.PrintSEVANO || r.SEVANO, sub: `${r.KNAME || ''} ${r.MOBNUM || ''}`.trim() }))
  }
  // Copy From (shown only when UtlTransactions.AllowCopyFrom = 'Y'): the chosen saved seva's details and dates become a new entry
  async function copyFrom(id) {
    try {
      const l = await sevaApi.getSeva(id)
      fillFromSeva(l)
      setDates((l.dates || []).map((d) => ({ perform_date: dayjs(d.PDate).format('YYYY-MM-DD'), remarks: d.PRemarks || '' })))
      setDatesPicked(true)
      notifications.show({ message: `Copied from ${l.PrintSEVANO || l.SEVANO}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not copy that document'), color: 'red' })
    }
  }
  useHotkeys('f6', (e) => { e.preventDefault(); if (!viewId) loadLastEntry() }, { enableOnFormTags: true }, [viewId])

  // What goes to the server: the Designer fields that have a value (dates as YYYY-MM-DD).
  function fieldsPayload() {
    return Object.fromEntries(
      Object.entries(values)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
    )
  }

  async function onSave(mode) {
    setAttempted(true)
    if (splitErr || firstError) {
      // an alert, not small print by the Save button; the cursor goes to the first field that needs attention
      notifications.show({ title: 'Cannot save yet', message: splitErr || firstError, color: 'red' })
      setTimeout(() => document.querySelector('.vt-entry-main [aria-invalid="true"]')?.focus(), 80)
      return
    }
    setSaving(true)
    try {
      const body = { fields: fieldsPayload(), dates, doc_date: isoDate(docDate), regular, ...(effRate > 0 ? { rate: effRate } : {}), ...(amountTyped ? { amount: mainAmount } : {}), days_text: daysTextFor === JSON.stringify(dates.map((d) => d.perform_date)) ? daysText : '', ...(!editing && extraSevas.length ? { extra_seva_ids: extraSevas.map((s) => s.id) } : {}), ...(splitOn ? { split_payments: splitPayload(splitParts) } : {}) }
      if (editing && viewId) {
        const done = await sevaApi.updateSeva(viewId, body)
        setLastSaved(done)
        notifications.show({ message: 'Changes saved successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['sevas'] })
        refetch()
        await viewRecord(viewId)
        if (mode === 'print') directPrint(viewId)
        return
      }
      const res = await sevaApi.createSeva(body)
      const bills = res.bills || null // several sevas: one bill each
      const result = bills ? bills[bills.length - 1] : res
      alertify.afterSave({ 'Doc No': (bills ? bills[0] : res).seva_no }) // the Alertify reminder asked for before saving; it never blocks the bill
      setLastSaved(result)
      setBatch(bills || [])
      // One Save: what happens next (print with a prompt, print straight away, or nothing) is the print option's After Save setting
      if (bills) {
        // one print dialog cannot serve several bills: print each (silently when a print agent is set up), else use the panel's Print buttons
        if (mode === 'print') for (const b of bills) await directPrint(b.seva_id)
        else if (mode === 'auto') bills.forEach((b, i) => handleAfterSave({ docId: DOC_ID, recordId: b.seva_id, openDialog: i === bills.length - 1 ? setPrintFor : () => {} }))
      } else if (mode === 'print') directPrint(result.seva_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.seva_id, openDialog: setPrintFor })
      notifications.show({ message: bills ? `${bills.length} sevas saved successfully!` : 'Data saved successfully!', color: 'teal' })
      setExtraSevas([])
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['sevas'] })
      queryClient.invalidateQueries({ queryKey: ['seva-next-no'] })
      refetch()
      // the saved bill stays on screen (read-only) so it can be checked before printing; New starts the next one
      await viewRecord(result.seva_id)
    } catch (err) {
      notifications.show({ title: 'Save failed', message: errorText(err, 'Save failed'), color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)

  // The Options drop-down lists this screen's print formats (UtlOption); each one acts on its own Print Click, like the legacy ribbon:
  // D = print straight away, anything else = open the preview / print window on that format.
  const { data: printFormats = [] } = useQuery({ queryKey: ['print-formats', DOC_ID], queryFn: () => loadFormats(DOC_ID), staleTime: 60_000 })
  async function printWithFormat(format) {
    if (!viewId) return notifications.show({ message: 'Open a saved seva first (Find, List or the arrows), then choose a print option', color: 'yellow' })
    setPrintOption(format?.option_name || null) // the preview window opens on the very format that was clicked (3 Inch, A4, ...)
    if (!format) return setPrintFor(viewId)
    try {
      await rememberFormat(DOC_ID, format.option_name)
      // keep the cached list in step with the saved choice, so the ribbon's Print button and the next preview start on it too
      queryClient.setQueryData(['print-formats', DOC_ID], (list) => (Array.isArray(list) ? list.map((f) => ({ ...f, selected: f.option_name === format.option_name, preferred: f.option_name === format.option_name })) : list))
      if (String(format.click_operation || '').toUpperCase() === 'D' && format.available) {
        notifications.show({ message: await printNow({ docId: DOC_ID, recordId: viewId, format }), color: 'teal' })
      } else setPrintFor(viewId)
    } catch (err) {
      notifications.show({ title: 'Could not print', message: await printErrorMessage(err), color: 'red' })
      setPrintFor(viewId)
    }
  }
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave('auto'),
    onNew: () => (viewId || idle) && startNew(),
    onEdit: () => viewId && !editing && startEdit(),
    onPrint: () => lastSaved && setPrintFor(lastSaved.seva_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : !idle && onSave('auto')),
  })

  // a small panchanga marker on the calendar days that have an event
  function renderPanchangaDay(date) {
    const ev = panchanga[isoDate(date)]
    return (
      <div title={ev?.name} style={{ position: 'relative' }}>
        {date.getDate()}
        {ev && <span aria-hidden style={{ position: 'absolute', left: '50%', bottom: -4, width: 5, height: 5, borderRadius: '50%', background: 'var(--mantine-color-gold-5)', transform: 'translateX(-50%)' }} />}
      </div>
    )
  }

  const paymentLabel = has('PAYMENT') && values.PAYMENT ? String(values.PAYMENT) : null

  return (
    <Stack gap="lg" className="vt-rise">
      {/* Page header */}
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Group gap="sm" align="center">
              <Title order={2}>Seva Entry</Title>
              {viewId && stamp && <Badge color={stamp.color} variant="light" size="lg">{stamp.text}</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              Record a devotee's seva booking and print the receipt
            </Text>
          </div>
        </Group>
        {/* the cursor starts in the first form field, not on the document date (data-no-autofocus) */}
        <DocNoDate
          docId={DOC_ID}
          queryExtra={String(values.SANNIDHIID || 0)}
          enabled={Boolean(values.SANNIDHIID)}
          fetchNo={() => sevaApi.nextSevaNo(values.SANNIDHIID).then((r) => ({ short_form: 'SEVA', prefix: String(r.seva_no).slice(2, -5), seq: parseInt(String(r.seva_no).slice(-5), 10) || 0, print_no: r.print_no || r.seva_no }))}
          viewNo={viewId ? viewNo : ''}
          date={docDate}
          onDate={setDocDate}
          dateDisabled={readOnly || !rules.edit_doc_date}
        />
      </Group>

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <Card withBorder p="lg">
              {/* Every field below is drawn from this temple's Doc Designer (UtlDocDsgrFlds) — nothing is fixed in the screen. */}
              <DocFieldsForm
                docId={DOC_ID}
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                seedDefaults={!idle}
                errors={shownErrors}
                readOnly={readOnly}
                onBlurField={onBlurField}
                rowGroups={ROW_GROUPS}
                skip={splitOn ? SPLIT_PAY_CODES : undefined}
              />
              <SplitPaymentPanel
                docType="SEVA"
                docId={DOC_ID}
                enabled={splitOn}
                setEnabled={setSplitOn}
                parts={splitParts}
                setParts={setSplitParts}
                total={totalAmt}
                readOnly={readOnly}
                refModes={refModes}
                onMain={(m) => setValues((cur) => ({ ...cur, PAYMENT: m.mode, LEDID: m.led_id, REFNO: m.ref_no || '', ...(String(m.mode).toUpperCase() === 'CHEQUE' ? { CHQNO: m.ref_no || '', CHQDATE: m.chq_date || '', BANKNAME: m.bank_name || '' } : {}) }))}
              />
              <Checkbox mt="md" label="Regular Devotee" color="kumkum" styles={{ input: { border: '2px solid var(--vt-badge-ink)', cursor: 'pointer' }, label: { fontWeight: 600, cursor: 'pointer' } }} checked={regular} disabled={readOnly} onChange={(e) => setRegular(e.currentTarget.checked)} />
              {!viewId && (
                <Group gap="sm" align="flex-end" wrap="wrap" mt="md">
                  <Button variant="light" color="kumkum" leftSection={<Users size={16} />} onClick={() => setGroupOpen(true)}>
                    Group Seva
                  </Button>
                  <Button variant="light" color="kumkum" leftSection={<Search size={16} />} onClick={() => setPickOpen(true)}>
                    Select Sevakartharu
                  </Button>
                  {rules.allow_copy_from && (
                    <Button variant="light" color="kumkum" leftSection={<Copy size={16} />} onClick={() => setCopyOpen(true)}>
                      Copy From
                    </Button>
                  )}
                  <Text size="xs" c="dimmed">
                    F6 loads the last entry
                  </Text>
                </Group>
              )}
            </Card>

            {!viewId && values.SVAID && (
              <ExtraSevas docId={DOC_ID} sevaMasterDocId={SEVA_MASTER_DOC_ID} mainId={values.SVAID} ctx={values} value={extraSevas} onChange={setExtraSevas} />
            )}

            <Card withBorder p="lg">
              <Group justify="space-between" align="flex-end" mb="md" wrap="wrap">
                <div>
                  <Title order={4} mb={2}>Seva dates</Title>
                  <Text size="xs" c="dimmed">Today is used unless you choose dates with Dates selection. The total is the Seva's rate x number of dates.</Text>
                </div>
                {!readOnly && (
                  <Group align="flex-end" gap="xs">
                    {values.SVAID && (
                      <NumberInput
                        label="Rate"
                        w={130}
                        min={0}
                        decimalScale={2}
                        hideControls
                        value={effRate || ''}
                        onChange={(v) => setRateEdit({ svaid: Number(values.SVAID), value: v === '' ? '' : String(v) })}
                        description={Number(rate) > 0 ? `Seva price ${formatINR(rate)}` : 'Open rate: enter the amount'}
                        error={effRate > 0 && effRate * Math.max(dates.length, 1) < Number(rate) ? 'Below the Seva price' : undefined}
                      />
                    )}
                    {values.SVAID && (
                      <NumberInput
                        label="Amount"
                        w={130}
                        min={0}
                        decimalScale={2}
                        hideControls
                        value={mainAmount || ''}
                        onChange={(v) => setAmountEdit({ svaid: Number(values.SVAID), days: dates.length, rate: effRate, value: v === '' ? '' : String(v) })}
                        description={`${dates.length} date${dates.length === 1 ? '' : 's'} x rate`}
                        error={mainAmount > 0 && mainAmount < Number(rate) ? 'Below the Seva price' : undefined}
                      />
                    )}
                    <Button leftSection={<CalendarRange size={16} />} variant="light" color="kumkum" onClick={() => setRangeOpen(true)} title="Dates Selection">
                      Dates selection
                    </Button>
                  </Group>
                )}
              </Group>
              {dates.length === 0 ? (
                <EmptyState icon={CalendarPlus} title="No dates yet" hint="Press Dates selection to choose them; if you pick none, today is used." />
              ) : !datesPicked && !readOnly ? (
                // nothing chosen: the bill is for today, so there is no grid to show
                <Group gap="sm" align="center">
                  <Badge size="lg" variant="light" color="gold" tt="none" leftSection={<CalendarPlus size={14} />}>
                    Seva date: {dayjs(dates[0].perform_date).format('DD-MMM-YYYY')}{dayjs(dates[0].perform_date).isSame(dayjs(), 'day') ? ' (today)' : ''}
                  </Badge>
                  {panchanga[dates[0].perform_date] && <Badge size="sm" variant="light" color="gold" tt="none">{panchanga[dates[0].perform_date].name}</Badge>}
                  <Text size="xs" c="dimmed">Use Dates selection to perform this seva on other dates.</Text>
                </Group>
              ) : (
                <Table.ScrollContainer minWidth={320}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={150}>Date</Table.Th>
                        <Table.Th>Remarks</Table.Th>
                        <Table.Th w={48} aria-label="Remove" />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {dates.map((d, i) => (
                        <Table.Tr key={d.perform_date}>
                          <Table.Td className="vt-num">
                            {readOnly ? dayjs(d.perform_date).format('DD-MMM-YYYY') : (
                              <DateInput aria-label={`Seva date ${i + 1}`} size="xs" valueFormat="DD-MMM-YYYY" value={dayjs(d.perform_date).toDate()} onChange={(v) => changeDate(i, v)} onDateChange={changeMonth} renderDay={renderPanchangaDay} />
                            )}
                            {panchanga[d.perform_date] && <Badge size="xs" variant="light" color="gold" mt={4} tt="none">{panchanga[d.perform_date].name}</Badge>}
                          </Table.Td>
                          <Table.Td>
                            <TextInput
                              aria-label={`Remarks for ${dayjs(d.perform_date).format('DD-MMM-YYYY')}`}
                              size="xs"
                              disabled={readOnly}
                              value={d.remarks}
                              onChange={(e) => setDates((ds) => ds.map((x, xi) => (xi === i ? { ...x, remarks: e.currentTarget.value } : x)))}
                            />
                          </Table.Td>
                          <Table.Td>
                            {!readOnly && (
                              <ActionIcon
                                color="red"
                                variant="subtle"
                                size={36}
                                aria-label={`Remove ${dayjs(d.perform_date).format('DD-MMM-YYYY')}`}
                                onClick={async () => { if (await confirm({ title: 'Remove this seva date?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) removeDate(i) }}
                              >
                                <Trash2 size={16} />
                              </ActionIcon>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: 'Rate', value: formatINR(effRate) },
                { label: 'Dates', value: dates.length },
                ...(!viewId && extraSevas.length ? [{ label: 'Sevas (one bill each)', value: extraSevas.length + 1 }] : []),
                ...(!viewId && nextNo ? [{ label: 'Bill no (on save)', value: nextNo.print_no || nextNo.seva_no }] : []),
                ...(viewId ? [{ label: editing ? 'Editing bill no' : 'Bill no', value: viewNo }] : []),
                ...(paymentLabel ? [{ label: 'Payment', value: paymentLabel }] : []),
              ]}
              total={formatINR(totalAmt)}
              words={totalAmt}
              saving={saving}
              saveDisabled={readOnly}
              onSave={() => onSave('auto')}
              hideActions // Save and Save & Print live in the ribbon below
            />
            {lastSaved && batch.length > 1 ? (
              <SavedPanel
                lines={batch.flatMap((b) => [`${b.seva_name}`, `Seva ${b.seva_no}${b.receipt_no ? ` - Receipt ${b.receipt_no}` : ''}`])}
                extra={batch.map((b) => (
                  <Button key={b.seva_id} fullWidth mt={6} size="xs" variant="light" color="kumkum" onClick={() => setPrintFor(b.seva_id)}>
                    Print {b.seva_no}
                  </Button>
                ))}
              />
            ) : lastSaved && (
              <SavedPanel lines={[`Seva ${lastSaved.seva_no}`, ...(lastSaved.receipt_no ? [`Receipt ${lastSaved.receipt_no}`] : [])]} onPrint={() => setPrintFor(lastSaved.seva_id)} />
            )}
            <RecentCard
              docId={DOC_ID}
              title="Recent sevas"
              icon={Receipt}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No sevas yet"
              emptyHint="Saved bookings will be listed here."
              renderRow={(s) => ({
                key: s.SEVAID,
                title: s.PrintSEVANO,
                subtitle: `${s.KNAME} · ${formatINR(s.TotalAmt)}`,
                printLabel: `Print ${s.PrintSEVANO}`,
                onPrint: () => setPrintFor(s.SEVAID),
              })}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} lastSaved={lastSaved ? { id: lastSaved.seva_id, label: lastSaved.seva_no } : null} onLoad={viewRecord} onNew={startNew} showNew={Boolean(viewId) && !editing} entryMode={!viewId && !idle} newOnly={idle} cancelEditLabel="Cancel" onCancelEntry={cancelEntry} onDelete={deleteSeva} onClose={() => navigate('/')} onEdit={startEdit} onCancelEdit={cancelEdit} onSave={() => onSave('auto')} onPrint={() => printWithFormat(pickFormat(printFormats))} printFormats={printFormats} onPrintFormat={printWithFormat} saving={saving} editing={editing} search={findSevas} alertify={alertify.nav} />
      <SevaDatesDialog opened={rangeOpen} onClose={() => setRangeOpen(false)} dates={dates} dateText={daysTextFor === JSON.stringify(dates.map((d) => d.perform_date)) ? daysText : ''} onApply={applyDatesDialog} />
      <CopyFromDialog opened={copyOpen} onClose={() => setCopyOpen(false)} docName="Seva Entry" search={findSevas} onLoad={copyFrom} />
      {alertify.modal}
      <GroupSevaModal opened={groupOpen} onClose={() => setGroupOpen(false)} fields={fieldsPayload()} docDate={isoDate(docDate)} dates={dates} onDone={() => { refetch(); setDates(todayDates()); setDatesPicked(false) }} />
      <SevakartharuModal opened={pickOpen} onClose={() => setPickOpen(false)} onPick={applyDevotee} initialName={values.KNAME || ''} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); setPrintOption(null) }} docId={DOC_ID} recordId={printFor} title="Seva Receipt" initialOption={printOption} />
    </Stack>
  )
}
