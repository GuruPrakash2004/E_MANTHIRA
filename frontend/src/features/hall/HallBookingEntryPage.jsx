import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useEffect, useState } from 'react'
import { Button, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { CalendarRange, Copy } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import DocNavBar from '../../components/ui/DocNavBar'
import PrintPickerModal from '../../components/PrintPickerModal'
import usePrintFormats from '../../hooks/usePrintFormats'
import { pickFormat } from '../../lib/printing'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hbeApi from '../../api/endpoints/hallBookingEntry'
import useDocFields from '../../hooks/useDocFields'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import useDocRules from '../../hooks/useDocRules'
import CopyFromDialog from '../../components/ui/CopyFromDialog'
import DocXlMenu from '../../components/ui/DocXlMenu'
import { SectionCard, DetailsStrip, LineItemsCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { columnsFromLines, computeFormulas, withComputed } from '../../utils/docCompute'

const DOC_ID = 1280
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
// Calculated from the lines (shown in the summary), so not drawn as inputs.
const COMPUTED_CODES = ['TOTAMT', 'TOTGSTAMT', 'AMTAFTTAX', 'NETPAY', 'AMTINWORDS', 'TOTAMTIWRDS', 'ISSUEDBY']

/**
 * Hall Booking Entry (DocID 1280, table TrnHdrHBE) — a flat receipt screen, drawn entirely from the temple's
 * Doc Designer (UtlDocDsgrFlds): its Header / Footer / Total fields, and its Detail line columns.
 * See app/services/hall_booking_entry.py.
 */
export default function HallBookingEntryPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [viewId, setViewId] = useState(null) // a saved entry being looked at (read-only until Edit)
  const [viewNo, setViewNo] = useState('')
  const [editing, setEditing] = useState(false)
  const [idle, setIdle] = useState(true) // opens empty and locked (also after Cancel) until New is pressed
  const [printFor, setPrintFor] = useState(null)
  const readOnly = (Boolean(viewId) && !editing) || idle
  const rules = useDocRules(DOC_ID) // UtlTransactions switches (Copy From ...)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['hbe', 'recent'], queryFn: () => hbeApi.listHbe(historyParams()) })
  const { fields } = useDocFields(DOC_ID)
  const { user } = useAuth()
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const caption = (code, fallback) => fields.find((f) => f.FldCode === code)?.FldCaption || fallback
  const has = (code) => fields.some((f) => f.FldCode === code)

  useEffect(() => {
    if (fields.length && lines.length === 0 && !viewId && !idle) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length, viewId, idle])

  // Totals follow the Designer's formulas (e.g. Net Pay = Amount After Tax); a temple without them gets the plain arithmetic
  const computed = computeFormulas(fields, values, columnsFromLines(lines), { userCode: user?.user_code || '', aliases: { CGSTAMT: 'CGST', SGSTAMT: 'SGST' } })
  const shown = withComputed(fields, values, computed)
  const totalAmt = Number(computed.TOTAMT ?? lines.reduce((s, l) => s + (Number(l.AMOUNT) || 0), 0))
  const totGst = Number(computed.TOTGSTAMT ?? (Number(shown.CGST) || 0) + (Number(shown.SGST) || 0))
  const netPay = Number(computed.NETPAY ?? totalAmt + totGst - (Number(values.SDEPAMT) || 0) - (Number(values.ADV) || 0))

  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values, COMPUTED_CODES)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError = Object.values(headErrors)[0] || Object.values(Object.values(lineErrors)[0] || {})[0] || (!(totalAmt > 0) ? 'Enter an amount greater than 0' : null)

  async function onSave() {
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
      const cleanLines = lines.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== '' && v !== null && v !== undefined)))
      if (editing && viewId) {
        await hbeApi.updateHbe(viewId, { fields: fieldsPayload, lines: cleanLines })
        notifications.show({ message: 'Updated successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['hbe'] })
        refetch()
        await viewRecord(viewId)
        return
      }
      const result = await hbeApi.createHbe({ fields: fieldsPayload, lines: cleanLines })
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['hbe'] })
      refetch()
      await viewRecord(result.hbe_id) // the saved entry stays on screen (read-only); New starts the next one
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const cell = (f, v) => (v === null || v === undefined ? '' : f.FldDataType === 'Date' ? new Date(v) : f.FldBlnComboData === 'Y' ? Number(v) || '' : String(v).trim())
  async function viewRecord(id) {
    try {
      const r = await hbeApi.getHbe(id)
      const next = {}
      for (const f of fields) {
        if (f.FldSection === 'Detail') continue
        next[f.FldCode] = cell(f, r.header[f.FldCode])
      }
      next.CGST = cell({}, r.header.CGSTAMT ?? r.header.CGST)
      next.SGST = cell({}, r.header.SGSTAMT ?? r.header.SGST)
      setValues(next)
      const detail = fields.filter((f) => f.FldSection === 'Detail')
      setLines((r.lines || []).map((l) => Object.fromEntries(detail.map((f) => [f.FldCode, cell(f, l[f.FldCode])]))))
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(r.header.PrintHBENO || r.header.HBENO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  async function startEdit() {
    await viewRecord(viewId) // show what is saved right now
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function deleteEntry() {
    if (!(await confirm({ title: 'Delete this entry?', message: `Hall Booking Entry ${viewNo} will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await hbeApi.deleteHbe(viewId)
      notifications.show({ message: r?.message || 'Deleted Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['hbe'] })
      refetch()
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete the entry', color: 'red' })
    }
  }
  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setValues({}) // no resetKey bump: the Designer defaults come back only when New is pressed
    setLines([])
    setAttempted(false)
    setLastSaved(null)
    setIdle(true)
  }
  function startNew() {
    setIdle(false)
    setEditing(false)
    setViewId(null)
    setViewNo('')
    setValues({})
    setLines([])
    setAttempted(false)
    setResetKey((k) => k + 1) // re-applies the Designer defaults
  }

  // Copy From (legacy frmUtlCopyFrom): a saved entry's fields and lines become a new entry
  async function findEntries(q, { allFy = true } = {}) {
    const rows = await hbeApi.listHbe({ search: q, top: 30, ...(allFy ? { days: 0 } : {}) })
    return rows.map((r) => ({ id: r.HBEID, label: r.PrintHBENO || r.HBENO, sub: `${r.NMEOFFUNC || ''} ${r.CONPRS || ''} ${formatINR(r.NETPAY)}`.trim() }))
  }
  async function copyFrom(id) {
    try {
      const r = await hbeApi.getHbe(id)
      const next = {}
      for (const f of fields) {
        if (f.FldSection === 'Detail') continue
        const v = r.header[f.FldCode]
        if (v === null || v === undefined) next[f.FldCode] = ''
        else if (f.FldDataType === 'Date') next[f.FldCode] = new Date(v)
        else if (f.FldBlnComboData === 'Y') next[f.FldCode] = Number(v) || ''
        else next[f.FldCode] = String(v).trim()
      }
      setValues(next)
      const detail = fields.filter((f) => f.FldSection === 'Detail')
      setLines((r.lines || []).map((l) => Object.fromEntries(detail.map((f) => [f.FldCode, l[f.FldCode] ?? '']))))
      notifications.show({ message: `Copied from ${r.header.PrintHBENO || r.header.HBENO}`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not copy that entry', color: 'red' })
    }
  }
  useHotkeys('ctrl+alt+f', (e) => { e.preventDefault(); if (!viewId && !idle && rules.allow_copy_from) setCopyOpen(true) }, { enableOnFormTags: true }, [viewId, idle, rules.allow_copy_from])

  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'entry' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave(),
    onNew: () => (viewId || idle) && startNew(),
    onPrint: () => viewId && printWithFormat(pickFormat(printFormats)),
  })

  const common = { docId: DOC_ID, values, setValue, setValues, resetKey, seedDefaults: !idle, errors: attempted ? headErrors : {}, computed, readOnly }

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
        <Group gap="sm" align="flex-end" wrap="wrap">
          <DocNoDate docId={DOC_ID} type={values.TYPE || undefined} viewNo={viewId ? viewNo : ''} noDate />
          {rules.allow_copy_from && !viewId && !idle && (
            <Button variant="light" color="kumkum" leftSection={<Copy size={16} />} onClick={() => setCopyOpen(true)}>
              Copy From
            </Button>
          )}
        </Group>
      </Group>

      <CopyFromDialog opened={copyOpen} onClose={() => setCopyOpen(false)} docName="Hall Booking Entry" search={findEntries} onLoad={copyFrom} />

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <DetailsStrip title="Booking" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm {...common} section="Header" singleAddress />
            </DetailsStrip>

            <LineItemsCard
              title={caption('NAMEOFHALL', 'Halls and items')}
              chips={[{ label: 'Items', value: lines.length }, { label: 'Total', value: formatINR(totalAmt), color: 'teal' }]}
              action={rules.allow_imp_exp && !readOnly && <DocXlMenu docId={DOC_ID} name="Hall Booking Entry" rows={lines} setRows={setLines} />}
            >
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} readOnly={readOnly} />
            </LineItemsCard>

            {/* Payment details and Taxes and adjustments sit side by side (stacked on a narrow screen) */}
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" style={{ alignItems: 'start' }}>
              <DetailsStrip title="Payment details">
                <DocFieldsForm {...common} section="Footer" />
              </DetailsStrip>

              <DetailsStrip title="Taxes and adjustments" hint="Deposit and advance are deducted from the net.">
                <DocFieldsForm {...common} section="Total" />
              </DetailsStrip>
            </SimpleGrid>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: caption('TOTAMT', 'Total amount'), value: formatINR(totalAmt) },
                ...(has('CGST') || has('SGST') ? [{ label: caption('TOTGSTAMT', 'Total GST amount'), value: formatINR(totGst) }] : []),
                ...(has('SDEPAMT') ? [{ label: caption('SDEPAMT', 'Security deposit'), value: `- ${formatINR(Number(values.SDEPAMT) || 0)}` }] : []),
                ...(has('ADV') ? [{ label: caption('ADV', 'Advance'), value: `- ${formatINR(Number(values.ADV) || 0)}` }] : []),
              ]}
              totalLabel={caption('NETPAY', 'Net pay')}
              total={formatINR(netPay)}
              words={netPay}
              warning={firstError || null}
              saving={saving}
              hideActions // Save lives in the ribbon below
            />
            {lastSaved && <SavedPanel lines={[`Entry ${lastSaved.hbe_no}`]} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent entries"
              icon={CalendarRange}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No entries yet"
              emptyHint="Saved entries will be listed here."
              renderRow={(r) => ({
                key: r.HBEID,
                title: `${r.PrintHBENO}${r.TYPE ? ` · ${r.TYPE}` : ''}`,
                subtitle: `${r.NMEOFFUNC || ''} · ${formatINR(r.NETPAY)}`,
                printLabel: `Print ${r.PrintHBENO}`,
                onPrint: () => setPrintFor(r.HBEID),
              })}
              onLoad={viewRecord}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} lastSaved={lastSaved ? { id: lastSaved.hbe_id, label: lastSaved.hbe_no } : null} onLoad={viewRecord} onNew={startNew} showNew={Boolean(viewId) && !editing} entryMode={!viewId && !idle} newOnly={idle} cancelEditLabel="Cancel" onCancelEntry={cancelEntry} onDelete={deleteEntry} onClose={() => navigate('/')} onEdit={startEdit} onCancelEdit={cancelEdit} onSave={onSave} onPrint={() => printWithFormat(pickFormat(printFormats))} printFormats={printFormats} onPrintFormat={printWithFormat} saving={saving} editing={editing} search={(q) => findEntries(q, { allFy: true })} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Hall Booking Entry" initialOption={printOption} />
    </Stack>
  )
}
