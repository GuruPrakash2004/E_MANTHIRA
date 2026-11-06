import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useEffect, useState } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Users } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as groupApi from '../../api/endpoints/groupSevaDoc'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import useDocFields from '../../hooks/useDocFields'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import DocNavBar from '../../components/ui/DocNavBar'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { isoDate } from '../../utils/format'

const DOC_ID = 1264
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Group Seva (DocID 1264): a saved group of devotees booked for a seva together. Its header (name, mobile) and the
 * member grid (sannidhi, seva, sevakarthru, nakshatra, gothra, rashi ...) are drawn entirely from the temple's Doc
 * Designer. Entries are later turned into Seva Entries with "Group Seva" on the Seva screen.
 * Backend: app/services/header_detail_doc.py.
 */
export default function GroupSevaDocPage() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')

  const { fields } = useDocFields(DOC_ID)
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))

  useEffect(() => {
    if (fields.length && lines.length === 0 && !viewId) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length, viewId])

  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError = Object.values(headErrors)[0] || Object.values(Object.values(lineErrors)[0] || {})[0] || null

  const { data: recent, isLoading: recentLoading } = useQuery({ queryKey: ['group-seva-docs', 'recent'], queryFn: () => groupApi.listGroups(historyParams()) })

  async function onSave() {
    if (viewId) return
    setAttempted(true)
    if (firstError) {
      notifications.show({ message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v]))
      const result = await groupApi.createGroup({ fields: clean(values), lines: lines.map(clean), doc_date: isoDate(docDate) })
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues({})
      setLines([])
      setResetKey((k) => k + 1)
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['group-seva-docs'] })
      queryClient.invalidateQueries({ queryKey: ['group-seva-groups'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
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
      setViewId(id)
      setViewNo(r.PrintGRPSEVANO || r.GRPSEVANO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function startNew() {
    setViewId(null)
    setViewNo('')
    setValues({})
    setLines([])
    setResetKey((k) => k + 1)
    setAttempted(false)
    setDocDate(new Date())
  }
  async function findGroups(q) {
    const rows = await groupApi.listGroups({ search: q, top: 30, days: 0 })
    return rows.map((r) => ({ id: r.GRPSEVAID, label: r.PrintGRPSEVANO || r.GRPSEVANO, sub: `${r.NAME || ''} ${r.MOBNO || ''}`.trim() }))
  }

  useDocShortcuts({ onSave: () => onSave() })

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
        <DocNoDate docId={DOC_ID} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateDisabled={Boolean(viewId)} />
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <Stack gap="lg">
            <SectionCard title="Group" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm docId={DOC_ID} values={values} setValue={setValue} setValues={setValues} resetKey={resetKey} errors={attempted ? headErrors : {}} readOnly={Boolean(viewId)} />
            </SectionCard>
            <SectionCard title="Members" hint="One line per devotee and seva.">
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} readOnly={Boolean(viewId)} />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[{ label: 'Members', value: lines.length }]}
              totalLabel="Group"
              total={values.NAME || '-'}
              warning={firstError || null}
              saveLabel="Save"
              saving={saving}
              saveDisabled={Boolean(viewId)}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`Group ${lastSaved.no}`]} />}
            <RecentCard
              docId={DOC_ID}
              title="Recent groups"
              icon={Users}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No groups yet"
              emptyHint="Saved groups will be listed here."
              renderRow={(r) => ({ key: r.GRPSEVAID, title: r.PrintGRPSEVANO || r.GRPSEVANO, subtitle: `${r.NAME || ''} ${r.MOBNO || ''}`.trim() })}
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} search={findGroups} />
    </Stack>
  )
}
