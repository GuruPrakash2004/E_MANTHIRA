import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useEffect, useState } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { Users } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as groupApi from '../../api/endpoints/groupSevaDoc'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import PrintPickerModal from '../../components/PrintPickerModal'
import useDocFields from '../../hooks/useDocFields'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import useDirectPrint from '../../hooks/useDirectPrint'
import usePrintFormats from '../../hooks/usePrintFormats'
import DocNavBar from '../../components/ui/DocNavBar'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { handleAfterSave, pickFormat } from '../../lib/printing'
import { isoDate } from '../../utils/format'

const DOC_ID = 1264
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const errorText = (err, fallback) => err?.response?.data?.detail || fallback

/**
 * Group Seva (DocID 1264): a saved group of devotees booked for a seva together. Its header (name, mobile) and the
 * member grid (sannidhi, seva, sevakarthru, nakshatra, gothra, rashi ...) are drawn entirely from the temple's Doc
 * Designer. Entries are later turned into Seva Entries with "Group Seva" on the Seva screen.
 * Backend: app/services/header_detail_doc.py.
 * The ribbon works like Seva Entry's: opens locked until New, Save / Cancel while entering, then the saved group stays on screen
 * read-only with New / Edit / Delete / Print / Close / List / Options (print formats) and the record arrows.
 */
