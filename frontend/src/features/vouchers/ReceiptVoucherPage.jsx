import { useEffect, useState } from 'react'
import { ActionIcon, Badge, Button, Card, Divider, Grid, Group, Kbd, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ArrowDownLeft, Plus, Printer, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as voucherApi from '../../api/endpoints/voucher'
import * as metaApi from '../../api/endpoints/meta'
import LookupSelect from '../../components/LookupSelect'
import PrintPickerModal from '../../components/PrintPickerModal'
import DynamicField from '../../components/DynamicField'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'

const VCH_TYPES = ['Cash', 'Bank', 'Card']
const DOC_ID = 1248
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

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

  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const knownCodes = new Set(Object.keys(FIELD_CODE_MAP))
  const extraDesignerFields = Object.values(fieldMeta).filter(
    (f) => !knownCodes.has(f.FldCode) && !hidden(f.FldCode) && f.FldSection === 'Header'
  )

  const { data: prefixes } = useQuery({ queryKey: ['prefixes', DOC_ID], queryFn: () => metaApi.getPrefixes(DOC_ID) })
  const { data: recent, refetch } = useQuery({
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

  const totalDr = lines.reduce((s, l) => s + (Number(l.dr_amt) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.cr_amt) || 0), 0)
  const balanced = Math.round(totalDr * 100) === Math.round(totalCr * 100) && totalCr > 0

  async function onSave() {
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
        receipt_date: form.receipt_date.toISOString().slice(0, 10),
        cheque_date: form.cheque_date ? form.cheque_date.toISOString().slice(0, 10) : null,
        bank_id: form.bank_id ? Number(form.bank_id) : null,
        card_amt: Number(form.card_amt) || 0,
        lines: lines
          .filter((l) => Number(l.dr_amt) || Number(l.cr_amt))
          .map((l) => ({ ac_led_id: Number(l.ac_led_id), dr_amt: Number(l.dr_amt) || 0, cr_amt: Number(l.cr_amt) || 0 })),
        extra_fields: extra,
      }
      const result = await voucherApi.createReceiptVoucher(body)
      setLastSaved(result)
      setPrintFor(result.receipt_id)
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

  useDocShortcuts({ onSave, onPrint: () => lastSaved && setPrintFor(lastSaved.receipt_id) })

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Receipt Voucher
            </Title>
            <Text size="sm" c="dimmed">
              Record money received and post it to the ledger
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.receipt_no}
          </Badge>
        )}
      </Group>

      <Grid>
        <Grid.Col span={8}>
          <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
            <div
              aria-hidden
              style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
            />
            <Grid style={{ position: 'relative' }}>
              <Grid.Col span={4}>
                <Select label="Prefix" required data={prefixes || []} value={form.prefix} onChange={(v) => set('prefix', v)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <DateInput label="Receipt Date" value={form.receipt_date} onChange={(v) => set('receipt_date', v)} />
              </Grid.Col>
              <Grid.Col span={4}>
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
              {(!hidden('CHQDDNO') || !hidden('CHQDT') || !hidden('CHQAMT') || !hidden('CHQNO') || !hidden('BANK')) && (
                <>
                  {/* UtlDocDsgrFlds FldSection='Footer' for these. */}
                  <Grid.Col span={12}>
                    <Divider label="Payment Details" labelPosition="left" mt="xs" />
                  </Grid.Col>
                  {!hidden('CHQDDNO') && (
                    <Grid.Col span={4}>
                      <TextInput label={caption('CHQDDNO', 'Cheque /DD No')} required={mandatory('CHQDDNO')} value={form.cheque_dd_no} onChange={(e) => set('cheque_dd_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHQDT') && (
                    <Grid.Col span={4}>
                      <DateInput label={caption('CHQDT', 'Cheque Date')} required={mandatory('CHQDT')} value={form.cheque_date} onChange={(v) => set('cheque_date', v)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHQAMT') && (
                    <Grid.Col span={4}>
                      <TextInput label={caption('CHQAMT', 'Cheque/DD Amount')} required={mandatory('CHQAMT')} value={form.cheque_dd_amt} onChange={(e) => set('cheque_dd_amt', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CHQNO') && (
                    <Grid.Col span={4}>
                      <TextInput label={caption('CHQNO', 'Cheque No')} required={mandatory('CHQNO')} value={form.cheque_no} onChange={(e) => set('cheque_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('BANK') && (
                    <Grid.Col span={4}>
                      <LookupSelect docId={DOC_ID} field="BANK" label={caption('BANK', 'Bank')} required={mandatory('BANK')} value={form.bank_id} onChange={(v) => set('bank_id', v)} />
                    </Grid.Col>
                  )}
                </>
              )}
              {(!hidden('CARDNO') || !hidden('CRDAMT')) && (
                <>
                  {!hidden('CARDNO') && (
                    <Grid.Col span={4}>
                      <TextInput label={caption('CARDNO', 'Card No')} required={mandatory('CARDNO')} value={form.card_no} onChange={(e) => set('card_no', e.currentTarget.value)} />
                    </Grid.Col>
                  )}
                  {!hidden('CRDAMT') && (
                    <Grid.Col span={4}>
                      <NumberInput label={caption('CRDAMT', 'Card Amount')} required={mandatory('CRDAMT')} value={form.card_amt} onChange={(v) => set('card_amt', v)} decimalScale={2} />
                    </Grid.Col>
                  )}
                </>
              )}
              {extraDesignerFields.map((f) => (
                <Grid.Col span={4} key={f.FldCode}>
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

            <Group justify="space-between" mt="md" style={{ position: 'relative' }}>
              <Text size="sm" fw={600}>
                Account Heads
              </Text>
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                Add Line
              </Button>
            </Group>
            <Table mt="xs" style={{ position: 'relative' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Account Head</Table.Th>
                  <Table.Th w={140}>Debit</Table.Th>
                  <Table.Th w={140}>Credit</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <LookupSelect ledgerPicker label="" value={l.ac_led_id} onChange={(v) => updateLine(i, { ac_led_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.dr_amt} onChange={(v) => updateLine(i, { dr_amt: v, cr_amt: v ? 0 : l.cr_amt })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.cr_amt} onChange={(v) => updateLine(i, { cr_amt: v, dr_amt: v ? 0 : l.dr_amt })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" disabled={lines.length <= 2} onClick={() => removeLine(i)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {!balanced && (
              <Text size="xs" c="red" mt={4} style={{ position: 'relative' }}>
                Debit and Credit totals are NOT matching!
              </Text>
            )}

            <Card mt="lg" radius="md" style={{ position: 'relative', background: 'linear-gradient(120deg, #7A1F1F 0%, #5A1414 100%)' }}>
              <Group justify="space-between">
                <Text c="#F4E1A6" fw={600}>
                  {caption('TOTDR', 'Total Dr')} / {caption('TOTCR', 'Total Cr')}
                </Text>
                <Title order={3} c="white" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                  ₹ {totalDr.toFixed(2)} / ₹ {totalCr.toFixed(2)}
                </Title>
              </Group>
            </Card>

            <Group justify="flex-end" mt="lg" style={{ position: 'relative' }}>
              <Kbd size="xs">Alt+S</Kbd>
              <Button size="md" color="kumkum" loading={saving} onClick={onSave}>
                Save &amp; Print
              </Button>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={4}>
          <Card withBorder radius="lg" p="md" shadow="sm">
            <Group gap={8} mb="sm">
              <ArrowDownLeft size={18} color="#7A1F1F" />
              <Title order={5} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                Recent Receipts
              </Title>
            </Group>
            <Stack gap={0}>
              {(recent || []).map((r, i) => (
                <div key={r.RCPTVCHID}>
                  {i > 0 && <Divider my={8} />}
                  <Group justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="sm" fw={600}>
                        {r.PrintRCPTVCHNO}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {r.NARR} · ₹{r.TOTCR}
                      </Text>
                    </div>
                    <ActionIcon variant="light" color="kumkum" onClick={() => setPrintFor(r.RCPTVCHID)}>
                      <Printer size={16} />
                    </ActionIcon>
                  </Group>
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Receipt Voucher" />
    </Stack>
  )
}
