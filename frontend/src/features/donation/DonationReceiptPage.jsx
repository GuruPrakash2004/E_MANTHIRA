import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import { ActionIcon, Button, Grid, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Gift, HandCoins, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as donationApi from '../../api/endpoints/donation'
import * as metaApi from '../../api/endpoints/meta'
import LookupSelect from '../../components/LookupSelect'
import PrintPickerModal from '../../components/PrintPickerModal'
import { handleAfterSave } from '../../lib/printing'
import DynamicField from '../../components/DynamicField'
import usePrefixes from '../../hooks/usePrefixes'
import { useHotkeys } from 'react-hotkeys-hook'
import DonorHistoryModal from './DonorHistoryModal'
import DocNavBar from '../../components/ui/DocNavBar'
import { useLocation } from 'react-router-dom'
import useDocFields from '../../hooks/useDocFields'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import EmptyState from '../../components/ui/EmptyState'
import { formatINR, isoDate } from '../../utils/format'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'

const PAYMENT_MODES = ['Cash', 'Card', 'Cheque', 'UPI']
const DOC_ID = 1261
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — same pattern as SevaEntryPage (CLAUDE.md rule 5).
const FIELD_CODE_MAP = {
  AMOUNT: 'amount', RMKS: 'remarks', PAYMNTMODE: 'payment_mode', LEDGER: 'ledger_id',
  LEDID: 'cash_bank_ledger_id', HBID: 'hb_id', DONOR: 'donor', CONTACTNO: 'contact_no',
  ADDRESS: 'address', REFNO: 'reference_no', PANNO: 'pan_no',
  CHEQUENO: 'cheque_no', CHEQUEDATE: 'cheque_date', BANKNAME: 'bank_name',
}

export default function DonationReceiptPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    prefix: '',
    donor: '',
    contact_no: '',
    address: '',
    pan_no: '',
    payment_mode: 'Cash',
    reference_no: '',
    bank_name: '',
    cheque_no: '',
    cheque_date: null,
    remarks: '',
    ledger_id: '',
    cash_bank_ledger_id: '',
    hb_id: '',
    amount: 0,
    doc_date: new Date(),
  })
  const [extra, setExtra] = useState({})
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [donorOpen, setDonorOpen] = useState(false)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')
  const [donorLimit, setDonorLimit] = useState('')

  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const knownCodes = new Set(Object.keys(FIELD_CODE_MAP))
  const extraDesignerFields = Object.values(fieldMeta).filter(
    (f) => !knownCodes.has(f.FldCode) && !hidden(f.FldCode) && f.FldSection === 'Header'
  )
  // Optional Seva-tagged split (legacy: one donation receipt can fund several
  // sevas at once). Empty by default — the backend writes a single plain
  // "DONATION" detail line when no split is given, matching legacy behaviour.
  const [lines, setLines] = useState([])

  const linesTotal = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)

  function addLine() {
    setLines((ls) => [...ls, { seva_id: '', amount: 0 }])
  }
  function updateLine(idx, patch) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function removeLine(idx) {
    setLines((ls) => ls.filter((_, i) => i !== idx))
  }

  async function onContactBlur() {
    if (!form.contact_no || form.contact_no.length < 10) return
    try {
      const donor = await donationApi.lookupDonor(form.contact_no)
      if (donor) {
        setForm((f) => ({ ...f, donor: donor.DONOR || f.donor, address: donor.ADDRESS || f.address, pan_no: donor.PANNO || f.pan_no }))
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
    if (p) setForm((f) => ({ ...f, ...p }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
  const { data: recent, refetch, isLoading: recentLoading } = useQuery({
    queryKey: ['donations', 'recent'],
    queryFn: () => donationApi.listDonations({ top: 15 }),
  })

  useEffect(() => {
    if (prefixes?.length && !form.prefix && !location.state?.prefill) {
      setForm((f) => ({ ...f, prefix: prefixes[0] }))
    }
  }, [prefixes])

  // Show Donor: copy the chosen earlier donor's details and first seva line (legacy btnShowDonars_Click)
  function applyDonor(r) {
    setForm((f) => ({ ...f, donor: r.DONOR || '', address: r.ADDRESS || '', contact_no: r.CONTACTNO || '', reference_no: r.REFNO || f.reference_no, pan_no: r.PANNO || f.pan_no }))
    if (r.SEVAID) setLines((ls) => (ls.length ? ls.map((l, i) => (i === 0 ? { ...l, seva_id: r.SEVAID } : l)) : [{ seva_id: r.SEVAID, amount: 0 }]))
    setDonorOpen(false)
  }

  // Map a saved TrnHdrDONREC row (+ lines) into the entry form
  function fillFromDonation(l, withMeta = false) {
    setForm((f) => ({
      ...f,
      donor: l.DONOR || '',
      contact_no: l.CONTACTNO || '',
      address: l.ADDRESS || '',
      pan_no: l.PANNO || '',
      reference_no: l.REFNO || '',
      payment_mode: l.PAYMNTMODE || f.payment_mode,
      ledger_id: l.LEDGER ?? f.ledger_id,
      cash_bank_ledger_id: l.LEDID ?? f.cash_bank_ledger_id,
      amount: Number(l.TOTAMT) || 0,
      remarks: l.RMKS || '',
      ...(withMeta ? { hb_id: l.HBID || '', doc_date: l.DONRECDate ? new Date(l.DONRECDate) : f.doc_date, bank_name: l.BANKNAME || '', cheque_no: l.CHEQUENO || '' } : {}),
    }))
    setLines((l.lines || []).map((x) => ({ seva_id: x.SEVAID || '', amount: Number(x.AMOUNT) || 0 })))
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
      setViewId(id)
      setViewNo(l.PrintDONRECNO || l.DONRECNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewNo('')
    setLines([])
    setForm((f) => ({ ...f, donor: '', contact_no: '', address: '', pan_no: '', reference_no: '', remarks: '', amount: 0, hb_id: '', doc_date: new Date() }))
  }
  async function findDonations(q) {
    const rows = await donationApi.listDonations({ search: q, top: 30 })
    return rows.map((r) => ({ id: r.DONRECID, label: r.PrintDONRECNO || r.DONRECNO, sub: `${r.DONOR || ''} ${r.CONTACTNO || ''}`.trim() }))
  }
  useHotkeys('f6', (e) => { e.preventDefault(); if (!viewId) loadLastEntry() }, { enableOnFormTags: true }, [viewId])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function onSave() {
    if (!form.prefix) {
      notifications.show({ message: 'No document-number prefix configured', color: 'red' })
      return
    }
    if (mandatory('REFNO') && !form.reference_no) {
      notifications.show({ message: `${caption('REFNO', 'Reference Number')} is mandatory for ${form.payment_mode} payment`, color: 'red' })
      return
    }
    if (mandatory('CONTACTNO') && !form.contact_no) {
      notifications.show({ message: `${caption('CONTACTNO', 'Contact Number')} is mandatory`, color: 'red' })
      return
    }
    if (lines.length > 0 && Math.round(linesTotal * 100) !== Math.round((Number(form.amount) || 0) * 100)) {
      notifications.show({ message: 'Seva split amounts must add up to the total Amount', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        ...form,
        ledger_id: Number(form.ledger_id),
        cash_bank_ledger_id: Number(form.cash_bank_ledger_id),
        hb_id: form.hb_id ? Number(form.hb_id) : null,
        amount: Number(form.amount),
        doc_date: isoDate(form.doc_date),
        cheque_date: form.cheque_date ? isoDate(form.cheque_date) : null,
        lines: lines.length > 0 ? lines.map((l) => ({ seva_id: l.seva_id ? Number(l.seva_id) : null, amount: Number(l.amount) })) : null,
        extra_fields: extra,
      }
      const result = await donationApi.createDonation(body)
      setLastSaved(result)
      handleAfterSave({ docId: DOC_ID, recordId: result.donrec_id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setForm((f) => ({
        ...f,
        donor: '',
        contact_no: '',
        address: '',
        pan_no: '',
        reference_no: '',
        bank_name: '',
        cheque_no: '',
        cheque_date: null,
        remarks: '',
        hb_id: '',
        amount: 0,
      }))
      setExtra({})
      setLines([])
      queryClient.invalidateQueries({ queryKey: ['donations'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  useDocShortcuts({ onSave, onPrint: () => lastSaved && setPrintFor(lastSaved.donrec_id) })

  const splitMismatch = lines.length > 0 && Math.round(linesTotal * 100) !== Math.round((Number(form.amount) || 0) * 100)

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
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <>
        <Stack gap="lg">
          <SectionCard title="Receipt and donor" hint="Document details and who is donating. A known contact number fills the donor's details.">
            <Grid>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <Select label="Prefix" required data={prefixes || []} value={form.prefix} onChange={(v) => set('prefix', v)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <DateInput label="Document Date" valueFormat="DD/MM/YYYY" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
            <Select
              label={caption('PAYMNTMODE', 'Payment Mode')}
              required={mandatory('PAYMNTMODE')}
              data={fieldListOptions(fieldMeta.PAYMNTMODE, PAYMENT_MODES)}
              value={form.payment_mode}
              onChange={(v) => set('payment_mode', v)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <TextInput style={{ flex: 1 }} label={caption('DONOR', 'Donor Name')} required={mandatory('DONOR')} value={form.donor} onChange={(e) => set('donor', e.currentTarget.value)} />
              <NumberInput aria-label="Show No. of records" placeholder="Nos" w={70} min={0} hideControls value={donorLimit} onChange={setDonorLimit} />
              <Button variant="light" color="kumkum" onClick={() => setDonorOpen(true)}>
                Show Donor
              </Button>
            </Group>
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput
              label={caption('CONTACTNO', 'Contact Number')}
              required={mandatory('CONTACTNO')}
              value={form.contact_no}
              onChange={(e) => set('contact_no', e.currentTarget.value)}
              onBlur={onContactBlur}
            />
          </Grid.Col>
          {!hidden('ADDRESS') && (
            <Grid.Col span={{ base: 12, xl: 8 }}>
              <TextInput label={caption('ADDRESS', 'Address')} required={mandatory('ADDRESS')} value={form.address} onChange={(e) => set('address', e.currentTarget.value)} />
            </Grid.Col>
          )}
          {!hidden('PANNO') && (
            <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
              <TextInput label={caption('PANNO', 'PAN Number')} required={mandatory('PANNO')} value={form.pan_no} onChange={(e) => set('pan_no', e.currentTarget.value)} />
            </Grid.Col>
          )}
          {!hidden('HBID') && (
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <LookupSelect docId={DOC_ID} field="HBID" label={caption('HBID', 'Hall Booking No (optional)')} required={mandatory('HBID')} value={form.hb_id} onChange={(v) => set('hb_id', v)} />
            </Grid.Col>
          )}
          {!hidden('REFNO') && (
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput label={caption('REFNO', 'Reference No')} required={mandatory('REFNO')} value={form.reference_no} onChange={(e) => set('reference_no', e.currentTarget.value)} />
            </Grid.Col>
          )}
            </Grid>
          </SectionCard>

          <SectionCard title="Payment and amount" hint="How it was paid, the accounts it posts to, and the amount.">
            <Grid>
          {(!hidden('BANKNAME') || !hidden('CHEQUENO') || !hidden('CHEQUEDATE')) && (
            <>
              {!hidden('BANKNAME') && (
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('BANKNAME', 'Bank Name')} required={mandatory('BANKNAME')} value={form.bank_name} onChange={(e) => set('bank_name', e.currentTarget.value)} />
                </Grid.Col>
              )}
              {!hidden('CHEQUENO') && (
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <TextInput label={caption('CHEQUENO', 'Cheque No')} required={mandatory('CHEQUENO')} value={form.cheque_no} onChange={(e) => set('cheque_no', e.currentTarget.value)} />
                </Grid.Col>
              )}
              {!hidden('CHEQUEDATE') && (
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label={caption('CHEQUEDATE', 'Cheque Date')} required={mandatory('CHEQUEDATE')} valueFormat="DD/MM/YYYY" value={form.cheque_date} onChange={(v) => set('cheque_date', v)} />
                </Grid.Col>
              )}
            </>
          )}
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <LookupSelect docId={DOC_ID} field="LEDGER" label={caption('LEDGER', 'Income Ledger')} required={mandatory('LEDGER')} value={form.ledger_id} onChange={(v) => set('ledger_id', v)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <LookupSelect docId={DOC_ID} field="LEDID" label={caption('LEDID', 'Cash / Bank Account')} required={mandatory('LEDID')} value={form.cash_bank_ledger_id} onChange={(v) => set('cash_bank_ledger_id', v)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <NumberInput label={caption('AMOUNT', 'Amount')} required={mandatory('AMOUNT')} value={form.amount} onChange={(v) => set('amount', v)} decimalScale={2} />
          </Grid.Col>
          {!hidden('RMKS') && (
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput label={caption('RMKS', 'Remarks')} required={mandatory('RMKS')} value={form.remarks || ''} onChange={(e) => set('remarks', e.currentTarget.value)} />
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

          <SectionCard
            title="Split across sevas"
            hint="Optional. Tag parts of this donation to specific sevas; the parts must add up to the amount."
            action={
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                Add seva
              </Button>
            }
          >
            {lines.length === 0 ? (
              <EmptyState icon={HandCoins} title="No split" hint="Leave empty to record a plain donation, or add a seva to split the amount." />
            ) : (
              <Table.ScrollContainer minWidth={420}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Seva</Table.Th>
                      <Table.Th w={170}>Amount</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <LookupSelect docId={1263} field="SVAID" label="" aria-label="Seva" value={l.seva_id} onChange={(v) => updateLine(i, { seva_id: v })} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label="Amount" value={l.amount} onChange={(v) => updateLine(i, { amount: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label="Remove this line"
                            onClick={async () => { if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) removeLine(i) }}
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
            {splitMismatch && (
              <Text size="xs" c="red" mt="xs" role="alert">
                Line amounts ({formatINR(linesTotal)}) must add up to the total amount ({formatINR(form.amount)}).
              </Text>
            )}
          </SectionCard>
        </Stack>
          </>
        }
        side={
          <>
        <SummaryCard
          rows={[
            { label: 'Payment', value: form.payment_mode || '-' },
            { label: 'Seva split', value: lines.length ? `${lines.length} line(s)` : 'None' },
          ]}
          totalLabel="Donation amount"
          total={formatINR(form.amount)}
          words={form.amount}
          warning={splitMismatch ? 'Seva split does not add up to the amount.' : null}
          saving={saving}
          saveDisabled={Boolean(viewId)}
          onSave={onSave}
        />
        {lastSaved && (
          <SavedPanel
            lines={[`Donation ${lastSaved.donrec_no}`, `Receipt ${lastSaved.receipt_no}`]}
            onPrint={() => setPrintFor(lastSaved.donrec_id)}
          />
        )}
        <RecentCard
          title="Recent donations"
          icon={Gift}
          loading={recentLoading}
          rows={recent || []}
          emptyTitle="No donations yet"
          emptyHint="Saved receipts will be listed here."
          renderRow={(d) => ({
            key: d.DONRECID,
            title: d.PrintDONRECNO,
            subtitle: `${d.DONOR} \u00b7 ${formatINR(d.TOTAMT)}`,
            printLabel: `Print ${d.PrintDONRECNO}`,
            onPrint: () => setPrintFor(d.DONRECID),
          })}
        />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} search={findDonations} />
      <DonorHistoryModal opened={donorOpen} onClose={() => setDonorOpen(false)} onPick={applyDonor} initialName={form.donor} limit={Number(donorLimit) || 0} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Donation Receipt" />
    </Stack>
  )
}
