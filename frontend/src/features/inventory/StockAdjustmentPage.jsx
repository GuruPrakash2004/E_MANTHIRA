import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Select, Stack, Table, TextInput, Button } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ClipboardList, Plus, Save, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
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
const DOC_ID = 1268

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — same pattern as the transaction screens (CLAUDE.md rule 5). None of
// DocID 1268's fields have a live conditional rule today, but building real
// codeValues (not {}) means a future Designer-added conditional rule works
// here with zero further code changes.
const FIELD_CODE_MAP = { LOCID: 'loc_id', ADJBY: 'adj_by', RMKS: 'remarks' }

const EMPTY_LINE = { item_id: '', uom_id: '', qty: 0, rate: 0, adj_type: 'Add', remarks: '' }

/**
 * Stock Adjustment Entry (DocID 1268) — confirmed zero real usage in this
 * client's data (0 historical rows, hidden from the menu), built per
 * explicit request. Adds or reduces stock directly (no supplier/GL side).
 */
export default function StockAdjustmentPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ loc_id: '', adj_by: '', remarks: '', doc_date: new Date() })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['stock-adjustments', 'recent'], queryFn: () => inventoryApi.listStockAdjustments({ top: 15 }) })
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

  async function onSave() {
    if (!form.loc_id) {
      notifications.show({ message: 'Location is mandatory', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        loc_id: Number(form.loc_id),
        adj_by: form.adj_by,
        remarks: form.remarks,
        doc_date: isoDate(form.doc_date),
        lines: lines.map((l) => ({ item_id: Number(l.item_id), uom_id: Number(l.uom_id), qty: Number(l.qty), rate: Number(l.rate) || 0, adj_type: l.adj_type, remarks: l.remarks })),
      }
      const result = await inventoryApi.createStockAdjustment(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines([{ ...EMPTY_LINE }])
      queryClient.invalidateQueries({ queryKey: ['stock-adjustments'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const addQty = lines.reduce((s, l) => s + (l.adj_type === 'Add' ? Number(l.qty) || 0 : 0), 0)
  const reduceQty = lines.reduce((s, l) => s + (l.adj_type === 'Reduce' ? Number(l.qty) || 0 : 0), 0)
  const fmtQty = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })

  useDocShortcuts({ onSave })

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Stock Adjustment Entry" subtitle="Add or reduce item stock directly" />

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Adjustment details" hint="Where the stock sits and who is adjusting it.">
              <Grid>
                {!hidden('LOCID') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <MasterOptionsSelect docId={LOCATION_DOC_ID} label={caption('LOCID', 'Location')} required={mandatory('LOCID')} value={form.loc_id} onChange={(v) => set('loc_id', v)} />
                  </Grid.Col>
                )}
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Document Date" valueFormat="DD/MM/YYYY" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
                </Grid.Col>
                {!hidden('ADJBY') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <TextInput label={caption('ADJBY', 'Adjust By')} required={mandatory('ADJBY')} value={form.adj_by} onChange={(e) => set('adj_by', e.currentTarget.value)} />
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
              hint="One line per item. Choose Add to increase stock or Reduce to take it out."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                  Add line
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={720}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item</Table.Th>
                      <Table.Th w={130}>UOM</Table.Th>
                      <Table.Th w={110}>{caption('SAQTY', 'Qty')}</Table.Th>
                      <Table.Th w={110}>Rate</Table.Th>
                      <Table.Th w={140}>{caption('ADJTYPE', 'Adjust Type')}</Table.Th>
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
                        <Table.Td>
                          <Select aria-label={`Adjust type, line ${i + 1}`} data={['Add', 'Reduce']} value={l.adj_type} onChange={(v) => updateLine(i, { adj_type: v })} />
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
              rows={[
                { label: 'Lines', value: lines.length },
                { label: 'Stock added', value: fmtQty(addQty) },
                { label: 'Stock reduced', value: fmtQty(reduceQty) },
              ]}
              totalLabel="Net change in quantity"
              total={fmtQty(addQty - reduceQty)}
              saveLabel="Save"
              saveIcon={Save}
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`Adjustment ${lastSaved.sa_no}`]} />}
            <RecentCard
              title="Recent adjustments"
              icon={ClipboardList}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No adjustments yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.SAID, title: r.PrintSANO, subtitle: `${r.RMKS} \u00b7 Qty ${r.TOTQTY}` })}
            />
          </>
        }
      />
    </Stack>
  )
}
