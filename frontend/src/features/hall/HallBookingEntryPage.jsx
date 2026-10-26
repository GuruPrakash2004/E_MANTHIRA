import { historyParams } from '../../lib/history'
import { useEffect, useState } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { CalendarRange } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hbeApi from '../../api/endpoints/hallBookingEntry'
import useDocFields from '../../hooks/useDocFields'
import DocFieldsForm, { docFieldErrors } from '../../components/DocFieldsForm'
import DocDetailGrid, { blankLine, detailErrors } from '../../components/DocDetailGrid'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { SectionCard, EntryLayout, SummaryCard, SavedPanel, RecentCard } from '../../components/ui/EntryParts'
import { formatINR, isoDate } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { columnsFromLines, computeFormulas, withComputed } from '../../utils/docCompute'

const DOC_ID = 1280
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
// Calculated from the lines (shown in the summary), so not drawn as inputs.
const COMPUTED_CODES = ['TOTAMT', 'TOTGSTAMT', 'AMTAFTTAX', 'NETPAY', 'AMTINWORDS', 'TOTAMTIWRDS', 'ISSUEDBY']

/**
 * Hall Booking Entry (DocID 1280, table TrnHdrHBE) — a flat receipt screen, drawn entirely from the temple's
 * Doc Designer (UtlDocDsgrFlds): its Header / Footer / Total fields, and its Detail line columns.
 * See app/services/hall_booking_entry.py.
 */
export default function HallBookingEntryPage() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState({})
  const [resetKey, setResetKey] = useState(0)
  const [lines, setLines] = useState([])
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, isLoading: recentLoading, refetch } = useQuery({ queryKey: ['hbe', 'recent'], queryFn: () => hbeApi.listHbe(historyParams()) })
  const { fields } = useDocFields(DOC_ID)
  const { user } = useAuth()
  const setValue = (code, v) => setValues((cur) => ({ ...cur, [code]: v }))
  const dateCodes = new Set(fields.filter((f) => f.FldDataType === 'Date').map((f) => f.FldCode))
  const caption = (code, fallback) => fields.find((f) => f.FldCode === code)?.FldCaption || fallback
  const has = (code) => fields.some((f) => f.FldCode === code)

  useEffect(() => {
    if (fields.length && lines.length === 0) setLines([blankLine(fields)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, lines.length])

  // Totals follow the Designer's formulas (e.g. Net Pay = Amount After Tax); a temple without them gets the plain arithmetic
  const computed = computeFormulas(fields, values, columnsFromLines(lines), { userCode: user?.user_code || '', aliases: { CGSTAMT: 'CGST', SGSTAMT: 'SGST' } })
  const shown = withComputed(fields, values, computed)
  const totalAmt = Number(computed.TOTAMT ?? lines.reduce((s, l) => s + (Number(l.AMOUNT) || 0), 0))
  const totGst = Number(computed.TOTGSTAMT ?? (Number(shown.CGST) || 0) + (Number(shown.SGST) || 0))
  const netPay = Number(computed.NETPAY ?? totalAmt + totGst - (Number(values.SDEPAMT) || 0) - (Number(values.ADV) || 0))

  const headErrors = docFieldErrors(fields.filter((f) => f.FldSection !== 'Detail'), values, COMPUTED_CODES)
  const lineErrors = detailErrors(fields, lines, values)
  const firstError = Object.values(headErrors)[0] || Object.values(Object.values(lineErrors)[0] || {})[0] || (!(totalAmt > 0) ? 'Enter an amount greater than 0' : null)

  async function onSave() {
    setAttempted(true)
    if (firstError) {
      notifications.show({ message: firstError, color: 'red' })
      return
    }
    setSaving(true)
    try {
      const fieldsPayload = Object.fromEntries(
        Object.entries(values)
          .filter(([k, v]) => v !== '' && v !== null && v !== undefined && !COMPUTED_CODES.includes(k))
          .map(([k, v]) => [k, dateCodes.has(k) ? isoDate(v) : v])
      )
      const cleanLines = lines.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== '' && v !== null && v !== undefined)))
      const result = await hbeApi.createHbe({ fields: fieldsPayload, lines: cleanLines })
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setValues({})
      setLines([])
      setAttempted(false)
      setResetKey((k) => k + 1)
      queryClient.invalidateQueries({ queryKey: ['hbe'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  useDocShortcuts({ onSave })

  const common = { docId: DOC_ID, values, setValue, setValues, resetKey, errors: attempted ? headErrors : {}, computed }

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Hall Booking Entry</Title>
            <Text size="sm" c="dimmed">
              Quick receipt for hall booking, corpus fund and other venue bookings
            </Text>
          </div>
        </Group>
      </Group>

      <EntryLayout
        main={
          <Stack gap="lg">
            <SectionCard title="Booking" hint="Drawn from this temple's Doc Designer.">
              <DocFieldsForm {...common} section="Header" />
            </SectionCard>

            <SectionCard title={caption('NAMEOFHALL', 'Halls and items')} hint="One line per hall or item; the line amounts make up the total.">
              <DocDetailGrid docId={DOC_ID} rows={lines} setRows={setLines} values={values} errors={attempted ? lineErrors : {}} />
            </SectionCard>

            <SectionCard title="Payment details">
              <DocFieldsForm {...common} section="Footer" />
            </SectionCard>

            <SectionCard title="Taxes and adjustments" hint="Deposit and advance are deducted from the net.">
              <DocFieldsForm {...common} section="Total" />
            </SectionCard>
          </Stack>
        }
        side={
          <>
            <SummaryCard
              rows={[
                { label: caption('TOTAMT', 'Total amount'), value: formatINR(totalAmt) },
                ...(has('CGST') || has('SGST') ? [{ label: caption('TOTGSTAMT', 'Total GST amount'), value: formatINR(totGst) }] : []),
                ...(has('SDEPAMT') ? [{ label: caption('SDEPAMT', 'Security deposit'), value: `- ${formatINR(Number(values.SDEPAMT) || 0)}` }] : []),
                ...(has('ADV') ? [{ label: caption('ADV', 'Advance'), value: `- ${formatINR(Number(values.ADV) || 0)}` }] : []),
              ]}
              totalLabel={caption('NETPAY', 'Net pay')}
              total={formatINR(netPay)}
              words={netPay}
              warning={firstError || null}
              saveLabel="Save"
              saving={saving}
              onSave={onSave}
            />
            {lastSaved && <SavedPanel lines={[`Entry ${lastSaved.hbe_no}`]} />}
            <RecentCard
              title="Recent entries"
              icon={CalendarRange}
              loading={recentLoading}
              rows={recent || []}
              emptyTitle="No entries yet"
              emptyHint="Saved entries will be listed here."
              renderRow={(r) => ({
                key: r.HBEID,
                title: `${r.PrintHBENO}${r.TYPE ? ` · ${r.TYPE}` : ''}`,
                subtitle: `${r.NMEOFFUNC || ''} · ${formatINR(r.NETPAY)}`,
              })}
            />
          </>
        }
      />
    </Stack>
  )
}
