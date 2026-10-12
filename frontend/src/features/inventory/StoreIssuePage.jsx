import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Stack, Table, TextInput, Button } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { PackageMinus, Plus, Save, Trash2 } from 'lucide-react'
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
const DOC_ID = 1270

const FIELD_CODE_MAP = { LOCID: 'loc_id', ISSUEBY: 'issue_by', RMKS: 'remarks' }

const EMPTY_LINE = { item_id: '', uom_id: '', qty: 0, remarks: '' }

/** Store Issue Note (DocID 1270) — confirmed zero real usage, built per explicit request. */
export default function StoreIssuePage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ loc_id: '', issue_by: '', remarks: '', doc_date: new Date() })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['store-issues', 'recent'], queryFn: () => inventoryApi.listStoreIssues({ top: 15 }) })
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
        doc_date: isoDate(form.doc_date),
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

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const fmtQty = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })

  useDocShortcuts({ onSave })

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Store Issue Note" subtitle="Issue items out of stock" />

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Issue details" hint="Which store the items leave from and who issued them.">
              <Grid>
                {!hidden('LOCID') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <MasterOptionsSelect docId={LOCATION_DOC_ID} label={caption('LOCID', 'Location')} required={mandatory('LOCID')} value={form.loc_id} onChange={(v) => set('loc_id', v)} />
                  </Grid.Col>
                )}
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Document Date" valueFormat="DD/MM/YYYY" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
                </Grid.Col>
                {!hidden('ISSUEBY') && (
                  <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                    <TextInput label={caption('ISSUEBY', 'Issued By')} required={mandatory('ISSUEBY')} value={form.issue_by} onChange={(e) => set('issue_by', e.currentTarget.value)} />
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
              hint="One line per item being issued."
              action={
                <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                  Add line
                </Button>
              }
            >
              <Table.ScrollContainer minWidth={680}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item</Table.Th>
                      <Table.Th w={130}>UOM</Table.Th>
                      <Table.Th w={110}>{caption('ISSQTY', 'Qty')}</Table.Th>
                      <Table.Th>{caption('DRMKS', 'Remarks')}</Table.Th>
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
                          <TextInput aria-label={`Remarks, line ${i + 1}`} value={l.remarks} onChange={(e) => updateLine(i, { remarks: e.currentTarget.value })} />
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
              totalLabel="Total quantity issued"
              total={fmtQty(totalQty)}
              saveLabel="Save"
              saveIcon={Save}
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`Issue note ${lastSaved.iss_no}`]} />}
            <RecentCard
              title="Recent issues"
              icon={PackageMinus}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No issue notes yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.ISSID, title: r.PrintISSNO, subtitle: `${r.RMKS} \u00b7 Qty ${r.TOTQTY}` })}
            />
          </>
        }
      />
    </Stack>
  )
}
