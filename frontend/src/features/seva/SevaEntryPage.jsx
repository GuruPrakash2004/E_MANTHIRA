import { useState } from 'react'
import {
  Badge,
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
  Kbd,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Trash2, Printer, Search, Receipt } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as sevaApi from '../../api/endpoints/seva'
import * as mastersApi from '../../api/endpoints/masters'
import LookupSelect from '../../components/LookupSelect'
import PrintPickerModal from '../../components/PrintPickerModal'
import DynamicField from '../../components/DynamicField'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption, fieldListOptions } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'

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

const PAYMENT_MODES = ['Cash', 'Card', 'Cheque', 'UPI']
const BANK_NAMES = ['AXIS BANK', 'HDFC BANK', 'STATE BANK OF INDIA', 'BANK OF BARODA', 'PUNJAB NATIONAL BANK', 'UNION BANK OF INDIA', 'KOTAK BANK', 'INDUSIND BANK', 'ICICI BANK', 'IDFC FIRST BANK', 'FEDERAL BANK', 'OTHERS']
const DOC_ID = 1263
// Domain cheat-sheet (CLAUDE.md §6): 1255 Sannidhi, 1265 Seva, 1257 Gothra, 1258 Nakshatra, 1279 Rashi.
const SEVA_MASTER_DOC_ID = 1265
const NAKSHATRA_MASTER_DOC_ID = 1258
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

