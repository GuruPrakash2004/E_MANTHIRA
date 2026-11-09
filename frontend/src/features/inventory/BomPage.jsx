import { historyParams } from '../../lib/history'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Grid, NumberInput, Stack, Table, TextInput, Button } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import DocNavBar from '../../components/ui/DocNavBar'
import PrintPickerModal from '../../components/PrintPickerModal'
import usePrintFormats from '../../hooks/usePrintFormats'
import { pickFormat } from '../../lib/printing'
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
  const navigate = useNavigate()
  const [bomItemId, setBomItemId] = useState('')
  const [effFrom, setEffFrom] = useState(new Date())
  const [effTo, setEffTo] = useState(null)
  const [remarks, setRemarks] = useState('')
  const [components, setComponents] = useState([{ ...EMPTY_COMPONENT }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [viewId, setViewId] = useState(null) // a saved BOM being looked at (read-only until Edit)
  const [viewNo, setViewNo] = useState('')
  const [editing, setEditing] = useState(false)
  const [idle, setIdle] = useState(true) // opens empty and locked (also after Cancel) until New is pressed
  const [printFor, setPrintFor] = useState(null)
  const readOnly = (Boolean(viewId) && !editing) || idle

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['boms', 'recent'], queryFn: () => inventoryApi.listBoms(historyParams()) })
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
    if (readOnly) return
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
      if (editing && viewId) {
        await inventoryApi.updateBom(viewId, body)
        notifications.show({ message: 'Updated successfully!', color: 'teal' })
        queryClient.invalidateQueries({ queryKey: ['boms'] })
        refetch()
        await viewRecord(viewId)
        return
      }
      const result = await inventoryApi.createBom(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['boms'] })
      refetch()
      await viewRecord(result.bom_id) // the saved BOM stays on screen (read-only); New starts the next one
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function viewRecord(id) {
    try {
      const r = await inventoryApi.getBom(id)
      const h = r.header
      setBomItemId(h.BOMItemID ?? '')
      setEffFrom(h.EffFrom ? new Date(h.EffFrom) : new Date())
      setEffTo(h.EffTo ? new Date(h.EffTo) : null)
      setRemarks(String(h.HRMKS || '').trim())
      setComponents((r.lines || []).length ? r.lines.map((l) => ({ item_id: l.ITEMID, qty: Number(l.Qty) || 0 })) : [{ ...EMPTY_COMPONENT }])
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(h.PrintBOMNO || h.BOMNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function clearForm() {
    setBomItemId('')
    setEffFrom(new Date())
    setEffTo(null)
    setRemarks('')
    setComponents([{ ...EMPTY_COMPONENT }])
  }
  function startNew() {
    setIdle(false)
    setEditing(false)
    setViewId(null)
    setViewNo('')
    clearForm()
  }
  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setViewNo('')
    clearForm()
    setLastSaved(null)
    setIdle(true)
  }
  async function startEdit() {
    await viewRecord(viewId) // show what is saved right now
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function deleteBom() {
    if (!(await confirm({ title: 'Delete this BOM?', message: `Bill of Material ${viewNo} will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await inventoryApi.deleteBom(viewId)
      notifications.show({ message: r?.message || 'Deleted Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['boms'] })
      refetch()
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete the BOM', color: 'red' })
    }
  }
  async function findBoms(q) {
    const rows = await inventoryApi.listBoms({ top: 200, days: 0 })
    const needle = String(q || '').trim().toLowerCase()
    return rows.filter((r) => !needle || String(r.PrintBOMNO || r.BOMNO || '').toLowerCase().includes(needle)).map((r) => ({ id: r.BOMID, label: r.PrintBOMNO || r.BOMNO, sub: dayjs(r.EffFrom).format('DD-MMM-YYYY') }))
  }
  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'BOM' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave(),
    onNew: () => (viewId || idle) && startNew(),
    onPrint: () => viewId && printWithFormat(pickFormat(printFormats)),
  })

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Bill of Material" subtitle="Define the components that make up one unit of a finished item" />

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <SectionCard title="Finished item" hint="What is being made and the dates this recipe applies.">
              <Grid>
                {!hidden('BOMItemID') && (
                  <Grid.Col span={{ base: 12, sm: 12, xl: 4 }}>
                    {/* Always required regardless of metadata, the save endpoint itself rejects a blank Finished Item. */}
                    <MasterOptionsSelect docId={ITEM_DOC_ID} label={caption('BOMItemID', 'Finished Item')} required value={bomItemId} onChange={setBomItemId} disabled={readOnly} />
                  </Grid.Col>
                )}
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Effective From" valueFormat="DD-MMM-YYYY" value={effFrom} onChange={setEffFrom} disabled={readOnly} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, xl: 4 }}>
                  <DateInput label="Effective To" valueFormat="DD-MMM-YYYY" clearable value={effTo} onChange={setEffTo} disabled={readOnly} />
                </Grid.Col>
                {!hidden('HRMKS') && (
                  <Grid.Col span={12}>
                    <TextInput label={caption('HRMKS', 'Remarks')} required={mandatory('HRMKS')} value={remarks} onChange={(e) => setRemarks(e.currentTarget.value)} disabled={readOnly} />
                  </Grid.Col>
                )}
              </Grid>
            </SectionCard>

            <SectionCard
              title="Components"
              hint="Quantity of each component needed for one unit."
              action={
                !readOnly && (
                  <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addComponent}>
                    Add component
                  </Button>
                )
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
                          <MasterOptionsSelect ariaLabel={`Component item, line ${i + 1}`} docId={ITEM_DOC_ID} value={c.item_id} onChange={(v) => updateComponent(i, { item_id: v })} disabled={readOnly} />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput aria-label={`Quantity, line ${i + 1}`} value={c.qty} onChange={(v) => updateComponent(i, { qty: v })} decimalScale={2} disabled={readOnly} />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            size={36}
                            aria-label={`Remove component ${i + 1}`}
                            disabled={readOnly || components.length <= 1}
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
                { label: 'Effective from', value: effFrom ? dayjs(effFrom).format('DD-MMM-YYYY') : '-' },
                { label: 'Effective to', value: effTo ? dayjs(effTo).format('DD-MMM-YYYY') : 'Open' },
              ]}
              totalLabel="Components"
              total={components.length}
              saving={saving}
              hideActions // Save lives in the ribbon below
            />
            {lastSaved && <SavedPanel lines={[`BOM ${lastSaved.bom_no}`]} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent BOMs"
              icon={Layers}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No BOMs yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.BOMID, title: r.PrintBOMNO, subtitle: `Effective from ${dayjs(r.EffFrom).format('DD-MMM-YYYY')}`, printLabel: `Print ${r.PrintBOMNO}`, onPrint: () => setPrintFor(r.BOMID) })}
              onLoad={viewRecord}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} lastSaved={lastSaved ? { id: lastSaved.bom_id, label: lastSaved.bom_no } : null} onLoad={viewRecord} onNew={startNew} showNew={Boolean(viewId) && !editing} entryMode={!viewId && !idle} newOnly={idle} cancelEditLabel="Cancel" onCancelEntry={cancelEntry} onDelete={deleteBom} onClose={() => navigate('/')} onEdit={startEdit} onCancelEdit={cancelEdit} onSave={onSave} onPrint={() => printWithFormat(pickFormat(printFormats))} printFormats={printFormats} onPrintFormat={printWithFormat} saving={saving} editing={editing} search={findBoms} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Bill of Material" initialOption={printOption} />
    </Stack>
  )
}
