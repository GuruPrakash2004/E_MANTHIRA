import { useEffect, useState } from 'react'
import { ActionIcon, Button, Grid, Group, NumberInput, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, ReceiptText, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as expenseApi from '../../api/endpoints/expense'
import LookupSelect from '../../components/LookupSelect'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import useDocFields from '../../hooks/useDocFields'
import usePrefixes from '../../hooks/usePrefixes'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'

const DOC_ID = 1260
const PAYMENT_MODES = ['Cash', 'Card', 'Online', 'Cheque']

// Maps this screen's form-state keys to the legacy FldCode in UtlDocDsgrFlds (same pattern as the other entry screens).
const FIELD_CODE_MAP = {
  PAYMNTMODE: 'payment_mode', REFNO: 'ref_no', RMKS: 'remarks',
  CHEQUENO: 'cheque_no', CHEQUEDT: 'cheque_date', CHEQUEAMT: 'cheque_amount', BANKNAME: 'bank_name',
}
const EMPTY_LINE = { led_id: '', amount: 0, item_desc: '', remarks: '' }

/**
 * Expense Entry (DocID 1260), port of the generic frmTrnNonPartyNonItem form: a dated expense with a payment mode and
 * one or more ledger/amount lines. Writes TrnHdrEXP + TrnDtlEXP only: the document definition has AccTrn = 'N', so
 * the legacy app posts nothing to the ledger for it and neither does this screen.
 */
export default function ExpenseEntryPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    prefix: '', expense_date: new Date(), payment_mode: 'Cash', ref_no: '', remarks: '',
    cheque_no: '', cheque_date: null, cheque_amount: 0, bank_name: '',
  })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)

  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const showItemDesc = Boolean(fieldMeta.ITEMDESC) && !isFieldHidden(fieldMeta.ITEMDESC, {})
  const chequeVisible = ['CHEQUENO', 'CHEQUEDT', 'CHEQUEAMT', 'BANKNAME'].some((c) => !hidden(c)) || form.payment_mode === 'Cheque'

  const { data: prefixes } = usePrefixes(DOC_ID)
  const { data: recent, isLoading: recentLoading } = useQuery({ queryKey: ['expenses', 'recent'], queryFn: () => expenseApi.listExpenses({ top: 25 }), staleTime: 0 })

  useEffect(() => {
    if (prefixes?.length && form.prefix === '' && prefixes[0] !== '') setForm((f) => ({ ...f, prefix: prefixes[0] }))
  }, [prefixes])

  const set = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }
  const updateLine = (idx, patch) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
    setErrors((e) => ({ ...e, lines: undefined }))
  }
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  function validate() {
    const e = {}
    if (!form.payment_mode) e.payment_mode = `${caption('PAYMNTMODE', 'Payment Mode')} is required`
    if (lines.some((l) => !l.led_id)) e.lines = 'Every line needs a ledger'
    else if (lines.some((l) => !(Number(l.amount) > 0))) e.lines = 'Please enter an amount greater than 0 on every line'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSave(mode) {
    if (!validate()) return
    setSaving(true)
    try {
      const isCheque = form.payment_mode === 'Cheque'
      const result = await expenseApi.createExpense({
        prefix: form.prefix || '',
        expense_date: isoDate(form.expense_date),
        payment_mode: form.payment_mode,
        ref_no: form.ref_no,
        remarks: form.remarks,
        cheque_no: isCheque ? form.cheque_no : '',
        cheque_date: isCheque && form.cheque_date ? isoDate(form.cheque_date) : null,
        cheque_amount: isCheque ? Number(form.cheque_amount) || 0 : 0,
        bank_name: isCheque ? form.bank_name : '',
        lines: lines.map((l) => ({ led_id: Number(l.led_id), amount: Number(l.amount), item_desc: l.item_desc, remarks: l.remarks })),
      })
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.exp_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.exp_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setForm((f) => ({ ...f, ref_no: '', remarks: '', cheque_no: '', cheque_date: null, cheque_amount: 0, bank_name: '', payment_mode: 'Cash' }))
      setLines([{ ...EMPTY_LINE }])
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

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Expense Entry" subtitle="Record an expense against one or more ledgers" />

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Expense details" hint="Date, how it was paid and an optional reference.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Date" valueFormat="DD/MM/YYYY" value={form.expense_date} onChange={(v) => set('expense_date', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <Select
                    label={caption('PAYMNTMODE', 'Payment Mode')}
                    required={mandatory('PAYMNTMODE') || true}
                    data={fieldListOptions(fieldMeta.PAYMNTMODE, PAYMENT_MODES)}
                    value={form.payment_mode}
                    onChange={(v) => set('payment_mode', v)}
                    error={errors.payment_mode}
                  />
                </Grid.Col>
                {!hidden('REFNO') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <TextInput label={caption('REFNO', 'Ref No.')} maxLength={10} value={form.ref_no} onChange={(e) => set('ref_no', e.currentTarget.value)} />
                  </Grid.Col>
                )}
                {prefixes && prefixes.filter(Boolean).length > 0 && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <Select label="Prefix" data={prefixes.filter(Boolean)} value={form.prefix} onChange={(v) => set('prefix', v)} />
                  </Grid.Col>
                )}
                <Grid.Col span={12}>
                  <TextInput label={caption('RMKS', 'Remarks')} maxLength={250} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>

            {chequeVisible && form.payment_mode === 'Cheque' && (
              <SectionCard title="Cheque details" hint="Shown only when the payment mode is Cheque.">
                <Grid>
                  {!hidden('CHEQUENO') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 3 }}>
                      <TextInput label={caption('CHEQUENO', 'Cheque Number')} maxLength={10} value={form.cheque_no} onChange={(e) => set('cheque_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHEQUEDT') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 3 }}>
                      <DateInput label={caption('CHEQUEDT', 'Cheque Dated')} valueFormat="DD/MM/YYYY" value={form.cheque_date} onChange={(v) => set('cheque_date', v)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHEQUEAMT') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 3 }}>
                      <NumberInput label={caption('CHEQUEAMT', 'Cheque Amount')} decimalScale={2} value={form.cheque_amount} onChange={(v) => set('cheque_amount', v)} />
                    </Grid.Col>
                  )}
                  {!hidden('BANKNAME') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 3 }}>
                      <TextInput label={caption('BANKNAME', 'Bank Name')} maxLength={50} value={form.bank_name} onChange={(e) => set('bank_name', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                </Grid>
              </SectionCard>
            )}

            <SectionCard
              title="Expense lines"
              hint="Pick the ledger and enter the amount for each line."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}>
                  Add line
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{caption('LEDID', 'Ledger Name')}</Table.Th>
                      {showItemDesc && <Table.Th>{caption('ITEMDESC', 'Item Desc')}</Table.Th>}
                      <Table.Th w={160}>{caption('AMOUNT', 'Amount')}</Table.Th>
                      <Table.Th>{caption('DRMKS', 'Remarks')}</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <LookupSelect docId={DOC_ID} field="LEDID" ariaLabel={`Ledger, line ${i + 1}`} label="" value={l.led_id} onChange={(v) => updateLine(i, { led_id: v })} />
                        </Table.Td>
                        {showItemDesc && (
                          <Table.Td>
                            <TextInput aria-label={`Item description, line ${i + 1}`} maxLength={250} value={l.item_desc} onChange={(e) => updateLine(i, { item_desc: e.currentTarget.value })} />
                          </Table.Td>
                        )}
                        <Table.Td>
                          <NumberInput aria-label={`Amount, line ${i + 1}`} decimalScale={2} min={0} value={l.amount} onChange={(v) => updateLine(i, { amount: v })} />
                        </Table.Td>
                        <Table.Td>
                          <TextInput aria-label={`Remarks, line ${i + 1}`} maxLength={250} value={l.remarks} onChange={(e) => updateLine(i, { remarks: e.currentTarget.value })} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove line ${i + 1}`}
                            disabled={lines.length <= 1}
                            onClick={async () => {
                              if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' }))
                                setLines((ls) => ls.filter((_, j) => j !== i))
                            }}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr>
                      <Table.Th colSpan={showItemDesc ? 2 : 1}>{caption('TOTAMT', 'Total Amount')}</Table.Th>
                      <Table.Th className="vt-num">{formatINR(total)}</Table.Th>
                      <Table.Th colSpan={2} />
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </Table.ScrollContainer>
              {errors.lines && (
                <Text size="sm" c="red" mt="xs" role="alert">
                  {errors.lines}
                </Text>
              )}
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: 'Lines', value: lines.length },
                { label: 'Payment mode', value: form.payment_mode },
              ]}
              totalLabel="Total expense"
              total={formatINR(total)}
              words={total}
              saveLabel="Save & Print"
              saving={saving}
              onSave={() => onSave('save')}
              onSavePrint={() => onSave('print')}
            />
            {lastSaved && <SavedPanel lines={[`Expense ${lastSaved.exp_no}`]} onPrint={() => setPrintFor(lastSaved.exp_id)} />}
            <RecentCard
              title="Recent expenses"
              icon={ReceiptText}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No expenses yet"
              emptyHint="Saved expenses will be listed here."
              renderRow={(v) => ({
                key: v.EXPID,
                title: v.PrintEXPNO,
                subtitle: `${v.PAYMNTMODE} · ${formatINR(v.TOTAMT)}${v.Cancelled === 'Y' ? ' · Cancelled' : ''}`,
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
