import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useEffect, useState } from 'react'
import { Group, Select, Stack } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { ReceiptText } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as expenseApi from '../../api/endpoints/expense'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import useDocFields from '../../hooks/useDocFields'
import usePrefixes from '../../hooks/usePrefixes'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { columnsFromLines, computeFormulas } from '../../utils/docCompute'

const DOC_ID = 1260
const COMPUTED_CODES = ['TOTAMT']

/**
 * Expense Entry (DocID 1260), port of the generic frmTrnNonPartyNonItem form, drawn entirely from the temple's Doc
 * Designer (UtlDocDsgrFlds): Header / Footer fields through DocFieldsForm, the Detail columns through DocDetailGrid.
 * Writes TrnHdrEXP + TrnDtlEXP only: the document definition has AccTrn = 'N', so nothing is posted to the ledger.
 */
export default function ExpenseEntryPage() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [prefix, setPrefix] = useState(null) // null = not loaded yet; '' is a valid (blank) prefix
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)

  const { fields } = useDocFields(DOC_ID)
  const { user } = useAuth()
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))

  const { data: prefixes } = usePrefixes(DOC_ID)
  const { data: recent, isLoading: recentLoading } = useQuery({ queryKey: ['expenses', 'recent'], queryFn: () => expenseApi.listExpenses(historyParams()), staleTime: 0 })
  useEffect(() => {
    if (prefixes?.length && prefix === null) setPrefix(prefixes[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixes])
  useEffect(() => {
    if (fields.length && lines.length === 0) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length])

  const total = lines.reduce((s, l) => s + (Number(l.AMOUNT) || 0), 0)
  const computed = computeFormulas(fields, values, columnsFromLines(lines), { userCode: user?.user_code || '' })
  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values, COMPUTED_CODES)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError =
    Object.values(headErrors)[0] ||
    Object.values(Object.values(lineErrors)[0] || {})[0] ||
    (prefix === null ? 'No document-number prefix configured' : null) ||
    (!(total > 0) ? 'Please enter an amount greater than 0' : null)

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
      const cleanLines = lines.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== '' && v !== null && v !== undefined)))
      const result = await expenseApi.createExpense({ prefix: prefix || '', expense_date: isoDate(docDate), fields: fieldsPayload, lines: cleanLines })
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.exp_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.exp_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues({})
      setLines([])
      setAttempted(false)
      setResetKey((k) => k + 1)
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  useDocShortcuts({
    onSave: () => onSave('save'),
    onPrint: () => lastSaved && setPrintFor(lastSaved.exp_id),
    onDirectPrint: () => onSave('print'),
  })

  const common = { docId: DOC_ID, values, setValue, setValues, resetKey, errors: attempted ? headErrors : {}, computed }

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <PageHeader title="Expense Entry" subtitle="Record an expense against one or more ledgers" />
        <Group gap="xs" align="flex-end">
          {(prefixes || []).filter(Boolean).length > 1 && (
            <Select aria-label="Prefix" w={110} data={prefixes.filter(Boolean)} value={prefix || null} onChange={(v) => setPrefix(v || '')} allowDeselect={false} />
          )}
          <DocNoDate docId={DOC_ID} prefix={prefix ?? undefined} date={docDate} onDate={setDocDate} dateAria="Date" />
        </Group>
      </Group>

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Expense details" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm {...common} section="Header" />
            </SectionCard>

            <SectionCard title="Expense lines" hint="Pick the ledger and enter the amount for each line.">
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} />
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
                { label: 'Lines', value: lines.length },
                ...(values.PAYMNTMODE ? [{ label: 'Payment mode', value: values.PAYMNTMODE }] : []),
              ]}
              totalLabel="Total expense"
              total={formatINR(total)}
              words={total}
              warning={firstError || null}
              saveLabel="Save & Print"
              saving={saving}
              onSave={() => onSave('save')}
              onSavePrint={() => onSave('print')}
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
            />
          </>
        }
      />

      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Expense Entry" />
    </Stack>
  )
}
