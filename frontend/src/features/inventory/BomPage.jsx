import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Divider, Grid, Group, NumberInput, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'

const ITEM_DOC_ID = 1114
const DOC_ID = 1149
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

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
  const queryClient = useQueryClient()
  const [bomItemId, setBomItemId] = useState('')
  const [effFrom, setEffFrom] = useState(new Date())
  const [effTo, setEffTo] = useState(null)
  const [remarks, setRemarks] = useState('')
  const [components, setComponents] = useState([{ ...EMPTY_COMPONENT }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, refetch } = useQuery({ queryKey: ['boms', 'recent'], queryFn: () => inventoryApi.listBoms({ top: 15 }) })
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
        eff_from: effFrom.toISOString().slice(0, 10),
        eff_to: effTo ? effTo.toISOString().slice(0, 10) : null,
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

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Bill of Material
            </Title>
            <Text size="sm" c="dimmed">
              Define the components that make up one unit of a finished item
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.bom_no}
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
              {!hidden('BOMItemID') && (
                <Grid.Col span={4}>
                  {/* Always required regardless of metadata — the save endpoint itself rejects a blank Finished Item. */}
                  <MasterOptionsSelect docId={ITEM_DOC_ID} label={caption('BOMItemID', 'Finished Item')} required value={bomItemId} onChange={setBomItemId} />
                </Grid.Col>
              )}
              <Grid.Col span={4}>
                <DateInput label="Effective From" value={effFrom} onChange={setEffFrom} />
              </Grid.Col>
              <Grid.Col span={4}>
                <DateInput label="Effective To" value={effTo} onChange={setEffTo} />
              </Grid.Col>
              {!hidden('HRMKS') && (
                <Grid.Col span={12}>
                  <TextInput label={caption('HRMKS', 'Remarks')} required={mandatory('HRMKS')} value={remarks} onChange={(e) => setRemarks(e.currentTarget.value)} />
                </Grid.Col>
              )}
            </Grid>

            <Group justify="space-between" mt="md">
              <Text size="sm" fw={600}>
                Components
              </Text>
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addComponent}>
                Add Component
              </Button>
            </Group>
            <Table mt="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Component Item</Table.Th>
                  <Table.Th w={140}>Qty</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {components.map((c, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <MasterOptionsSelect docId={ITEM_DOC_ID} value={c.item_id} onChange={(v) => updateComponent(i, { item_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={c.qty} onChange={(v) => updateComponent(i, { qty: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" disabled={components.length <= 1} onClick={() => removeComponent(i)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Group justify="flex-end" mt="lg">
              <Button size="md" color="kumkum" loading={saving} onClick={onSave}>
                Save
              </Button>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={4}>
          <Card withBorder radius="lg" p="md" shadow="sm">
            <Title order={5} mb="sm" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Recent BOMs
            </Title>
            <Stack gap={0}>
              {(recent || []).map((r, i) => (
                <div key={r.BOMID}>
                  {i > 0 && <Divider my={8} />}
                  <Text size="sm" fw={600}>
                    {r.PrintBOMNO}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Effective from {r.EffFrom?.slice(0, 10)}
                  </Text>
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