export default function SevaEntryPage() {
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
    prasada: false,
    payment_mode: 'Cash',
    bank_name: '',
    cheque_no: '',
    cheque_date: null,
    reference_no: '',
    ledger_id: '',
    cash_bank_ledger_id: '',
    voucher_type: 'Cash',
    rate: 0,
    doc_date: new Date(),
  })
  const [dates, setDates] = useState([])
  const [newDate, setNewDate] = useState(new Date())
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

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

  const { data: recent, refetch } = useQuery({
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
    if (!form.mobile || form.mobile.length < 10) return
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
    const iso = newDate.toISOString().slice(0, 10)
    if (dates.some((d) => d.perform_date === iso)) {
      notifications.show({ message: `Duplicate date ${iso}`, color: 'red' })
      return
    }
    setDates((d) => [...d, { perform_date: iso, remarks: '' }])
  }

  function removeDate(idx) {
    setDates((d) => d.filter((_, i) => i !== idx))
  }

  async function onSave() {
    if (dates.length === 0) {
      notifications.show({ message: 'Please add at least one date!!', color: 'red' })
      return
    }
    if (mandatory('REFNO') && !form.reference_no) {
      notifications.show({ message: `${caption('REFNO', 'Reference Number')} is mandatory for ${form.payment_mode} payment`, color: 'red' })
      return
    }
    if (mandatory('MOBNUM') && !form.mobile) {
      notifications.show({ message: `${caption('MOBNUM', 'Mobile Number')} is mandatory for ${form.payment_mode} payment`, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        ...form,
        sannidhi_id: Number(form.sannidhi_id),
        seva_id: Number(form.seva_id),
        ledger_id: Number(form.ledger_id),
        cash_bank_ledger_id: Number(form.cash_bank_ledger_id),
        gothra_id: form.gothra_id ? Number(form.gothra_id) : null,
        nakshatra_id: form.nakshatra_id ? Number(form.nakshatra_id) : null,
        rashi_id: form.rashi_id ? Number(form.rashi_id) : null,
        nakshatra2_id: form.nakshatra2_id ? Number(form.nakshatra2_id) : null,
        rashi2_id: form.rashi2_id ? Number(form.rashi2_id) : null,
        cheque_date: form.cheque_date ? form.cheque_date.toISOString().slice(0, 10) : null,
        rate: Number(form.rate),
        doc_date: form.doc_date.toISOString().slice(0, 10),
        dates,
        extra_fields: extra,
      }
      const result = await sevaApi.createSeva(body)
      setLastSaved(result)
      setPrintFor(result.seva_id)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setDates([])
      queryClient.invalidateQueries({ queryKey: ['sevas'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const [printFor, setPrintFor] = useState(null)

  useDocShortcuts({ onSave, onPrint: () => lastSaved && setPrintFor(lastSaved.seva_id) })

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Seva Entry
            </Title>
            <Text size="sm" c="dimmed">
              Record a devotee's seva booking and print the receipt
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.seva_no} · Receipt {lastSaved.receipt_no}
          </Badge>
        )}
      </Group>

      <Grid>
        <Grid.Col span={8}>
          <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `url(${KOLAM_PATTERN})`,
                backgroundSize: '140px 140px',
                opacity: 0.03,
                pointerEvents: 'none',
              }}
            />
            <Grid style={{ position: 'relative' }}>
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="SANNIDHIID" label={caption('SANNIDHIID', 'Sannidhi')} required={mandatory('SANNIDHIID')} value={form.sannidhi_id} onChange={(v) => set('sannidhi_id', v)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="SVAID" label={caption('SVAID', 'Seva')} required={mandatory('SVAID')} value={form.seva_id} onChange={onSevaChange} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput
                  label={caption('MOBNUM', 'Mobile Number')}
                  required={mandatory('MOBNUM')}
                  value={form.mobile}
                  onChange={(e) => set('mobile', e.currentTarget.value)}
                  onBlur={onMobileBlur}
                  rightSection={<Search size={16} />}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label={caption('KNAME', 'Name')} required value={form.name} onChange={(e) => set('name', e.currentTarget.value)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <LookupSelect docId={DOC_ID} field="GOTHRAID" label={caption('GOTHRAID', 'Gothra')} required={mandatory('GOTHRAID')} value={form.gothra_id} onChange={(v) => set('gothra_id', v)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <LookupSelect docId={DOC_ID} field="NAKSHATRAID" label={caption('NAKSHATRAID', 'Nakshatra')} required={mandatory('NAKSHATRAID')} value={form.nakshatra_id} onChange={onNakshatraChange} />
              </Grid.Col>
              <Grid.Col span={4}>
                <LookupSelect docId={DOC_ID} field="RASHIID" label={caption('RASHIID', 'Rashi')} required={mandatory('RASHIID')} value={form.rashi_id} onChange={(v) => set('rashi_id', v)} />
              </Grid.Col>
              {/* Second devotee on this seva — tracked/saved already, but was
                  missing its own inputs entirely (metadata: visible, optional). */}
              {!hidden('SECKNAME') && (
                <Grid.Col span={4}>
                  <TextInput label={caption('SECKNAME', 'Name-2')} required={mandatory('SECKNAME')} value={form.name2} onChange={(e) => set('name2', e.currentTarget.value)} />
                </Grid.Col>
              )}
              {!hidden('SECNAKSHATRAID') && (
                <Grid.Col span={4}>
                  <LookupSelect docId={DOC_ID} field="SECNAKSHATRAID" label={caption('SECNAKSHATRAID', 'Nakshatra-2')} required={mandatory('SECNAKSHATRAID')} value={form.nakshatra2_id} onChange={(v) => set('nakshatra2_id', v)} />
                </Grid.Col>
              )}
              {!hidden('SECRASHIID') && (
                <Grid.Col span={4}>
                  <LookupSelect docId={DOC_ID} field="SECRASHIID" label={caption('SECRASHIID', 'Rashi-2')} required={mandatory('SECRASHIID')} value={form.rashi2_id} onChange={(v) => set('rashi2_id', v)} />
                </Grid.Col>
              )}
              {/* Rate/Document Date have no UtlDocDsgrFlds row for DocID 1263 (confirmed via live audit) — plain static labels are correct, nothing to wire. */}
              <Grid.Col span={4}>
                <NumberInput label="Rate" required value={form.rate} onChange={(v) => set('rate', v)} decimalScale={2} />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select
                  label={caption('PAYMENT', 'Payment Mode')}
                  required={mandatory('PAYMENT')}
                  data={fieldListOptions(fieldMeta.PAYMENT, PAYMENT_MODES)}
                  value={form.payment_mode}
                  onChange={(v) => set('payment_mode', v)}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <DateInput label="Document Date" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput
                  label={caption('RMKS', 'Seva Timing')}
                  required={mandatory('RMKS')}
                  placeholder="e.g. 7.30 AM"
                  value={form.timing_text}
                  onChange={(e) => set('timing_text', e.currentTarget.value)}
                />
              </Grid.Col>
              {!hidden('ADDRES') && (
                <Grid.Col span={8}>
                  <TextInput
                    label={caption('ADDRES', 'Address')}
                    required={mandatory('ADDRES')}
                    value={form.address}
                    onChange={(e) => set('address', e.currentTarget.value)}
                  />
                </Grid.Col>
              )}
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
                <Grid.Col span={6}>
                  <TextInput
                    label={caption('REFNO', 'Reference No')}
                    required={mandatory('REFNO')}
                    value={form.reference_no}
                    onChange={(e) => set('reference_no', e.currentTarget.value)}
                  />
                </Grid.Col>
              )}
              {(!hidden('BANKNAME') || !hidden('CHQNO') || !hidden('CHQDATE')) && (
                <>
                  {!hidden('BANKNAME') && (
                    <Grid.Col span={4}>
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
                    <Grid.Col span={4}>
                      <TextInput
                        label={caption('CHQNO', 'Cheque No')}
                        required={mandatory('CHQNO')}
                        value={form.cheque_no}
                        onChange={(e) => set('cheque_no', e.currentTarget.value)}
                      />
                    </Grid.Col>
                  )}
                  {!hidden('CHQDATE') && (
                    <Grid.Col span={4}>
                      <DateInput
                        label={caption('CHQDATE', 'Cheque Date')}
                        required={mandatory('CHQDATE')}
                        value={form.cheque_date}
                        onChange={(v) => set('cheque_date', v)}
                      />
                    </Grid.Col>
                  )}
                </>
              )}
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="LEDGER" label={caption('LEDGER', 'Income Ledger')} required={mandatory('LEDGER')} value={form.ledger_id} onChange={(v) => set('ledger_id', v)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <LookupSelect docId={DOC_ID} field="LEDID" label={caption('LEDID', 'Cash / Bank Account')} required={mandatory('LEDID')} value={form.cash_bank_ledger_id} onChange={(v) => set('cash_bank_ledger_id', v)} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label={caption('VCHTYP', 'Voucher Type')} required={mandatory('VCHTYP')} data={['Cash', 'Bank', 'Card']} value={form.voucher_type} onChange={(v) => set('voucher_type', v)} />
              </Grid.Col>
              {/* Any field a Designer edit adds later that this screen doesn't
                  already know about — renders itself automatically. */}
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

            <Title order={5} mt="lg" mb="xs" style={{ position: 'relative', fontFamily: 'Marcellus, Georgia, serif' }}>
              Seva Dates
            </Title>
            <Group align="end" mb="sm" style={{ position: 'relative' }}>
              <DateInput label="Add date" value={newDate} onChange={setNewDate} />
              <Button leftSection={<Plus size={16} />} onClick={addDate} variant="light" color="kumkum">
                Add
              </Button>
            </Group>
            <Table style={{ position: 'relative' }}>
              <Table.Tbody>
                {dates.map((d, i) => (
                  <Table.Tr key={d.perform_date}>
                    <Table.Td w={130}>{d.perform_date}</Table.Td>
                    <Table.Td>
                      <TextInput
                        placeholder="Remarks for this date"
                        size="xs"
                        value={d.remarks}
                        onChange={(e) => setDates((ds) => ds.map((x, xi) => (xi === i ? { ...x, remarks: e.currentTarget.value } : x)))}
                      />
                    </Table.Td>
                    <Table.Td w={40}>
                      <ActionIcon color="red" variant="subtle" onClick={() => removeDate(i)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Card
              mt="lg"
              radius="md"
              style={{
                position: 'relative',
                background: 'linear-gradient(120deg, #7A1F1F 0%, #5A1414 100%)',
              }}
            >
              <Group justify="space-between">
                <Text fw={600} c="#F4E1A6">
                  {form.rate || 0} × {dates.length} day(s)
                </Text>
                <Title order={3} c="white" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                  ₹ {totalAmt.toFixed(2)}
                </Title>
              </Group>
            </Card>

            <Group justify="flex-end" mt="lg" gap="xs" style={{ position: 'relative' }}>
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
              <Receipt size={18} color="#7A1F1F" />
              <Title order={5} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                Recent Sevas
              </Title>
            </Group>
            <Stack gap={0}>
              {(recent || []).map((s, i) => (
                <div key={s.SEVAID}>
                  {i > 0 && <Divider my={8} />}
                  <Group justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="sm" fw={600}>
                        {s.PrintSEVANO}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {s.KNAME} · ₹{s.TotalAmt}
                      </Text>
                    </div>
                    <ActionIcon variant="light" color="kumkum" onClick={() => setPrintFor(s.SEVAID)}>
                      <Printer size={16} />
                    </ActionIcon>
                  </Group>
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <PrintPickerModal opened={Boolean(printFor)} onClose={() => setPrintFor(null)} docId={DOC_ID} recordId={printFor} title="Seva Receipt" />
    </Stack>
  )
}
