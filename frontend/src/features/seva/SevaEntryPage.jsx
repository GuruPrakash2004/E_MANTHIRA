import { historyParams } from '../../lib/history'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import SevakartharuModal from './SevakartharuModal'
import GroupSevaModal from './GroupSevaModal'
import DocNavBar from '../../components/ui/DocNavBar'
import { Badge, Button, Card, Checkbox, Group, Stack, Table, Text, TextInput, Title, ActionIcon } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Plus, Trash2, Search, Receipt, CalendarPlus, CalendarRange, Landmark, Users, Copy } from 'lucide-react'
import dayjs from 'dayjs'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as sevaApi from '../../api/endpoints/seva'
import * as mastersApi from '../../api/endpoints/masters'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
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
import SannidhiShortlistModal from './SannidhiShortlistModal'
import SevaDatesDialog from './SevaDatesDialog'
import useShortlist from '../../hooks/useShortlist'
import { useAuth } from '../../hooks/useAuth'

const DOC_ID = 1263
// Domain cheat-sheet (CLAUDE.md §6): 1265 = Seva master. Only used to show the rate the server will charge (MstSVA.AMT).
const SEVA_MASTER_DOC_ID = 1265
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

// Devotee details copied from an earlier seva / regular devotee. Keyed by FldCode (== TrnHdrSEVA column);
// a code the temple's Designer does not have is simply not shown, and the server ignores it.
const DEVOTEE_CODES = ['KNAME', 'NAMEINKAN', 'GOTHRAID', 'NAKSHATRAID', 'RASHIID', 'SECKNAME', 'SECNAKSHATRAID', 'SECRASHIID']
// Cleared after each save so the next devotee starts fresh (the rest — sannidhi, payment mode — carries over).
const PER_DEVOTEE_CODES = [...DEVOTEE_CODES, 'MOBNUM', 'RMKS', 'REFNO', 'CHQNO', 'CHQDATE', 'BANKNAME', 'ADDRES']
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
  const queryClient = useQueryClient()
  // Every Designer field lives here keyed by its FldCode; the form is rendered from UtlDocDsgrFlds (DocFieldsForm).
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [docDate, setDocDate] = useState(new Date())
  const [rate, setRate] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const [dateError, setDateError] = useState('')
  const [dates, setDates] = useState(todayDates)
  const [newDate, setNewDate] = useState(new Date())
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
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
  const [regular, setRegular] = useState(false) // legacy "Regular Devotee" tick (TrnHdrSEVA.RegularD)
  const rules = useDocRules(DOC_ID)
  const [stamp, setStamp] = useState(null) // legacy CANCELLED / AUTHORISED labels of the record being viewed

  const readOnly = Boolean(viewId) && !editing
  const { user } = useAuth()
  // the Sannidhis this user works with (chosen in "My Sannidhis"); none chosen = all of them
  const [sannidhis, setSannidhis] = useShortlist('sannidhi', user?.user_code)
  const [shortlistOpen, setShortlistOpen] = useState(false)
  const { fields } = useDocFields(DOC_ID)
  const panchanga = usePanchangaMonth(viewMonth)
  // the calendars report the month they show; only a different month is news (a new Date object every time would re-render forever)
  const changeMonth = (d) => setViewMonth((cur) => (d && !dayjs(cur).isSame(d, 'month') ? d : cur))

  // A new entry starts on the first Sannidhi this user works with (the Designer's default applies when none are chosen).
  useEffect(() => {
    if (viewId || !sannidhis.length) return
    setValues((cur) => (cur.SANNIDHIID ? cur : { ...cur, SANNIDHIID: sannidhis[0] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sannidhis, resetKey, viewId])
  const has = (code) => fields.some((f) => f.FldCode === code && !isFieldHidden(f, values))
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))

  // The Designer's own mandatory rules, evaluated against what is on screen.
  const errors = docFieldErrors(fields, values)
  if (has('KNAME') && !String(values.KNAME || '').trim()) errors.KNAME = errors.KNAME || 'Name should not be blank'
  const firstError = Object.values(errors)[0] || (dates.length === 0 ? 'Add at least one seva date' : null)
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

  const totalAmt = (Number(rate) || 0) * dates.length

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

  function addDate() {
    if (!newDate) {
      setDateError('Pick a date first')
      return
    }
    const iso = isoDate(newDate)
    if (dates.some((d) => d.perform_date === iso)) {
      setDateError(`${dayjs(iso).format('DD-MMM-YYYY')} is already added`)
      return
    }
    setDateError('')
    setDates((d) => [...d, { perform_date: iso, remarks: '' }].sort((a, b) => a.perform_date.localeCompare(b.perform_date)))
  }

  // the Dates Selection dialog hands back the whole list and its Date Text
  function applyDatesDialog({ dates: picked, daysText: text }) {
    setDates(picked)
    setDaysText(text)
    setDaysTextFor(JSON.stringify(picked.map((d) => d.perform_date)))
    setDateError('')
    notifications.show({ message: `${picked.length} date${picked.length === 1 ? '' : 's'} selected`, color: 'teal' })
  }

  // Change one performance date in place (keeps the list sorted and free of duplicates).
  function changeDate(idx, value) {
    if (!value) return
    const iso = isoDate(value)
    if (dates.some((d, i) => i !== idx && d.perform_date === iso)) return notifications.show({ message: `${dayjs(iso).format('DD-MMM-YYYY')} is already added`, color: 'red' })
    setDates((ds) => ds.map((x, i) => (i === idx ? { ...x, perform_date: iso } : x)).sort((a, b) => a.perform_date.localeCompare(b.perform_date)))
  }

  function removeDate(idx) {
    setDates((d) => d.filter((_, i) => i !== idx))
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
    if (withDates) {
      const yes = (v) => String(v || 'N').trim().toUpperCase() === 'Y'
      setStamp(yes(l.Cancelled) ? { text: 'CANCELLED', color: 'red' } : l.auth_req ? (yes(l.Authorised) ? { text: 'AUTHORISED', color: 'green' } : { text: 'NOT AUTHORISED', color: 'orange' }) : null)
      if (l.SEVADate) setDocDate(new Date(l.SEVADate))
      const loaded = (l.dates || []).map((d) => ({ perform_date: dayjs(d.PDate).format('YYYY-MM-DD'), remarks: d.PRemarks || '' }))
      setDates(loaded)
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
      setViewId(id)
      setEditing(false)
      setViewNo(l.PrintSEVANO || l.SEVANO)
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not open that record'), color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setDates(todayDates())
    setDaysText('')
    setDaysTextFor('')
    setAttempted(false)
    setValues({})
    setRegular(false)
    setStamp(null)
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setDocDate(new Date())
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
    if (firstError) {
      // an alert, not small print by the Save button; the cursor goes to the first field that needs attention
      notifications.show({ title: 'Cannot save yet', message: firstError, color: 'red' })
      setTimeout(() => document.querySelector('.vt-entry-main [aria-invalid="true"]')?.focus(), 80)
      return
    }
    setSaving(true)
    try {
      const body = { fields: fieldsPayload(), dates, doc_date: isoDate(docDate), regular, days_text: daysTextFor === JSON.stringify(dates.map((d) => d.perform_date)) ? daysText : '' }
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
      const result = await sevaApi.createSeva(body)
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.seva_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.seva_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setDates(todayDates())
      setAttempted(false)
      setValues((cur) => {
        const keep = { ...cur }
        PER_DEVOTEE_CODES.forEach((c) => delete keep[c])
        return keep
      })
      queryClient.invalidateQueries({ queryKey: ['sevas'] })
      queryClient.invalidateQueries({ queryKey: ['seva-next-no'] })
      refetch()
    } catch (err) {
      notifications.show({ title: 'Save failed', message: errorText(err, 'Save failed'), color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  useDocShortcuts({
    onSave: () => (!viewId || editing) && onSave('save'),
    onNew: () => viewId && startNew(),
    onEdit: () => viewId && !editing && startEdit(),
    onPrint: () => lastSaved && setPrintFor(lastSaved.seva_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : onSave('print')),
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
        <div data-no-autofocus>
          <DateInput aria-label="Document date" valueFormat="DD-MMM-YYYY" value={docDate} onChange={(v) => v && setDocDate(v)} disabled={readOnly || !rules.edit_doc_date} w={150} />
        </div>
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
                errors={shownErrors}
                readOnly={readOnly}
                onBlurField={onBlurField}
                rowGroups={ROW_GROUPS}
                fieldFilters={{ SANNIDHIID: sannidhis }}
              />
              <Checkbox mt="md" label="Regular Devotee" color="kumkum" checked={regular} disabled={readOnly} onChange={(e) => setRegular(e.currentTarget.checked)} />
              {!viewId && (
                <Group gap="sm" align="flex-end" wrap="wrap" mt="md">
                  <Button variant="light" color="kumkum" leftSection={<Users size={16} />} onClick={() => setGroupOpen(true)}>
                    Group Seva
                  </Button>
                  <Button variant="light" color="kumkum" leftSection={<Landmark size={16} />} onClick={() => setShortlistOpen(true)}>
                    My Sannidhis{sannidhis.length ? ` (${sannidhis.length})` : ''}
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

            <Card withBorder p="lg">
              <Group justify="space-between" align="flex-end" mb="md" wrap="wrap">
                <div>
                  <Title order={4} mb={2}>Seva dates</Title>
                  <Text size="xs" c="dimmed">Add every date this seva will be performed. The total is the Seva's rate x number of dates.</Text>
                </div>
                {!readOnly && (
                  <Group align="flex-end" gap="xs">
                    <DateInput
                      label="Add date"
                      valueFormat="DD-MMM-YYYY"
                      value={newDate}
                      onChange={(v) => { setNewDate(v); setDateError('') }}
                      onDateChange={changeMonth}
                      renderDay={renderPanchangaDay}
                      w={170}
                      error={dateError || undefined}
                      description={newDate && panchanga[isoDate(newDate)] ? panchanga[isoDate(newDate)].name : newDate && dayjs(newDate).isBefore(dayjs(), 'day') ? 'This date is in the past' : undefined}
                    />
                    <Button leftSection={<Plus size={16} />} onClick={addDate} variant="light" color="kumkum">
                      Add
                    </Button>
                    <Button leftSection={<CalendarRange size={16} />} variant="default" onClick={() => setRangeOpen(true)} title="Dates Selection">
                      Dates selection
                    </Button>
                  </Group>
                )}
              </Group>
              {dates.length === 0 ? (
                <EmptyState icon={CalendarPlus} title="No dates added yet" hint="Pick a date above and press Add. At least one date is required to save." />
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
                { label: 'Rate', value: formatINR(rate) },
                { label: 'Dates', value: dates.length },
                ...(!viewId && nextNo ? [{ label: 'Bill no (on save)', value: nextNo.print_no || nextNo.seva_no }] : []),
                ...(viewId ? [{ label: editing ? 'Editing bill no' : 'Bill no', value: viewNo }] : []),
                ...(paymentLabel ? [{ label: 'Payment', value: paymentLabel }] : []),
              ]}
              total={formatINR(totalAmt)}
              words={totalAmt}
              saving={saving}
              saveDisabled={readOnly}
              onSave={() => onSave('save')}
              onSavePrint={() => onSave('print')}
            />
            {lastSaved && (
              <SavedPanel lines={[`Seva ${lastSaved.seva_no}`, ...(lastSaved.receipt_no ? [`Receipt ${lastSaved.receipt_no}`] : [])]} onPrint={() => setPrintFor(lastSaved.seva_id)} />
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
                subtitle: `${s.KNAME} · ${formatINR(s.TotalAmt)}`,
                printLabel: `Print ${s.PrintSEVANO}`,
                onPrint: () => setPrintFor(s.SEVAID),
              })}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} showNew={Boolean(viewId)} onEdit={startEdit} onCancelEdit={cancelEdit} onSave={() => onSave('save')} saving={saving} editing={editing} search={findSevas} />
      <SevaDatesDialog opened={rangeOpen} onClose={() => setRangeOpen(false)} dates={dates} dateText={daysTextFor === JSON.stringify(dates.map((d) => d.perform_date)) ? daysText : ''} onApply={applyDatesDialog} />
      <SannidhiShortlistModal opened={shortlistOpen} onClose={() => setShortlistOpen(false)} docId={DOC_ID} selected={sannidhis} onSave={setSannidhis} />
      <CopyFromDialog opened={copyOpen} onClose={() => setCopyOpen(false)} docName="Seva Entry" search={findSevas} onLoad={copyFrom} />
      <GroupSevaModal opened={groupOpen} onClose={() => setGroupOpen(false)} fields={fieldsPayload()} docDate={isoDate(docDate)} dates={dates} onDone={() => { refetch(); setDates(todayDates()) }} />
      <SevakartharuModal opened={pickOpen} onClose={() => setPickOpen(false)} onPick={applyDevotee} initialName={values.KNAME || ''} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Seva Receipt" />
    </Stack>
  )
}
