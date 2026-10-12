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
const UOM_DOC_ID = 1115
const LOCATION_DOC_ID = 1123
const DOC_ID = 1270
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

const FIELD_CODE_MAP = { LOCID: 'loc_id', ISSUEBY: 'issue_by', RMKS: 'remarks' }

const EMPTY_LINE = { item_id: '', uom_id: '', qty: 0, remarks: '' }

/** Store Issue Note (DocID 1270) — confirmed zero real usage, built per explicit request. */
export default function StoreIssuePage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ loc_id: '', issue_by: '', remarks: '', doc_date: new Date() })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, refetch } = useQuery({ queryKey: ['store-issues', 'recent'], queryFn: () => inventoryApi.listStoreIssues({ top: 15 }) })
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
        issue_by: form.issue_by,
        remarks: form.remarks,
        doc_date: form.doc_date.toISOString().slice(0, 10),
        lines: lines.map((l) => ({ item_id: Number(l.item_id), uom_id: Number(l.uom_id), qty: Number(l.qty), remarks: l.remarks })),
      }
      const result = await inventoryApi.createStoreIssue(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines([{ ...EMPTY_LINE }])
      queryClient.invalidateQueries({ queryKey: ['store-issues'] })
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
              Store Issue Note
            </Title>
            <Text size="sm" c="dimmed">
              Issue items out of stock
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.iss_no}
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
              {!hidden('LOCID') && (
                <Grid.Col span={4}>
                  <MasterOptionsSelect docId={LOCATION_DOC_ID} label={caption('LOCID', 'Location')} required={mandatory('LOCID')} value={form.loc_id} onChange={(v) => set('loc_id', v)} />
                </Grid.Col>
              )}
              <Grid.Col span={4}>
                <DateInput label="Document Date" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
              </Grid.Col>
              {!hidden('ISSUEBY') && (
                <Grid.Col span={4}>
                  <TextInput label={caption('ISSUEBY', 'Issued By')} required={mandatory('ISSUEBY')} value={form.issue_by} onChange={(e) => set('issue_by', e.currentTarget.value)} />
                </Grid.Col>
              )}
              {!hidden('RMKS') && (
                <Grid.Col span={12}>
                  <TextInput label={caption('RMKS', 'Remarks')} required={mandatory('RMKS')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
                </Grid.Col>
              )}
            </Grid>

            <Group justify="space-between" mt="md">
              <Text size="sm" fw={600}>
                Items
              </Text>
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                Add Line
              </Button>
            </Group>
            <Table mt="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Item</Table.Th>
                  <Table.Th w={120}>UOM</Table.Th>
                  <Table.Th w={100}>{caption('ISSQTY', 'Qty')}</Table.Th>
                  <Table.Th>{caption('DRMKS', 'Remarks')}</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <MasterOptionsSelect docId={ITEM_DOC_ID} value={l.item_id} onChange={(v) => updateLine(i, { item_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <MasterOptionsSelect docId={UOM_DOC_ID} value={l.uom_id} onChange={(v) => updateLine(i, { uom_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.qty} onChange={(v) => updateLine(i, { qty: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <TextInput value={l.remarks} onChange={(e) => updateLine(i, { remarks: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" disabled={lines.length <= 1} onClick={() => removeLine(i)}>
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
              Recent Issues
            </Title>
            <Stack gap={0}>
              {(recent || []).map((r, i) => (
                <div key={r.ISSID}>
                  {i > 0 && <Divider my={8} />}
                  <Text size="sm" fw={600}>
                    {r.PrintISSNO}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.RMKS} · Qty {r.TOTQTY}
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
