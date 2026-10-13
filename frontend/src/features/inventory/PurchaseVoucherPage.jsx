import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Select, Stack, Table, Text, Button } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Receipt, Save, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import LookupSelect from '../../components/LookupSelect'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'
import dayjs from 'dayjs'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import DocNavBar from '../../components/ui/DocNavBar'
import { getVoucher } from '../../api/endpoints/voucher'

const DOC_ID = 1272
const EMPTY_LINES = [
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
]

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
  const [crPeriod, setCrPeriod] = useState(0)
  const [pbId, setPbId] = useState('')
  const [lines, setLines] = useState(EMPTY_LINES)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [viewId, setViewId] = useState(null) // a saved voucher being looked at (read-only)
  const [viewInfo, setViewInfo] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['purchase-vouchers', 'recent'], queryFn: () => inventoryApi.listPurchaseVouchers({ top: 15 }) })
  const { data: bills } = useQuery({ queryKey: ['purchase-bills', 'unvouchered'], queryFn: () => inventoryApi.listPurchaseBills({ top: 100 }) })
  const unvoucheredBills = (bills || []).filter((b) => !b.VCHID)
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = { CRPERIOD: crPeriod }
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { ac_led_id: '', dr_amt: 0, cr_amt: 0 }])
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
      setCrPeriod(h.CRPERIOD || 0)
      setPbId('')
      setLines(r.lines.map((l) => ({ ac_led_id: String(l.ac_led_id), dr_amt: l.dr_amt, cr_amt: l.cr_amt })))
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
    setCrPeriod(0)
    setPbId('')
    setLines(EMPTY_LINES)
  }
  async function findVouchers(q) {
    const rows = await inventoryApi.listPurchaseVouchers({ top: 200 })
    const t = (q || '').toLowerCase()
    return rows.filter((r) => !t || String(r.PrintPURVCHNO).toLowerCase().includes(t)).map((r) => ({ id: r.PURVCHID, label: r.PrintPURVCHNO, sub: `Credit period ${r.CRPERIOD} days` }))
  }

  async function onSave() {
    if (viewId) return
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
        cr_period: Number(crPeriod) || 0,
        pb_id: pbId ? Number(pbId) : null,
        lines: lines
          .filter((l) => Number(l.dr_amt) || Number(l.cr_amt))
          .map((l) => ({ ac_led_id: Number(l.ac_led_id), dr_amt: Number(l.dr_amt) || 0, cr_amt: Number(l.cr_amt) || 0 })),
      }
      const result = await inventoryApi.createPurchaseVoucher(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines(EMPTY_LINES)
      setPbId('')
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
      <PageHeader title="Purchase Voucher" subtitle="Post the accounting for a purchase, optionally linked to a bill" />

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
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Voucher Date" valueFormat="DD/MM/YYYY" value={voucherDate} onChange={setVoucherDate} />
                </Grid.Col>
                {!hidden('CRPERIOD') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <NumberInput label={caption('CRPERIOD', 'Credit Period (days)')} required={mandatory('CRPERIOD')} value={crPeriod} onChange={setCrPeriod} />
                  </Grid.Col>
                )}
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
                      <Table.Th>Total Dr / Total Cr</Table.Th>
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
