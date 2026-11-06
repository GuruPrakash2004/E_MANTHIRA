import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Select, Stack, Table, Text, Button } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Plus, Receipt, Save, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import LookupSelect from '../../components/LookupSelect'
import useDocFields from '../../hooks/useDocFields'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import dayjs from 'dayjs'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import DocNavBar from '../../components/ui/DocNavBar'
import { getVoucher } from '../../api/endpoints/voucher'
import VoucherLinesTable, { appendLine, linesFromSaved, newVoucherLines } from '../../components/ui/VoucherLinesTable'
import useDocRules from '../../hooks/useDocRules'

const DOC_ID = 1272
// Set by the server (link to a bill), not entered
const COMPUTED_CODES = ['TRNTYPE', 'TRNID']
const EMPTY_LINES = newVoucherLines('DR')

/**
 * Purchase Voucher (DocID 1272) — confirmed zero real usage, built per
 * explicit request. Standalone Dr/Cr grid, same shape as Payment/Receipt
 * Voucher; optionally links to a Purchase Bill (which then gets its VCHID
 * filled in) via the Bill No field.
 */
export default function PurchaseVoucherPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [voucherDate, setVoucherDate] = useState(new Date())
  const [values, setValues] = useState({}) // Designer fields keyed by FldCode (rendered by DocFieldsForm)
  const [resetKey, setResetKey] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const [pbId, setPbId] = useState('')
  const [lines, setLines] = useState(EMPTY_LINES)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [viewId, setViewId] = useState(null) // a saved voucher being looked at (read-only)
  const [viewInfo, setViewInfo] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['purchase-vouchers', 'recent'], queryFn: () => inventoryApi.listPurchaseVouchers(historyParams()) })
  const { data: bills } = useQuery({ queryKey: ['purchase-bills', 'unvouchered'], queryFn: () => inventoryApi.listPurchaseBills({ top: 100 }) })
  const unvoucheredBills = (bills || []).filter((b) => !b.VCHID)
  const { fields } = useDocFields(DOC_ID)
  const rules = useDocRules(DOC_ID) // balance column / first-row type switches of this document
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const headErrors = docFieldErrors(fields, values, COMPUTED_CODES)

  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => appendLine(ls, rules.first_row_type))
  }
  function removeLine(i) {
    setLines((ls) => (ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls))
  }

  const totalDr = lines.reduce((s, l) => s + (Number(l.dr_amt) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.cr_amt) || 0), 0)
  const balanced = Math.round(totalDr * 100) === Math.round(totalCr * 100) && totalDr > 0

  async function viewRecord(id) {
    try {
      const r = await getVoucher('purchase', id)
      const h = r.header
      setVoucherDate(h.PURVCHDate ? new Date(h.PURVCHDate) : new Date())
      const next = {}
      for (const f of fields) {
        if (COMPUTED_CODES.includes(f.FldCode)) continue
        const v = h[f.FldCode]
        next[f.FldCode] = v === null || v === undefined ? '' : f.FldDataType === 'Date' ? new Date(v) : f.FldBlnComboData === 'Y' ? Number(v) || '' : String(v).trim()
      }
      setValues(next)
      setPbId('')
      setLines(linesFromSaved(r.lines))
      setViewId(id)
      setViewInfo({ no: h.PrintPURVCHNO || h.PURVCHNO, trnType: h.TRNTYPE, trnId: h.TRNID })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that voucher', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewInfo(null)
    setVoucherDate(new Date())
    setValues({})
    setResetKey((k) => k + 1)
    setAttempted(false)
    setPbId('')
    setLines(newVoucherLines(rules.first_row_type))
  }
  async function findVouchers(q) {
    const rows = await inventoryApi.listPurchaseVouchers({ top: 200 })
    const t = (q || '').toLowerCase()
    return rows.filter((r) => !t || String(r.PrintPURVCHNO).toLowerCase().includes(t)).map((r) => ({ id: r.PURVCHID, label: r.PrintPURVCHNO, sub: `Credit period ${r.CRPERIOD} days` }))
  }

  async function onSave() {
    if (viewId) return
    setAttempted(true)
    const firstErr = Object.values(headErrors)[0]
    if (firstErr) {
      notifications.show({ message: firstErr, color: 'red' })
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
        voucher_date: isoDate(voucherDate),
        fields: Object.fromEntries(
          Object.entries(values)
            .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !COMPUTED_CODES.includes(k))
            .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
        ),
        pb_id: pbId ? Number(pbId) : null,
        lines: lines
          .filter((l) => Number(l.dr_amt) || Number(l.cr_amt))
          .map((l) => ({ ac_led_id: Number(l.ac_led_id), dr_amt: Number(l.dr_amt) || 0, cr_amt: Number(l.cr_amt) || 0 })),
      }
      const result = await inventoryApi.createPurchaseVoucher(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines(newVoucherLines(rules.first_row_type))
      setPbId('')
      setValues({})
      setResetKey((k) => k + 1)
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['purchase-vouchers'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  useDocShortcuts({ onSave })

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Purchase Voucher" subtitle="Post the accounting for a purchase, optionally linked to a bill" right={<DocNoDate docId={DOC_ID} viewNo={viewInfo?.no || ''} date={voucherDate} onDate={setVoucherDate} dateDisabled={Boolean(viewId)} dateLabel="Voucher Date" />} />

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <Stack gap="lg">
            {viewInfo && (
              <SectionCard title="Header Info" hint="How this voucher was created.">
                <Grid>
                  <Grid.Col span={{ base: 12, sm: 4 }}><Text size="xs" c="dimmed">Voucher No</Text><Text fw={600}>{viewInfo.no}</Text></Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}><Text size="xs" c="dimmed">TRN Type</Text><Text fw={600} style={{ color: 'var(--vt-readonly-ink)' }}>{viewInfo.trnType}</Text></Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}><Text size="xs" c="dimmed">TRN ID</Text><Text fw={600} style={{ color: 'var(--vt-readonly-ink)' }}>{viewInfo.trnId}</Text></Grid.Col>
                </Grid>
              </SectionCard>
            )}
            <SectionCard title="Voucher details" hint="Date, credit period and the purchase bill this voucher settles.">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 12, xl: 4 }}>
                  <Select
                    label="Link Purchase Bill (optional)"
                    placeholder="Standalone voucher"
                    clearable
                    data={unvoucheredBills.map((b) => ({ value: String(b.PBID), label: `${b.PrintPBNO} \u00b7 ${b.PartyName}` }))}
                    value={pbId || null}
                    onChange={(v) => setPbId(v || '')}
                  />
                </Grid.Col>
              </Grid>
              <DocFieldsForm
                docId={DOC_ID}
                section="Header"
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                errors={attempted ? headErrors : {}}
                skip={COMPUTED_CODES}
                readOnly={Boolean(viewId)}
              />
            </SectionCard>

            <SectionCard
              title="Account heads"
              hint="Pick the ledger for each line and enter either a debit or a credit. Totals must match."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                  Add line
                </Button>
              }
            >
              <VoucherLinesTable
                docId={DOC_ID}
                lines={lines}
                setLines={setLines}
                readOnly={Boolean(viewId)}
                balanceCol={rules.balance_col}
                firstType={rules.first_row_type}
                attempted={attempted}
              />
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
              totalLabel="Voucher amount"
              total={formatINR(totalDr)}
              words={totalDr}
              warning={balanced || (totalDr === 0 && totalCr === 0) ? null : 'Debit and Credit totals are NOT matching!'}
              saveLabel="Save"
              saveIcon={Save}
              saving={saving}
              onSave={viewId ? undefined : onSave}
              saveDisabled={Boolean(viewId)}
            />
            {lastSaved && <SavedPanel lines={[`Voucher ${lastSaved.purvch_no}`]} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent vouchers"
              icon={Receipt}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No purchase vouchers yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.PURVCHID, title: r.PrintPURVCHNO, subtitle: `Credit period ${r.CRPERIOD} days` })}
            />
          </>
        }
      />
      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewInfo?.no} onLoad={viewRecord} onNew={startNew} search={findVouchers} />
    </Stack>
  )
}
