import { historyParams } from '../../lib/history'
import DocNoDate from '../../components/ui/DocNoDate'
import { useState } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Landmark } from 'lucide-react'
import { notifications } from '@mantine/notifications'
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
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [docDate, setDocDate] = useState(new Date())
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [viewId, setViewId] = useState(null)
  const [viewNo, setViewNo] = useState('')

  const { fields } = useDocFields(DOC_ID)
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const errors = docFieldErrors(fields, values)
  const firstError = Object.values(errors)[0] || null

  const { data: recent, isLoading: recentLoading } = useQuery({ queryKey: ['assets', 'recent'], queryFn: () => assetApi.listAssets(historyParams()) })

  async function onSave() {
    if (viewId) return
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
      const result = await assetApi.createAsset({ fields: payload, doc_date: isoDate(docDate) })
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues({})
      setResetKey((k) => k + 1)
      setAttempted(false)
      queryClient.invalidateQueries({ queryKey: ['assets'] })
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
      setViewId(id)
      setViewNo(r.PrintASSETNO || r.ASSETNO)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not open that record', color: 'red' })
    }
  }
  function startNew() {
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

  useDocShortcuts({ onSave: () => onSave() })

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
        <DocNoDate docId={DOC_ID} viewNo={viewId ? viewNo : ''} date={docDate} onDate={setDocDate} dateDisabled={Boolean(viewId)} />
      </Group>

      <EntryLayout
        viewing={Boolean(viewId)}
        main={
          <Stack gap="lg">
            <SectionCard title="Asset details" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm
                docId={DOC_ID}
                values={values}
                setValue={setValue}
                setValues={setValues}
                resetKey={resetKey}
                errors={attempted ? errors : {}}
                readOnly={Boolean(viewId)}
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
              saveLabel="Save"
              saving={saving}
              saveDisabled={Boolean(viewId)}
              onSave={onSave}
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
            />
          </>
        }
      />

      <DocNavBar docId={DOC_ID} currentId={viewId} viewLabel={viewNo} onLoad={viewRecord} onNew={startNew} search={findAssets} />
    </Stack>
  )
}
