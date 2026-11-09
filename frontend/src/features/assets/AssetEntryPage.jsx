import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useState } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Landmark } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import PrintPickerModal from '../../components/PrintPickerModal'
import usePrintFormats from '../../hooks/usePrintFormats'
import { pickFormat } from '../../lib/printing'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as assetApi from '../../api/endpoints/assets'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import useDocFields from '../../hooks/useDocFields'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import DocNavBar from '../../components/ui/DocNavBar'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { isoDate } from '../../utils/format'

const DOC_ID = 1262
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Asset Entry (DocID 1262, TrnHdrASSET): a header-only document, drawn entirely from the temple's Doc Designer
 * (UtlDocDsgrFlds) — fields, captions, mandatory rules and "refill" suggestions are the Designer's.
 * Backend: app/services/header_doc.py.
 */
export default function AssetEntryPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')
  const [editing, setEditing] = useState(false)
  const [idle, setIdle] = useState(true) // opens empty and locked (also after Cancel) until New is pressed
  const [printFor, setPrintFor] = useState(null)
  const readOnly = (Boolean(viewId) && !editing) || idle

  const { fields } = useDocFields(DOC_ID)
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const errors = docFieldErrors(fields, values)
  const firstError = Object.values(errors)[0] || null

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['assets', 'recent'], queryFn: () => assetApi.listAssets(historyParams()) })

  async function onSave() {
    if (readOnly) return
    setAttempted(true)
    if (firstError) {
      notifications.show({ message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        Object.entries(values)
          .filter(([, v]) => v !== '' && v !== null && v !== undefined)
          .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
      )
      if (editing && viewId) {
        await assetApi.updateAsset(viewId, { fields: payload, doc_date: isoDate(docDate) })
        notifications.show({ message: 'Updated successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['assets'] })
        refetch()
        await viewRecord(viewId)
        return
      }
      const result = await assetApi.createAsset({ fields: payload, doc_date: isoDate(docDate) })
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      refetch()
      await viewRecord(result.id) // the saved entry stays on screen (read-only); New starts the next one
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function viewRecord(id) {
    try {
      const r = await assetApi.getAsset(id)
      const next = {}
      for (const f of fields) {
        const v = r[f.FldCode]
        next[f.FldCode] = v === null || v === undefined ? '' : f.FldDataType === 'Date' ? new Date(v) : f.FldBlnComboData === 'Y' ? Number(v) || '' : String(v).trim()
      }
      setValues(next)
      if (r.ASSETDate) setDocDate(new Date(r.ASSETDate))
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(r.PrintASSETNO || r.ASSETNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  async function startEdit() {
    await viewRecord(viewId) // show what is saved right now
    setEditing(true)
  }
  async function cancelEdit() {
    await viewRecord(viewId)
    setEditing(false)
  }
  async function deleteAsset() {
    if (!(await confirm({ title: 'Delete this entry?', message: `Asset ${viewNo} will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await assetApi.deleteAsset(viewId)
      notifications.show({ message: r?.message || 'Deleted Asset Entry Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      refetch()
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete the entry', color: 'red' })
    }
  }
  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setValues({}) // no resetKey bump: the Designer defaults come back only when New is pressed
    setAttempted(false)
    setLastSaved(null)
    setIdle(true)
  }
  function startNew() {
    setIdle(false)
    setEditing(false)
    setViewId(null)
    setViewNo('')
    setValues({})
    setResetKey((k) => k + 1)
    setAttempted(false)
    setDocDate(new Date())
  }
  async function findAssets(q) {
    const rows = await assetApi.listAssets({ search: q, top: 30, days: 0 })
    return rows.map((r) => ({ id: r.ASSETID, label: r.PrintASSETNO || r.ASSETNO, sub: `${r.DONORNAME || ''} ${r.CATEGORY || ''}`.trim() }))
  }

  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'asset entry' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave(),
    onNew: () => (viewId || idle) && startNew(),
    onPrint: () => viewId && printWithFormat(pickFormat(printFormats)),
  })

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Asset Entry</Title>
            <Text size="sm" c="dimmed">
              Record an asset donated to the temple
            </Text>
          </div>
        </Group>
        <DocNoDate docId={DOC_ID} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateDisabled={readOnly} />
      </Group>

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <SectionCard title="Asset details" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm
                docId={DOC_ID}
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                seedDefaults={!idle}
                errors={attempted ? errors : {}}
                readOnly={readOnly}
              />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[{ label: 'Donor', value: values.DONORNAME || '-' }]}
              totalLabel={fields.find((f) => f.FldCode === 'CSTOFASSET')?.FldCaption || 'Cost of asset'}
              total={values.CSTOFASSET ? `₹ ${Number(values.CSTOFASSET).toLocaleString('en-IN')}` : '-'}
              warning={firstError || null}
              saving={saving}
              hideActions // Save lives in the ribbon below
            />
            {lastSaved && <SavedPanel lines={[`Asset ${lastSaved.no}`]} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent assets"
              icon={Landmark}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No assets yet"
              emptyHint="Saved entries will be listed here."
              renderRow={(r) => ({ key: r.ASSETID, title: r.PrintASSETNO || r.ASSETNO, subtitle: `${r.DONORNAME || ''} ${r.CATEGORY || ''}`.trim() })}
              onLoad={viewRecord}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} showNew={Boolean(viewId) && !editing} entryMode={!viewId && !idle} newOnly={idle} cancelEditLabel="Cancel" onCancelEntry={cancelEntry} onDelete={deleteAsset} onClose={() => navigate('/')} onEdit={startEdit} onCancelEdit={cancelEdit} onSave={onSave} onPrint={() => printWithFormat(pickFormat(printFormats))} printFormats={printFormats} onPrintFormat={printWithFormat} saving={saving} editing={editing} search={findAssets} />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Asset Entry" initialOption={printOption} />
    </Stack>
  )
}
