import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Stack, Table, TextInput, Button } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Layers, Plus, Save, Trash2 } from 'lucide-react'
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
const DOC_ID = 1149

// Maps this screen's own form-state keys to the legacy FldCode UtlDocDsgrFlds
// uses — same pattern as the other transaction screens (CLAUDE.md rule 5).
// DocID 1149 has zero UtlDocDsgrFlds rows today (confirmed against the
// live DB), so this is a no-op right now — purely future-proofing, same
// justification as StockAdjustmentPage.jsx's identical comment: if a row
// is ever added via the legacy Designer tool, this screen picks it up
// with zero further code changes.
const FIELD_CODE_MAP = { BOMItemID: 'bom_item_id', HRMKS: 'remarks' }

const EMPTY_COMPONENT = { item_id: '', qty: 0 }

/** Bill of Material (DocID 1149) — confirmed zero real usage, built per explicit request. Defines a recipe: 1 unit of the finished item = these component items/quantities. No stock movement of its own. */
export default function BomPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [bomItemId, setBomItemId] = useState('')
  const [effFrom, setEffFrom] = useState(new Date())
  const [effTo, setEffTo] = useState(null)
  const [remarks, setRemarks] = useState('')
  const [components, setComponents] = useState([{ ...EMPTY_COMPONENT }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['boms', 'recent'], queryFn: () => inventoryApi.listBoms({ top: 15 }) })
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, { bom_item_id: bomItemId, remarks }[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  function updateComponent(i, patch) {
    setComponents((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function addComponent() {
    setComponents((cs) => [...cs, { ...EMPTY_COMPONENT }])
  }
  function removeComponent(i) {
    setComponents((cs) => (cs.length > 1 ? cs.filter((_, idx) => idx !== i) : cs))
  }

  async function onSave() {
    if (!bomItemId) {
      notifications.show({ message: 'Finished Item is mandatory', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        bom_item_id: Number(bomItemId),
        eff_from: isoDate(effFrom),
        eff_to: effTo ? isoDate(effTo) : null,
        remarks,
        components: components.map((c) => ({ item_id: Number(c.item_id), qty: Number(c.qty) })),
      }
      const result = await inventoryApi.createBom(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setComponents([{ ...EMPTY_COMPONENT }])
      queryClient.invalidateQueries({ queryKey: ['boms'] })
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
      <PageHeader title="Bill of Material" subtitle="Define the components that make up one unit of a finished item" />

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Finished item" hint="What is being made and the dates this recipe applies.">
              <Grid>
                {!hidden('BOMItemID') && (
                  <Grid.Col span={{ base: 12, sm: 12, xl: 4 }}>
                    {/* Always required regardless of metadata, the save endpoint itself rejects a blank Finished Item. */}
                    <MasterOptionsSelect docId={ITEM_DOC_ID} label={caption('BOMItemID', 'Finished Item')} required value={bomItemId} onChange={setBomItemId} />
                  </Grid.Col>
                )}
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Effective From" valueFormat="DD/MM/YYYY" value={effFrom} onChange={setEffFrom} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Effective To" valueFormat="DD/MM/YYYY" clearable value={effTo} onChange={setEffTo} />
                </Grid.Col>
                {!hidden('HRMKS') && (
                  <Grid.Col span={12}>
                    <TextInput label={caption('HRMKS', 'Remarks')} required={mandatory('HRMKS')} value={remarks} onChange={(e) => setRemarks(e.currentTarget.value)} />
                  </Grid.Col>
                )}
              </Grid>
            </SectionCard>

            <SectionCard
              title="Components"
              hint="Quantity of each component needed for one unit."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addComponent}>
                  Add component
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={480}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Component Item</Table.Th>
                      <Table.Th w={160}>Qty</Table.Th>
                      <Table.Th w={48} aria-label="Remove" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {components.map((c, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <MasterOptionsSelect ariaLabel={`Component item, line ${i + 1}`} docId={ITEM_DOC_ID} value={c.item_id} onChange={(v) => updateComponent(i, { item_id: v })} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Quantity, line ${i + 1}`} value={c.qty} onChange={(v) => updateComponent(i, { qty: v })} decimalScale={2} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove component ${i + 1}`}
                            disabled={components.length <= 1}
                            onClick={async () => {
                              if (await confirm({ title: 'Remove this component?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) removeComponent(i)
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
                { label: 'Effective from', value: effFrom ? dayjs(effFrom).format('DD/MM/YYYY') : '-' },
                { label: 'Effective to', value: effTo ? dayjs(effTo).format('DD/MM/YYYY') : 'Open' },
              ]}
              totalLabel="Components"
              total={components.length}
              saveLabel="Save"
              saveIcon={Save}
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`BOM ${lastSaved.bom_no}`]} />}
            <RecentCard
              title="Recent BOMs"
              icon={Layers}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No BOMs yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.BOMID, title: r.PrintBOMNO, subtitle: `Effective from ${dayjs(r.EffFrom).format('DD/MM/YYYY')}` })}
            />
          </>
        }
      />
    </Stack>
  )
}
