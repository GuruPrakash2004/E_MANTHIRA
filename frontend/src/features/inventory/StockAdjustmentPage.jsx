import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Badge, Button, Group, Stack, Text, Tooltip } from '@mantine/core'
import { ClipboardList, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import AddLineItemDialog from './AddLineItemDialog'
import useQoh, { fmtQoh } from './useQoh'
import useDocFields from '../../hooks/useDocFields'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import { fieldCaption } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, LineItemsCard, EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { isoDate } from '../../utils/format'

const DOC_ID = 1268

const COMPUTED_CODES = ['TOTQTY']

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', borderBottom: '1px solid var(--vt-line)' }

/**
 * Stock Adjustment Entry (DocID 1268): adds or reduces stock directly (no supplier / GL side). Items are added one at a time in the
 * Add Line Item dialog (the same one as the Purchase Bill); the lines saved are exactly what the legacy form writes: item, UOM,
 * quantity, rate, Add / Reduce and the line remarks.
 */
export default function StockAdjustmentPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ doc_date: new Date() })
  const [lines, setLines] = useState([])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [dialog, setDialog] = useState({ open: false, index: null })
  const { data: rules } = useQuery({ queryKey: ['stock-rules'], queryFn: inventoryApi.stockRules, staleTime: 5 * 60_000 }) // Inventory > AllowNegative

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['stock-adjustments', 'recent'], queryFn: () => inventoryApi.listStockAdjustments(historyParams()) })
  const { fields, byCode: fieldMeta } = useDocFields(DOC_ID)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  // Header / Footer fields come from this temple's Doc Designer (DocFieldsForm); values are keyed by FldCode.
  const [values, setValues] = useState({})
  const qohMap = useQoh(lines, values.LOCID) // quantity on hand of each line's item at the chosen location
  const [resetKey, setResetKey] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values, COMPUTED_CODES)
  const fieldsPayload = () =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !COMPUTED_CODES.includes(k))
        .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
    )

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))
  const locChosen = Number(values.LOCID) > 0 // the QOH shown in the dialog is that location's, so the location comes first

  function onLineSaved(line) {
    setLines((ls) => (dialog.index == null ? [...ls, line] : ls.map((l, i) => (i === dialog.index ? line : l))))
    if (dialog.index != null) setDialog({ open: false, index: null })
  }
  async function removeLine(i) {
    if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) setLines((ls) => ls.filter((_, idx) => idx !== i))
  }

  async function onSave() {
    setAttempted(true)
    const firstErr = Object.values(headErrors)[0] || (!lines.length ? 'Please add at least one item line' : null)
    if (firstErr) {
      notifications.show({ message: firstErr, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        fields: fieldsPayload(),
        doc_date: isoDate(form.doc_date),
        lines: lines.map((l) => ({ item_id: Number(l.item_id), uom_id: Number(l.uom_id), qty: Number(l.qty), rate: Number(l.rate) || 0, adj_type: l.adj_type || 'Add', remarks: l.remarks || '' })),
      }
      const result = await inventoryApi.createStockAdjustment(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines([])
      setValues({})
      setResetKey((k) => k + 1)
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['stock-adjustments'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const addQty = lines.reduce((s, l) => s + ((l.adj_type || 'Add') === 'Add' ? Number(l.qty) || 0 : 0), 0)
  const reduceQty = lines.reduce((s, l) => s + (l.adj_type === 'Reduce' ? Number(l.qty) || 0 : 0), 0)
  const fmtQty = (n) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })

  useDocShortcuts({ onSave })

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Stock Adjustment Entry" subtitle="Add or reduce item stock directly" right={<DocNoDate docId={DOC_ID} date={form.doc_date} onDate={(v) => set('doc_date', v)} />} />

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Adjustment details" hint="Where the stock sits and who is adjusting it.">
              <DocFieldsForm
                docId={DOC_ID}
                section="Header"
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                errors={attempted ? headErrors : {}}
                skip={COMPUTED_CODES}
              />
              <DocFieldsForm
                docId={DOC_ID}
                section="Footer"
                inlineLabels={false}
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                errors={attempted ? headErrors : {}}
                skip={COMPUTED_CODES}
              />
            </SectionCard>

            <LineItemsCard
              title="Stock Adjustment Line Items"
              chips={[
                { label: 'Items', value: lines.length },
                { label: 'Added', value: fmtQty(addQty), color: 'teal' },
                { label: 'Reduced', value: fmtQty(reduceQty), color: 'red' },
              ]}
              action={
                <Tooltip label="Select the location first" disabled={locChosen} withArrow>
                  <Button color="kumkum" leftSection={<Plus size={16} />} disabled={!locChosen} onClick={() => locChosen && setDialog({ open: true, index: null })}>
                    Add Item
                  </Button>
                </Tooltip>
              }
            >
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: 700 }}>
                <thead style={{ background: 'var(--vt-sandal)' }}>
                  <tr>
                    <th style={{ ...th, width: 40 }}>#</th>
                    <th style={th}>Item code</th>
                    <th style={th}>Item name</th>
                    <th style={th}>UOM</th>
                    <th style={{ ...th, textAlign: 'right' }}>QOH</th>
                    <th style={{ ...th, textAlign: 'right' }}>{caption('SAQTY', 'Qty')}</th>
                    <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                    <th style={th}>{caption('ADJTYPE', 'Adjust Type')}</th>
                    <th style={{ ...th, width: 84 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} style={{ background: i % 2 ? 'var(--vt-sandal)' : undefined }}>
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, color: 'var(--vt-accent)', fontWeight: 600 }}>{l.item_code}</td>
                      <td style={td}>{l.item_name}</td>
                      <td style={td}>{l.uom_code}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }} className="vt-num" aria-label={`Quantity on hand, line ${i + 1}`}>{fmtQoh(qohMap, l.item_id)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="vt-num">{fmtQty(Number(l.qty) || 0)}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="vt-num">{(Number(l.rate) || 0).toFixed(2)}</td>
                      <td style={td}>
                        <Badge variant="light" color={l.adj_type === 'Reduce' ? 'red' : 'teal'} tt="none">{l.adj_type || 'Add'}</Badge>
                      </td>
                      <td style={td}>
                        <Group gap={2} wrap="nowrap">
                          <ActionIcon variant="subtle" color="kumkum" aria-label={`Edit line ${i + 1}`} onClick={() => setDialog({ open: true, index: i })}>
                            <Pencil size={15} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" aria-label={`Remove line ${i + 1}`} onClick={() => removeLine(i)}>
                            <Trash2 size={15} />
                          </ActionIcon>
                        </Group>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lines.length === 0 && (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  No line items added yet. Click <b>Add Item</b> to start.
                </Text>
              )}
            </LineItemsCard>
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
              docId={DOC_ID}
              title="Recent adjustments"
              icon={ClipboardList}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No adjustments yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.SAID, title: r.PrintSANO, subtitle: `${r.RMKS} · Qty ${r.TOTQTY}` })}
            />
          </>
        }
      />

      <AddLineItemDialog
        opened={dialog.open}
        onClose={() => setDialog({ open: false, index: null })}
        onAdd={onLineSaved}
        initial={dialog.index == null ? null : lines[dialog.index]}
        rateRequired={false}
        withAdjType
        adjTypeCaption={caption('ADJTYPE', 'Adjust Type')}
        qtyCaption={caption('SAQTY', 'Quantity')}
        locId={values.LOCID}
        warnOver={(t) => t === 'Reduce'}
        blockOver={!rules?.allow_negative}
      />
    </Stack>
  )
}