export default function GroupSevaDocPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [printFor, setPrintFor] = useState(null)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')
  const [editing, setEditing] = useState(false) // a saved group opened for changes (Edit in the ribbon)
  const [idle, setIdle] = useState(true) // the screen opens empty and locked (also after Cancel) until New is pressed
  const readOnly = (Boolean(viewId) && !editing) || idle

  const { fields } = useDocFields(DOC_ID)
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))

  useEffect(() => {
    if (fields.length && lines.length === 0 && !viewId && !idle) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length, viewId, idle])

  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError = Object.values(headErrors)[0] || Object.values(Object.values(lineErrors)[0] || {})[0] || null

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['group-seva-docs', 'recent'], queryFn: () => groupApi.listGroups(historyParams()) })

  async function onSave(mode) {
    setAttempted(true)
    if (firstError) {
      notifications.show({ title: 'Cannot save yet', message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v]))
      const body = { fields: clean(values), lines: lines.map(clean), doc_date: isoDate(docDate) }
      if (editing && viewId) {
        const done = await groupApi.updateGroup(viewId, body)
        setLastSaved(done)
        notifications.show({ message: 'Changes saved successfully!', color: 'teal' })
        setAttempted(false)
        queryClient.invalidateQueries({ queryKey: ['group-seva-docs'] })
        queryClient.invalidateQueries({ queryKey: ['group-seva-groups'] })
        refetch()
        await viewRecord(viewId)
        if (mode === 'print') directPrint(viewId)
        return
      }
      const result = await groupApi.createGroup(body)
      setLastSaved(result)
      // Save only saves (the preview opens from Print / the Options menu); F10 = save and print at once
      if (mode === 'print') directPrint(result.id)
      else if (mode !== 'save') handleAfterSave({ docId: DOC_ID, recordId: result.id, openDialog: setPrintFor })
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['group-seva-docs'] })
      queryClient.invalidateQueries({ queryKey: ['group-seva-groups'] })
      refetch()
      // the saved group stays on screen (read-only) so it can be checked before printing; New starts the next one
      await viewRecord(result.id)
    } catch (err) {
      notifications.show({ title: 'Save failed', message: errorText(err, 'Save failed'), color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function viewRecord(id) {
    try {
      const r = await groupApi.getGroup(id)
      const next = {}
      for (const f of fields) {
        if (f.FldSection === 'Detail') continue
        const v = r[f.FldCode]
        next[f.FldCode] = v === null || v === undefined ? '' : f.FldDataType === 'Date' ? new Date(v) : f.FldBlnComboData === 'Y' ? Number(v) || '' : String(v).trim()
      }
      setValues(next)
      setLines(
        (r.lines || []).map((l) =>
          Object.fromEntries(
            fields
              .filter((f) => f.FldSection === 'Detail')
              .map((f) => [f.FldCode, l[f.FldCode] === null || l[f.FldCode] === undefined ? '' : f.FldBlnComboData === 'Y' ? Number(l[f.FldCode]) || '' : String(l[f.FldCode]).trim()])
          )
        )
      )
      if (r.GRPSEVADate) setDocDate(new Date(r.GRPSEVADate))
      setIdle(false) // a record is open: leave the "cancelled, nothing open" state
      setViewId(id)
      setEditing(false)
      setViewNo(r.PrintGRPSEVANO || r.GRPSEVANO)
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not open that record'), color: 'red' })
    }
  }
  function startNew() {
    setIdle(false)
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setValues({})
    setLines([])
    setResetKey((k) => k + 1) // re-applies the Designer defaults
    setAttempted(false)
    setDocDate(new Date())
  }
  // Cancel a new entry: an empty, locked form with only New in the ribbon
  async function cancelEntry(silent) {
    if (!idle && silent !== true && !(await confirm({ title: 'Discard this entry?', message: 'What you have typed will be cleared.', confirmLabel: 'Discard' }))) return
    setViewId(null)
    setEditing(false)
    setViewNo('')
    setValues({}) // no resetKey bump here: the Designer defaults come back only when New is pressed
    setLines([])
    setAttempted(false)
    setLastSaved(null)
    setIdle(true)
  }
  async function deleteGroup() {
    if (!(await confirm({ title: 'Delete this group?', message: `Group ${viewNo} and its members will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const r = await groupApi.deleteGroup(viewId)
      notifications.show({ message: r?.message || 'Deleted Group Seva Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['group-seva-docs'] })
      queryClient.invalidateQueries({ queryKey: ['group-seva-groups'] })
      refetch()
      setLastSaved(null)
      cancelEntry(true) // back to the locked, empty screen (not a new entry)
    } catch (err) {
      notifications.show({ message: errorText(err, 'Could not delete the group'), color: 'red' })
    }
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
  async function findGroups(q) {
    const rows = await groupApi.listGroups({ search: q, top: 30, days: 0 })
    return rows.map((r) => ({ id: r.GRPSEVAID, label: r.PrintGRPSEVANO || r.GRPSEVANO, sub: `${r.NAME || ''} ${r.MOBNO || ''}`.trim() }))
  }

  const directPrint = useDirectPrint(DOC_ID, setPrintFor)
  const { printFormats, printWithFormat, printOption, clearPrintOption } = usePrintFormats(DOC_ID, { viewId, setPrintFor, noun: 'group' })
  useDocShortcuts({
    onSave: () => !idle && (!viewId || editing) && onSave('save'),
    onNew: () => (viewId || idle) && startNew(),
    onEdit: () => viewId && !editing && startEdit(),
    onPrint: () => lastSaved && setPrintFor(lastSaved.id),
    onDirectPrint: () => (viewId ? directPrint(viewId) : !idle && onSave('print')),
  })

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Group Seva</Title>
            <Text size="sm" c="dimmed">
              Save a group of devotees and the sevas they are booked for
            </Text>
          </div>
        </Group>
        <DocNoDate docId={DOC_ID} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateDisabled={readOnly} />
      </Group>

      <EntryLayout
        viewing={readOnly}
        main={
          <Stack gap="lg">
            <SectionCard title="Group" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm docId={DOC_ID} values={values} setValue={setValue} setValues={setValues} resetKey={resetKey} seedDefaults={!idle} errors={attempted ? headErrors : {}} readOnly={readOnly} />
            </SectionCard>
            <SectionCard title="Members" hint="One line per devotee and seva.">
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} readOnly={readOnly} />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[...(viewId ? [{ label: editing ? 'Editing group no' : 'Group no', value: viewNo }] : []), { label: 'Members', value: lines.length }]}
              totalLabel="Group"
              total={values.NAME || '-'}
              warning={readOnly ? null : firstError || null}
              saving={saving}
              saveDisabled={readOnly}
              onSave={() => onSave('save')}
              hideActions // Save lives in the ribbon below
            />
            {lastSaved && <SavedPanel lines={[`Group ${lastSaved.no}`]} onPrint={() => setPrintFor(lastSaved.id)} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent groups"
              icon={Users}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No groups yet"
              emptyHint="Saved groups will be listed here."
              renderRow={(r) => ({ key: r.GRPSEVAID, title: r.PrintGRPSEVANO || r.GRPSEVANO, subtitle: `${r.NAME || ''} ${r.MOBNO || ''}`.trim(), printLabel: `Print ${r.PrintGRPSEVANO || r.GRPSEVANO}`, onPrint: () => setPrintFor(r.GRPSEVAID) })}
              onLoad={viewRecord}
            />
          </>
        }
      />

      <DocNavBar
        docId={DOC_ID}
        currentId={viewId}
        viewLabel={viewNo}
        lastSaved={lastSaved ? { id: lastSaved.id, label: lastSaved.no } : null}
        onLoad={viewRecord}
        onNew={startNew}
        showNew={Boolean(viewId) && !editing}
        entryMode={!viewId && !idle}
        newOnly={idle}
        cancelEditLabel="Cancel"
        onCancelEntry={cancelEntry}
        onDelete={deleteGroup}
        onClose={() => navigate('/')}
        onEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={() => onSave('save')}
        onPrint={() => printWithFormat(pickFormat(printFormats))}
        printFormats={printFormats}
        onPrintFormat={printWithFormat}
        saving={saving}
        editing={editing}
        search={findGroups}
      />
      <PrintPickerModal opened={Boolean(printFor)} onClose={() => { setPrintFor(null); clearPrintOption() }} docId={DOC_ID} recordId={printFor} title="Group Seva" initialOption={printOption} />
    </Stack>
  )
}
