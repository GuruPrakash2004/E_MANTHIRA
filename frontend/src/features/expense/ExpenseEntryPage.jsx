import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useEffect, useState } from 'react'
import { Group, Select, Stack } from '@mantine/core'
import { ReceiptText } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as expenseApi from '../../api/endpoints/expense'
import useDirectPrint from '../../hooks/useDirectPrint'
import usePrintFormats from '../../hooks/usePrintFormats'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave, pickFormat } from '../../lib/printing'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import DocNavBar from '../../components/ui/DocNavBar'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import useDocFields from '../../hooks/useDocFields'
import usePrefixes from '../../hooks/usePrefixes'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { columnsFromLines, computeFormulas } from '../../utils/docCompute'

const DOC_ID = 1260
const COMPUTED_CODES = ['TOTAMT']
const errorText = (err, fallback) => err?.response?.data?.detail || fallback

/**
 * Expense Entry (DocID 1260), port of the generic frmTrnNonPartyNonItem form, drawn entirely from the temple's Doc
 * Designer (UtlDocDsgrFlds): Header / Footer fields through DocFieldsForm, the Detail columns through DocDetailGrid.
 * Writes TrnHdrEXP + TrnDtlEXP only: the document definition has AccTrn = 'N', so nothing is posted to the ledger.
 * The ribbon works like Seva Entry's: opens locked until New, Save / Cancel while entering, then the saved expense stays on
 * screen read-only with New / Edit / Delete / Print / Close / List / Options (print formats) and the record arrows.
 */
