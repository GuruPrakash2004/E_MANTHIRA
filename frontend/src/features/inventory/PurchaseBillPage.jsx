import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PrintPickerModal from '../../components/PrintPickerModal'
import useDirectPrint from '../../hooks/useDirectPrint'
import usePrintFormats from '../../hooks/usePrintFormats'
import { pickFormat } from '../../lib/printing'
import { ActionIcon, Badge, Button, Collapse, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { ChevronDown, ChevronUp, Pencil, Plus, Receipt, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import MasterOptionsSelect from './MasterOptionsSelect'
import AddLineItemDialog from './AddLineItemDialog'
import DocNavBar from '../../components/ui/DocNavBar'
import useDocFields from '../../hooks/useDocFields'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import { fieldCaption } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { EntryLayout, SummaryCard, SavedPanel, RecentCard, PageHeader } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'

const SUPPLIER_DOC_ID = 1121
const DOC_ID = 1271

const COMPUTED_CODES = ['TOTQTY', 'PBVALUE', 'VCHID', 'ISSUEDBY', 'TOTAMTIWRDS', 'AMTINWORDS']

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', borderBottom: '1px solid var(--vt-line)' }

/**
 * Purchase Bill (DocID 1271): records the bill + stock-in; accounting is posted separately via Purchase Voucher.
 * Layout: top strip (date, supplier, Doc Details), Line Items card with the Add Line Item dialog, totals card and the
 * bottom action bar with record navigation. Rows written are exactly what the legacy form writes (item, UOM, qty, rate).
 */
export default function PurchaseBillPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ supp_id: '', doc_date: new Date() })
  const [lines, setLines] = useState([])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const navigate = useNavigate()
  const [printFor, setPrintFor] = useState(null)
  const [viewId, setViewId] = useState(null) // a saved bill being looked at (read-only); null = new entry
  const [viewNo, setViewNo] = useState('')
  const [editing, setEditing] = useState(false) // a saved bill opened for changes (Edit in the ribbon)
  const [voucher, setVoucher] = useState(null) // the Purchase Voucher generated for the bill on screen ({id, no, print_no}), from the settings of the temple
  const [idle, setIdle] = useState(true) // the screen opens empty and locked (also after Cancel) until New is pressed
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [dialog, setDialog] = useState({ open: false, index: null })

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['purchase-bills', 'recent'], queryFn: () => inventoryApi.listPurchaseBills(historyParams()) })
  // The bill no this entry will get (peeked, not reserved), shown from the start like the legacy form: prefix, number, printed number.
  const { data: nextNo, refetch: refetchNextNo } = useQuery({ queryKey: ['purchase-bill-next-no'], queryFn: inventoryApi.purchaseBillNextNo, staleTime: 0, refetchOnMount: 'always' })
  const { fields, byCode: fieldMeta } = useDocFields(DOC_ID)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  // Header / Footer fields come from this temple's Doc Designer (DocFieldsForm); values are keyed by FldCode.
  const [values, setValues] = useState({})
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
  const readOnly = (Boolean(viewId) && !editing) || idle
  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const totalValue = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)

  function onLineSaved(line) {
    setLines((ls) => (dialog.index == null ? [...ls, line] : ls.map((l, i) => (i === dialog.index ? line : l))))
    if (dialog.index != null) setDialog({ open: false, index: null })
  }
  async function removeLine(i) {
    if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) setLines((ls) => ls.filter((_, idx) => idx !== i))
  }

  function startNew() {
    refetchNextNo()
    setIdle(false)
    setViewId(null)
    setEditing(false)
    setVoucher(null)
    setViewNo('')
    setForm({ supp_id: '', doc_date: new Date() })
    setLines([])
    setValues({})
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setAttempted(false)
  }
  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setVoucher(null)
    setViewNo('')
    setForm({ supp_id: '', doc_date: new Date() })
    setLines([])
    setValues({}) // no resetKey bump here: the Designer defaults come back only when New is pressed
    setAttempted(false)
    setLastSaved(null)
    setIdle(true)
  }
  async function startEdit() {
    // the screen must show what is saved right now, not what was loaded a while ago
    await viewRecord(viewId)
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function viewRecord(id) {
    try {
      const r = await inventoryApi.getPurchaseBill(id)
      const h = r.header
      const next = {}
      for (const f of fields) {
        if (COMPUTED_CODES.includes(f.FldCode)) continue
        const v = h[f.FldCode]
        next[f.FldCode] = v === null || v === undefined ? '' : f.FldDataType === 'Date' ? new Date(v) : f.FldBlnComboData === 'Y' ? Number(v) || '' : String(v).trim()
      }
      setValues(next)
      setForm({ supp_id: h.SUPPID, doc_date: h.PBDate ? new Date(h.PBDate) : new Date() })
      setLines(r.lines.map((l) => ({ item_id: l.ITEMID, item_code: l.ITEMCODE, item_name: l.ITEMNAME, uom_id: l.UOMID, uom_code: l.UOMCODE, qty: Number(l.PBQty), rate: Number(l.PBRate) })))
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setVoucher(r.voucher || null)
      setViewNo(h.PrintPBNO || h.PBNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that bill', color: 'red' })
    }
  }
  async function findBills(q) {
    const rows = await inventoryApi.listPurchaseBills({ top: 200 })
    const t = (q || '').toLowerCase()
    return rows
      .filter((r) => !t || String(r.PrintPBNO).toLowerCase().includes(t) || String(r.PartyName || '').toLowerCase().includes(t))
      .map((r) => ({ id: r.PBID, label: r.PrintPBNO, sub: `${r.PartyName || ''} · ${formatINR(r.PBVALUE)}` }))
  }
  async function onDelete() {
    if (!viewId) return
    if (!(await confirm({ title: 'Delete this purchase bill?', message: `Bill ${viewNo} and the stock it brought in will be removed.`, confirmLabel: 'Delete' }))) return
    try {
      await inventoryApi.deletePurchaseBill(viewId)
      notifications.show({ message: 'Deleted Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
      refetch()
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete', color: 'red' })
    }
  }

  // mode 'save' = just save (the preview opens only from Print / Options); 'print' = save and print at once (F10)
  async function onSave(mode = 'save') {
    if (readOnly) return
    setAttempted(true)
    const firstErr = Object.values(headErrors)[0] || (!form.supp_id ? 'Supplier is mandatory' : null) || (!lines.length ? 'Please add at least one item line' : null)
    if (firstErr) {
      notifications.show({ title: 'Cannot save yet', message: firstErr, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        supp_id: Number(form.supp_id),
        fields: fieldsPayload(),
        doc_date: isoDate(form.doc_date),
        lines: lines.map((l) => ({ item_id: Number(l.item_id), uom_id: Number(l.uom_id), qty: Number(l.qty), rate: Number(l.rate) })),
      }
      if (editing && viewId) {
        const done = await inventoryApi.updatePurchaseBill(viewId, body)
        setLastSaved(done)
        notifications.show({ message: 'Changes saved successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
        refetch()
        await viewRecord(viewId)
        if (mode === 'print') directPrint(viewId)
        return
      }
      const result = await inventoryApi.createPurchaseBill(body)
      setLastSaved(result)
      if (mode === 'print') directPrint(result.pb_id)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
      refetch()
      refetchNextNo()
      // the saved bill stays on screen (read-only) so it can be checked before printing; New starts the next one
      await viewRecord(result.pb_id)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'purchase bill' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave('save'),
    onNew: () => (viewId || idle) && startNew(),
    onEdit: () => viewId && !editing && startEdit(),
    onPrint: () => lastSaved && setPrintFor(lastSaved.pb_id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : !idle && onSave('print')),
  })

  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Purchase Bill" subtitle="Record items received from a supplier" right={<DocNoDate docId={DOC_ID} viewNo={viewId ? viewNo : ''} date={form.doc_date} onDate={(v) => set('doc_date', v)} dateDisabled={readOnly} />} />

      <EntryLayout
        main={
          <Stack gap="md">
            {/* top strip: bill no / date / supplier / Doc Details */}
            <div style={{ border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', borderRadius: 16, padding: 12 }}>
              <Group gap="sm" align="flex-end" wrap="wrap">
                <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                  <MasterOptionsSelect docId={SUPPLIER_DOC_ID} label="Supplier" required value={form.supp_id} onChange={(v) => set('supp_id', v)} disabled={readOnly} />
                </div>
                <Button variant="default" leftSection={<SlidersHorizontal size={15} />} rightSection={detailsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />} onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen}>
                  Doc Details
                </Button>
              </Group>
              <Collapse in={detailsOpen}>
                <div style={{ marginTop: 12, maxHeight: 320, overflow: 'auto', border: '1px solid var(--vt-line)', borderRadius: 12, padding: 12, background: 'var(--vt-sandal)' }}>
                  <DocFieldsForm docId={DOC_ID} section="Header" values={values} setValue={setValue} setValues={setValues} resetKey={resetKey} seedDefaults={!idle} errors={attempted ? headErrors : {}} skip={COMPUTED_CODES} readOnly={readOnly} />
                  <DocFieldsForm docId={DOC_ID} section="Footer" values={values} setValue={setValue} setValues={setValues} resetKey={resetKey} seedDefaults={!idle} errors={attempted ? headErrors : {}} skip={COMPUTED_CODES} readOnly={readOnly} />
                </div>
              </Collapse>
            </div>

            {/* line items */}
            <div style={{ border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', borderRadius: 16, overflow: 'hidden' }}>
              <Group justify="space-between" p="sm" wrap="wrap" gap="xs" style={{ borderBottom: '1px solid var(--vt-line)' }}>
                <Group gap={8} wrap="wrap">
                  <Text fw={700}>Purchase Bill Line Items</Text>
                  <Badge variant="light" color="kumkum" tt="none">Items: {lines.length}</Badge>
                  <Badge variant="light" color="gold" c="var(--vt-badge-ink)" tt="none">Total Qty: {totalQty.toLocaleString('en-IN')}</Badge>
                  <Badge variant="light" color="teal" tt="none">Net: {formatINR(totalValue)}</Badge>
                </Group>
                {!readOnly && (
                  <Tooltip label="Select the supplier first" disabled={Boolean(form.supp_id)} withArrow>
                    <Button color="kumkum" leftSection={<Plus size={16} />} disabled={!form.supp_id} data-disabled={!form.supp_id || undefined} onClick={() => form.supp_id && setDialog({ open: true, index: null })}>
                      Add Item
                    </Button>
                  </Tooltip>
                )}
              </Group>
              <div style={{ overflow: 'auto', maxHeight: '45vh' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: 640 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--vt-sandal)', zIndex: 1 }}>
                    <tr>
                      <th style={{ ...th, width: 40 }}>#</th>
                      <th style={th}>Item code</th>
                      <th style={th}>Item name</th>
                      <th style={th}>UOM</th>
                      <th style={{ ...th, textAlign: 'right' }}>{caption('PBQTY', 'Qty')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{caption('PBRATE', 'Rate')}</th>
                      <th style={{ ...th, textAlign: 'right' }}>{caption('PBAMT', 'Amount')}</th>
                      {!readOnly && <th style={{ ...th, width: 84 }} aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} style={{ background: i % 2 ? 'var(--vt-sandal)' : undefined }}>
                        <td style={td}>{i + 1}</td>
                        <td style={{ ...td, color: 'var(--vt-accent)', fontWeight: 600 }}>{l.item_code}</td>
                        <td style={td}>{l.item_name}</td>
                        <td style={td}>{l.uom_code}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="vt-num">{Number(l.qty).toLocaleString('en-IN')}</td>
                        <td style={{ ...td, textAlign: 'right' }} className="vt-num">{Number(l.rate).toFixed(2)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="vt-num">{formatINR((Number(l.qty) || 0) * (Number(l.rate) || 0))}</td>
                        {!readOnly && (
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
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lines.length === 0 && (
                  <Text size="sm" c="dimmed" ta="center" py="xl">
                    No line items added yet. Click <b>Add Item</b> to start.
                  </Text>
                )}
              </div>
            </div>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: 'Lines', value: lines.length },
                { label: 'Total qty', value: totalQty.toLocaleString('en-IN') },
                ...(viewId && voucher ? [{ label: 'Purchase Voucher', value: voucher.print_no || voucher.no }] : []),
              ]}
              totalLabel="Bill value"
              total={formatINR(totalValue)}
              words={totalValue}
              saveLabel="Save"
              saveIcon={Save}
              saving={saving}
              onSave={() => onSave('save')}
              saveDisabled={readOnly}
              hideActions // Save lives in the ribbon below (no separate Save & Print)
            />
            {lastSaved && <SavedPanel lines={[`Bill ${lastSaved.pb_no}`, ...(lastSaved.voucher_no ? [`Purchase Voucher ${lastSaved.voucher_no} generated`] : [])]} onPrint={() => setPrintFor(lastSaved.pb_id)} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent bills"
              icon={Receipt}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No purchase bills yet"
              emptyHint="Saved documents will be listed here."
              renderRow={(r) => ({ key: r.PBID, title: r.PrintPBNO, subtitle: `${r.PartyName} · ${formatINR(r.PBVALUE)}` })}
              onLoad={viewRecord}
            />
          </>
        }
      />

      <AddLineItemDialog
        opened={dialog.open}
        onClose={() => setDialog({ open: false, index: null })}
        onAdd={onLineSaved}
        initial={dialog.index == null ? null : lines[dialog.index]}
        locId={values.LOCID}
        qtyCaption={caption('PBQTY', 'Quantity')}
        rateCaption={caption('PBRATE', 'Rate')}
      />

      <DocNavBar
        docId={DOC_ID}
        currentId={viewId}
        viewLabel={viewNo}
        lastSaved={lastSaved ? { id: lastSaved.pb_id, label: lastSaved.pb_no } : null}
        onLoad={viewRecord}
        onNew={startNew}
        showNew={Boolean(viewId) && !editing}
        entryMode={!viewId && !idle}
        newOnly={idle}
        cancelEditLabel="Cancel"
        onCancelEntry={cancelEntry}
        onDelete={onDelete}
        onClose={() => navigate('/')}
        onEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={() => onSave('save')}
        onPrint={() => printWithFormat(pickFormat(printFormats))}
        printFormats={printFormats}
        onPrintFormat={printWithFormat}
        saving={saving}
        editing={editing}
        search={findBills}
      />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Purchase Bill" initialOption={printOption} />
    </Stack>
  )
}
