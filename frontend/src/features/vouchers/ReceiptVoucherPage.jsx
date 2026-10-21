import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import { ActionIcon, Button, Grid, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ArrowDownLeft, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as voucherApi from '../../api/endpoints/voucher'
import * as metaApi from '../../api/endpoints/meta'
import LookupSelect from '../../components/LookupSelect'
import useDirectPrint from '../../hooks/useDirectPrint'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import DynamicField from '../../components/DynamicField'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import usePrefixes from '../../hooks/usePrefixes'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import DocNavBar from '../../components/ui/DocNavBar'
import { formatINR, isoDate } from '../../utils/format'

const VCH_TYPES = ['Cash', 'Bank', 'Card']
const DOC_ID = 1248
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — same pattern as the other transaction screens (CLAUDE.md rule 5).
const FIELD_CODE_MAP = {
  VCHTYP: 'vch_type', NARR: 'narration',
  CHQDDNO: 'cheque_dd_no', CHQDT: 'cheque_date', CHQAMT: 'cheque_dd_amt',
  CHQNO: 'cheque_no', BANK: 'bank_id', CARDNO: 'card_no', CRDAMT: 'card_amt',
}

// Legacy frmTrnVch default: first grid row starts Cr for a Receipt Voucher
// (DefFirstRowAmtType — doc 07 §5.6), second row Dr (usually the cash/bank leg).
const EMPTY_LINES = [
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
]

export default function ReceiptVoucherPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    prefix: '',
    receipt_date: new Date(),
    vch_type: 'Cash',
    narration: '',
    cheque_dd_no: '',
    cheque_date: null,
    cheque_dd_amt: '',
    cheque_no: '',
    bank_id: '',
    card_no: '',
    card_amt: 0,
  })
  const [extra, setExtra] = useState({})
  const [lines, setLines] = useState(EMPTY_LINES)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [viewId, setViewId] = useState(null) // a saved voucher being looked at (read-only)
  const [viewNo, setViewNo] = useState('')

  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const knownCodes = new Set(Object.keys(FIELD_CODE_MAP))
  const extraDesignerFields = Object.values(fieldMeta).filter(
    (f) => !knownCodes.has(f.FldCode) && !hidden(f.FldCode) && f.FldSection === 'Header'
  )

  const { data: prefixes } = usePrefixes(DOC_ID)
  const { data: recent, isLoading: recentLoading, refetch } = useQuery({
    queryKey: ['receipt-vouchers', 'recent'],
    queryFn: () => voucherApi.listReceiptVouchers({ top: 15 }),
  })

  useEffect(() => {
    if (prefixes?.length && !form.prefix) setForm((f) => ({ ...f, prefix: prefixes[0] }))
  }, [prefixes])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }
  function updateLine(idx, patch) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { ac_led_id: '', dr_amt: 0, cr_amt: 0 }])
  }
  function removeLine(idx) {
    setLines((ls) => (ls.length > 2 ? ls.filter((_, i) => i !== idx) : ls))
  }

  const hasPaymentDetails =
    !hidden('CHQDDNO') || !hidden('CHQDT') || !hidden('CHQAMT') || !hidden('CHQNO') || !hidden('BANK') || !hidden('CARDNO') || !hidden('CRDAMT') || extraDesignerFields.length > 0

  const totalDr = lines.reduce((s, l) => s + (Number(l.dr_amt) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.cr_amt) || 0), 0)
  const balanced = Math.round(totalDr * 100) === Math.round(totalCr * 100) && totalCr > 0

  async function onSave(mode) {
    if (viewId) return
    if (mandatory('NARR') && !form.narration.trim()) {
      notifications.show({ message: `${caption('NARR', 'Narration')} should not be blank!`, color: 'red' })
      return
    }
    if (!balanced) {
      notifications.show({ message: 'Debit and Credit totals are NOT matching!', color: 'red' })
      return
    }
    if (lines.some((l) => !l.ac_led_id)) {
      notifications.show({ message: 'Every line needs an account head', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        ...form,
        receipt_date: isoDate(form.receipt_date),
        cheque_date: form.cheque_date ? isoDate(form.cheque_date) : null,
        bank_id: form.bank_id ? Number(form.bank_id) : null,
        card_amt: Number(form.card_amt) || 0,
        lines: lines
          .filter((l) => Number(l.dr_amt) || Number(l.cr_amt))
          .map((l) => ({ ac_led_id: Number(l.ac_led_id), dr_amt: Number(l.dr_amt) || 0, cr_amt: Number(l.cr_amt) || 0 })),
        extra_fields: extra,
      }
      const result = await voucherApi.createReceiptVoucher(body)
      setLastSaved(result)
      // F10 = save and print now; Alt+S = save only; the Save & Print button follows the document's after-save setting
      if (mode === 'print') directPrint(result.receipt_id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.receipt_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setForm((f) => ({ ...f, narration: '', cheque_dd_no: '', cheque_date: null, cheque_dd_amt: '', cheque_no: '', bank_id: '', card_no: '', card_amt: 0 }))
      setExtra({})
      setLines(EMPTY_LINES)
      queryClient.invalidateQueries({ queryKey: ['receipt-vouchers'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function viewRecord(id) {
    try {
      const r = await voucherApi.getVoucher('receipts', id)
      const h = r.header
      setForm((f) => ({
        ...f,
        prefix: h.Prefix || f.prefix,
        receipt_date: h.RCPTVCHDate ? new Date(h.RCPTVCHDate) : new Date(),
        vch_type: h.VCHTYP || 'Cash',
        narration: h.NARR || '',
        cheque_dd_no: (h.CHQDDNO || '').trim(),
        cheque_date: h.CHQDT ? new Date(h.CHQDT) : null,
        cheque_dd_amt: (h.CHQAMT || '').trim(),
        cheque_no: (h.CHQNO || '').trim(),
        bank_id: h.BANK ? String(h.BANK) : '',
        card_no: h.CARDNO && h.CARDNO !== '0' ? h.CARDNO : '',
        card_amt: Number(h.CRDAMT) || 0,
      }))
      setLines(r.lines.map((l) => ({ ac_led_id: String(l.ac_led_id), dr_amt: l.dr_amt, cr_amt: l.cr_amt })))
      setViewId(id)
      setViewNo(h.PrintRCPTVCHNO || h.RCPTVCHNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that voucher', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewNo('')
    setLines(EMPTY_LINES)
    setForm((f) => ({ ...f, receipt_date: new Date(), narration: '', cheque_dd_no: '', cheque_date: null, cheque_dd_amt: '', cheque_no: '', bank_id: '', card_no: '', card_amt: 0 }))
  }
  async function findVouchers(q) {
    const rows = await voucherApi.listReceiptVouchers({ search: q, top: 30 })
    return rows.map((v) => ({ id: v.RCPTVCHID, label: v.PrintRCPTVCHNO, sub: `${v.NARR} · ${formatINR(v.TOTDR)}` }))
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  useDocShortcuts({
    onSave: () => !viewId && onSave('save'),
    onPrint: () => lastSaved && setPrintFor(lastSaved.receipt_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : onSave('print')),
  })

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Receipt Voucher</Title>
            <Text size="sm" c="dimmed">
              Record money received and post it to the ledger
            </Text>
          </div>
        </Group>
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <Stack gap="lg">
            <SectionCard title="Voucher details" hint="Number series, date and what the voucher is for.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <Select label="Prefix" required data={prefixes || []} value={form.prefix} onChange={(v) => set('prefix', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Receipt Date" valueFormat="DD/MM/YYYY" value={form.receipt_date} onChange={(v) => set('receipt_date', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <Select
                    label={caption('VCHTYP', 'Voucher Type')}
                    required={mandatory('VCHTYP')}
                    data={fieldListOptions(fieldMeta.VCHTYP, VCH_TYPES)}
                    value={form.vch_type}
                    onChange={(v) => set('vch_type', v)}
                  />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput label={caption('NARR', 'Narration')} required value={form.narration} onChange={(e) => set('narration', e.currentTarget.value)} />
                </Grid.Col>
              </Grid>
            </SectionCard>

            {hasPaymentDetails && (
              <SectionCard title="Payment details" hint="Cheque, bank and card details, shown as set up for this voucher.">
                <Grid>
                  {/* UtlDocDsgrFlds FldSection='Footer' for these. */}
                  {!hidden('CHQDDNO') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <TextInput label={caption('CHQDDNO', 'Cheque /DD No')} required={mandatory('CHQDDNO')} value={form.cheque_dd_no} onChange={(e) => set('cheque_dd_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHQDT') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <DateInput label={caption('CHQDT', 'Cheque Date')} required={mandatory('CHQDT')} valueFormat="DD/MM/YYYY" value={form.cheque_date} onChange={(v) => set('cheque_date', v)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHQAMT') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <TextInput label={caption('CHQAMT', 'Cheque/DD Amount')} required={mandatory('CHQAMT')} value={form.cheque_dd_amt} onChange={(e) => set('cheque_dd_amt', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHQNO') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <TextInput label={caption('CHQNO', 'Cheque No')} required={mandatory('CHQNO')} value={form.cheque_no} onChange={(e) => set('cheque_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('BANK') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <LookupSelect docId={DOC_ID} field="BANK" label={caption('BANK', 'Bank')} required={mandatory('BANK')} value={form.bank_id} onChange={(v) => set('bank_id', v)} />
                    </Grid.Col>
                  )}
                  {!hidden('CARDNO') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <TextInput label={caption('CARDNO', 'Card No')} required={mandatory('CARDNO')} value={form.card_no} onChange={(e) => set('card_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CRDAMT') && (
                    <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                      <NumberInput label={caption('CRDAMT', 'Card Amount')} required={mandatory('CRDAMT')} value={form.card_amt} onChange={(v) => set('card_amt', v)} decimalScale={2} />
                    </Grid.Col>
                  )}
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
              </SectionCard>
            )}

            <SectionCard
              title="Account heads"
              hint="Pick the ledger for each line and enter either a debit or a credit. Totals must match."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                  Add line
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={560}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Account Head</Table.Th>
                      <Table.Th w={160}>Debit</Table.Th>
                      <Table.Th w={160}>Credit</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <LookupSelect ledgerPicker ariaLabel={`Account head, line ${i + 1}`} label="" value={l.ac_led_id} onChange={(v) => updateLine(i, { ac_led_id: v })} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Debit, line ${i + 1}`} value={l.dr_amt} onChange={(v) => updateLine(i, { dr_amt: v, cr_amt: v ? 0 : l.cr_amt })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Credit, line ${i + 1}`} value={l.cr_amt} onChange={(v) => updateLine(i, { cr_amt: v, dr_amt: v ? 0 : l.dr_amt })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove line ${i + 1}`}
                            disabled={lines.length <= 2}
                            onClick={async () => {
                              if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) removeLine(i)
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
                      <Table.Th>
                        {caption('TOTDR', 'Total Dr')} / {caption('TOTCR', 'Total Cr')}
                      </Table.Th>
                      <Table.Th className="vt-num">{formatINR(totalDr)}</Table.Th>
                      <Table.Th className="vt-num">{formatINR(totalCr)}</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </Table.ScrollContainer>
              {!balanced && (totalDr > 0 || totalCr > 0) && (
                <Text size="sm" c="red" mt="xs" role="alert">
                  Debit and Credit totals are NOT matching!
                </Text>
              )}
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: 'Total debit', value: formatINR(totalDr) },
                { label: 'Total credit', value: formatINR(totalCr) },
                { label: 'Difference', value: formatINR(Math.abs(totalDr - totalCr)) },
              ]}
              totalLabel="Receipt amount"
              total={formatINR(totalCr)}
              words={totalCr}
              warning={balanced || (totalDr === 0 && totalCr === 0) ? null : 'Debit and Credit totals are NOT matching!'}
              saving={saving}
              onSave={viewId ? undefined : () => onSave('save')}
              onSavePrint={viewId ? undefined : () => onSave('print')}
              saveDisabled={Boolean(viewId)}
            />
            {lastSaved && (
              <SavedPanel
                lines={[`Voucher ${lastSaved.receipt_no}`]}
                onPrint={() => setPrintFor(lastSaved.receipt_id)}
              />
            )}
            <RecentCard
              title="Recent receipts"
              icon={ArrowDownLeft}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No receipts yet"
              emptyHint="Saved vouchers will be listed here."
              renderRow={(v) => ({
                key: v.RCPTVCHID,
                title: v.PrintRCPTVCHNO,
                subtitle: `${v.NARR} · ${formatINR(v.TOTCR)}`,
                printLabel: `Print ${v.PrintRCPTVCHNO}`,
                onPrint: () => setPrintFor(v.RCPTVCHID),
              })}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} search={findVouchers} />

      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Receipt Voucher" />
    </Stack>
  )
}