export default function ExpenseEntryPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [prefix, setPrefix] = useState(null) // null = not loaded yet; '' is a valid (blank) prefix
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')
  const [editing, setEditing] = useState(false) // a saved expense opened for changes (Edit in the ribbon)
  const [idle, setIdle] = useState(true) // the screen opens empty and locked (also after Cancel) until New is pressed
  const readOnly = (Boolean(viewId) && !editing) || idle

  const { fields } = useDocFields(DOC_ID)
  const { user } = useAuth()
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const detailCodes = fields.filter((f) => f.FldSection === 'Detail')

  const { data: prefixes } = usePrefixes(DOC_ID)
  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['expenses', 'recent'], queryFn: () => expenseApi.listExpenses(historyParams()), staleTime: 0 })
  useEffect(() => {
    if (prefixes?.length && prefix === null) setPrefix(prefixes[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixes])
  // Always at least one line while entering, like the legacy grid.
  useEffect(() => {
    if (fields.length && lines.length === 0 && !viewId && !idle) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length, viewId, idle])

  const total = lines.reduce((s, l) => s + (Number(l.AMOUNT) || 0), 0)
  const computed = viewId && !editing ? undefined : computeFormulas(fields, values, columnsFromLines(lines), { userCode: user?.user_code || '' })
  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values, COMPUTED_CODES)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError =
    Object.values(headErrors)[0] ||
    Object.values(Object.values(lineErrors)[0] || {})[0] ||
    (prefix === null ? 'No document-number prefix configured' : null) ||
    (!(total > 0) ? 'Please enter an amount greater than 0' : null)

  // Map a saved TrnHdrEXP row (+ its lines) into the entry: its columns are the Designer FldCodes
  const cell = (f, v) => (v === null || v === undefined ? '' : f.FldDataType === 'Date' ? new Date(v) : f.FldBlnComboData === 'Y' ? Number(v) || '' : String(v).trim())
  async function viewRecord(id) {
    try {
      const r = await expenseApi.getExpense(id)
      const h = r.header
      const next = {}
      for (const f of fields) {
        if (f.FldSection === 'Detail') continue
        next[f.FldCode] = cell(f, h[f.FldCode])
      }
      setValues(next)
      setLines((r.lines || []).map((l) => Object.fromEntries(detailCodes.map((f) => [f.FldCode, f.FldCode === 'AMOUNT' ? Number(l.AMOUNT) || 0 : cell(f, l[f.FldCode])]))))
      if (h.EXPDate) setDocDate(new Date(h.EXPDate))
      if (h.Prefix !== undefined && h.Prefix !== null) setPrefix(String(h.Prefix).trim())
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(h.PrintEXPNO || h.EXPNO)
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not open that record'), color: 'red' })
    }
  }
  function startNew() {
    setIdle(false)
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setValues({})
    setLines([])
    setAttempted(false)
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setDocDate(new Date())
    if (prefixes?.length) setPrefix(prefixes[0])
  }
  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setValues({}) // no resetKey bump here: the Designer defaults come back only when New is pressed
    setLines([])
    setAttempted(false)
    setLastSaved(null)
    setIdle(true)
  }
  async function deleteExpense() {
    if (!(await confirm({ title: 'Delete this expense?', message: `Expense ${viewNo} will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await expenseApi.deleteExpense(viewId)
      notifications.show({ message: r?.message || 'Deleted Expense Entry Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      refetch()
      setLastSaved(null)
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not delete the expense'), color: 'red' })
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
  async function findExpenses(q) {
    const rows = await expenseApi.listExpenses({ search: q, top: 30, days: 0 })
    return rows.map((r) => ({ id: r.EXPID, label: r.PrintEXPNO || r.EXPNO, sub: `${r.PAYMNTMODE || ''} ${r.TOTAMT != null ? formatINR(r.TOTAMT) : ''}`.trim() }))
  }

  async function onSave(mode) {
    setAttempted(true)
    if (firstError) {
      notifications.show({ title: 'Cannot save yet', message: firstError, color: 'red' })
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
      const body = { prefix: prefix || '', expense_date: isoDate(docDate), fields: fieldsPayload, lines: cleanLines }
      if (editing && viewId) {
        const done = await expenseApi.updateExpense(viewId, body)
        setLastSaved(done)
        notifications.show({ message: 'Changes saved successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['expenses'] })
        refetch()
        await viewRecord(viewId)
        if (mode === 'print') directPrint(viewId)
        return
      }
      const result = await expenseApi.createExpense(body)
      setLastSaved(result)
      // Save only saves (the preview opens from Print / the Options menu); F10 = save and print at once
      if (mode === 'print') directPrint(result.exp_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.exp_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      refetch()
      // the saved expense stays on screen (read-only) so it can be checked before printing; New starts the next one
      await viewRecord(result.exp_id)
    } catch (err) {
      notifications.show({ title: 'Save failed', message: errorText(err, 'Save failed'), color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'expense' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave('save'),
    onNew: () => (viewId || idle) && startNew(),
    onEdit: () => viewId && !editing && startEdit(),
    onPrint: () => lastSaved && setPrintFor(lastSaved.exp_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : !idle && onSave('print')),
  })

  const common = { docId: DOC_ID, values, setValue, setValues, resetKey, seedDefaults: !idle, errors: attempted ? headErrors : {}, computed, readOnly }

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <PageHeader title="Expense Entry" subtitle="Record an expense against one or more ledgers" />
        <Group gap="xs" align="flex-end">
          {(prefixes || []).filter(Boolean).length > 1 && (
            <Select aria-label="Prefix" w={110} data={prefixes.filter(Boolean)} value={prefix || null} onChange={(v) => setPrefix(v || '')} allowDeselect={false} disabled={Boolean(viewId)} />
          )}
          <DocNoDate docId={DOC_ID} prefix={prefix ?? undefined} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateAria="Date" dateDisabled={readOnly} />
        </Group>
      </Group>

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <SectionCard title="Expense details" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm {...common} section="Header" />
            </SectionCard>

            <SectionCard title="Expense lines" hint="Pick the ledger and enter the amount for each line.">
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} readOnly={readOnly} />
            </SectionCard>

            <SectionCard title="Payment details">
              <DocFieldsForm {...common} section="Footer" />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                ...(viewId ? [{ label: editing ? 'Editing expense no' : 'Expense no', value: viewNo }] : []),
                { label: 'Lines', value: lines.length },
                ...(values.PAYMNTMODE ? [{ label: 'Payment mode', value: values.PAYMNTMODE }] : []),
              ]}
              totalLabel="Total expense"
              total={formatINR(total)}
              words={total}
              warning={readOnly ? null : firstError || null}
              saving={saving}
              saveDisabled={readOnly || Boolean(firstError)}
              onSave={() => onSave('save')}
              hideActions // Save lives in the ribbon below (no separate Save & Print)
            />
            {lastSaved && <SavedPanel lines={[`Expense ${lastSaved.exp_no}`]} onPrint={() => setPrintFor(lastSaved.exp_id)} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent expenses"
              icon={ReceiptText}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No expenses yet"
              emptyHint="Saved expenses will be listed here."
              renderRow={(v) => ({
                key: v.EXPID,
                title: v.PrintEXPNO,
                subtitle: `${v.PAYMNTMODE || ''} · ${formatINR(v.TOTAMT)}${v.Cancelled === 'Y' ? ' · Cancelled' : ''}`,
                printLabel: `Print ${v.PrintEXPNO}`,
                onPrint: () => setPrintFor(v.EXPID),
              })}
              onLoad={viewRecord}
            />
          </>
        }
      />

      <DocNavBar
        docId={DOC_ID}
        currentId={viewId}
        viewLabel={viewNo}
        lastSaved={lastSaved ? { id: lastSaved.exp_id, label: lastSaved.exp_no } : null}
        onLoad={viewRecord}
        onNew={startNew}
        showNew={Boolean(viewId) && !editing}
        entryMode={!viewId && !idle}
        newOnly={idle}
        cancelEditLabel="Cancel"
        onCancelEntry={cancelEntry}
        onDelete={deleteExpense}
        onClose={() => navigate('/')}
        onEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={() => onSave('save')}
        onPrint={() => printWithFormat(pickFormat(printFormats))}
        printFormats={printFormats}
        onPrintFormat={printWithFormat}
        saving={saving}
        editing={editing}
        search={findExpenses}
      />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Expense Entry" initialOption={printOption} />
    </Stack>
  )
}
