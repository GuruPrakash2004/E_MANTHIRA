import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Stack, Table, TextInput, Button } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Receipt, Save, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import LookupSelect from '../../components/LookupSelect'
import MasterOptionsSelect from './MasterOptionsSelect'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'
import dayjs from 'dayjs'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'

const ITEM_DOC_ID = 1114
const UOM_DOC_ID = 1115
const LOCATION_DOC_ID = 1123
const SUPPLIER_DOC_ID = 1121
const DOC_ID = 1271

const FIELD_CODE_MAP = { LOCID: 'loc_id', LEDIDPUR: 'ledid_pur', REFNO: 'ref_no', REFDT: 'ref_date', RMKS: 'remarks' }

const EMPTY_LINE = { item_id: '', uom_id: '', qty: 0, rate: 0 }

/** Purchase Bill (DocID 1271) — confirmed zero real usage, built per explicit request. Records the bill + stock-in; accounting is posted separately via Purchase Voucher. */
export default function PurchaseBillPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ loc_id: '', supp_id: '', ledid_pur: '', ref_no: '', ref_date: null, remarks: '', doc_date: new Date() })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['purchase-bills', 'recent'], queryFn: () => inventoryApi.listPurchaseBills({ top: 15 }) })
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }
  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { ...EMPTY_LINE }])
  }
  function removeLine(i) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))
  }

  const totalValue = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)

  async function onSave() {
    if (!form.loc_id || !form.supp_id) {
      notifications.show({ message: 'Location and Supplier are mandatory', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        loc_id: Number(form.loc_id),
        supp_id: Number(form.supp_id),
        ledid_pur: Number(form.ledid_pur),
        ref_no: form.ref_no,
        ref_date: form.ref_date ? isoDate(form.ref_date) : null,
        remarks: form.remarks,
        doc_date: isoDate(form.doc_date),
        lines: lines.map((l) => ({ item_id: Number(l.item_id), uom_id: Number(l.uom_id), qty: Number(l.qty), rate: Number(l.rate) })),
      }
      const result = await inventoryApi.createPurchaseBill(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines([{ ...EMPTY_LINE }])
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
      <PageHeader title="Purchase Bill" subtitle="Record items received from a supplier" />

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Bill details" hint="Supplier, store and the supplier's own bill reference.">
              <Grid>
                {!hidden('LOCID') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <MasterOptionsSelect docId={LOCATION_DOC_ID} label={caption('LOCID', 'Location')} required={mandatory('LOCID')} value={form.loc_id} onChange={(v) => set('loc_id', v)} />
                  </Grid.Col>
                )}
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <MasterOptionsSelect docId={SUPPLIER_DOC_ID} label="Supplier" required value={form.supp_id} onChange={(v) => set('supp_id', v)} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Document Date" valueFormat="DD/MM/YYYY" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
                </Grid.Col>
                {!hidden('LEDIDPUR') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <LookupSelect ledgerPicker label={caption('LEDIDPUR', 'Purchase Ledger')} required={mandatory('LEDIDPUR')} value={form.ledid_pur} onChange={(v) => set('ledid_pur', v)} />
                  </Grid.Col>
                )}
                {!hidden('REFNO') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <TextInput label={caption('REFNO', 'Ref No')} required={mandatory('REFNO')} value={form.ref_no} onChange={(e) => set('ref_no', e.currentTarget.value)} />
                  </Grid.Col>
                )}
                {!hidden('REFDT') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <DateInput label={caption('REFDT', 'Ref Date')} required={mandatory('REFDT')} valueFormat="DD/MM/YYYY" value={form.ref_date} onChange={(v) => set('ref_date', v)} />
                  </Grid.Col>
                )}
                {!hidden('RMKS') && (
                  <Grid.Col span={12}>
                    <TextInput label={caption('RMKS', 'Remarks')} required={mandatory('RMKS')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
                  </Grid.Col>
                )}
              </Grid>
            </SectionCard>

            <SectionCard
              title="Items"
              hint="Quantity times rate gives each line's amount."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                  Add line
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={760}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item</Table.Th>
                      <Table.Th w={130}>UOM</Table.Th>
                      <Table.Th w={110}>{caption('PBQTY', 'Qty')}</Table.Th>
                      <Table.Th w={120}>{caption('PBRATE', 'Rate')}</Table.Th>
                      <Table.Th w={130} ta="right">
                        {caption('PBAMT', 'Amount')}
                      </Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <MasterOptionsSelect ariaLabel={`Item, line ${i + 1}`} docId={ITEM_DOC_ID} value={l.item_id} onChange={(v) => updateLine(i, { item_id: v })} />
                        </Table.Td>
                        <Table.Td>
                          <MasterOptionsSelect ariaLabel={`UOM, line ${i + 1}`} docId={UOM_DOC_ID} value={l.uom_id} onChange={(v) => updateLine(i, { uom_id: v })} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Quantity, line ${i + 1}`} value={l.qty} onChange={(v) => updateLine(i, { qty: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Rate, line ${i + 1}`} value={l.rate} onChange={(v) => updateLine(i, { rate: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td ta="right" className="vt-num" fw={600}>
                          {formatINR((Number(l.qty) || 0) * (Number(l.rate) || 0))}
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove line ${i + 1}`}
                            disabled={lines.length <= 1}
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
                </Table>
              </Table.ScrollContainer>
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[{ label: 'Lines', value: lines.length }]}
              totalLabel="Bill value"
              total={formatINR(totalValue)}
              words={totalValue}
              saveLabel="Save"
              saveIcon={Save}
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`Bill ${lastSaved.pb_no}`]} />}
            <RecentCard
              title="Recent bills"
              icon={Receipt}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No purchase bills yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.PBID, title: r.PrintPBNO, subtitle: `${r.PartyName} \u00b7 ${formatINR(r.PBVALUE)}` })}
            />
          </>
        }
      />
    </Stack>
  )
}
