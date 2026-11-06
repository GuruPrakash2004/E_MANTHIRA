import { useState } from 'react'
import { Alert, Button, Card, Group, Select, Skeleton, Stack } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { Info, Play, TrendingUp } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/accReports'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { formatINR, isoDate } from '../../utils/format'

/**
 * Profit Margin (legacy frmRptProfitMargin). The report types, their rate type, and every column heading come from the
 * database: the type list is `UtlProfitMargin`, the columns are whatever the definition's rows name (`UtlProfitDtlFlds`).
 * Nothing about sales documents is typed into this screen.
 */
export default function ProfitMarginPage() {
  const [docId, setDocId] = useState(null)
  const [range, setRange] = useState({ from: null, to: null })
  const [itemQ, setItemQ] = useState('')
  const [dq] = useDebouncedValue(itemQ, 250)
  const [item, setItem] = useState(null)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)

  const { data: defs, isLoading } = useQuery({ queryKey: ['pm-defs'], queryFn: api.profitMarginDefinitions })
  const { data: items = [] } = useQuery({ queryKey: ['pm-items', dq], queryFn: () => api.profitMarginItems(dq), enabled: Boolean(defs?.available) })
  const from = range.from || (defs?.fy ? new Date(defs.fy.from) : null)
  const to = range.to || (defs?.fy ? new Date(defs.fy.to) : null)

  async function run() {
    if (!docId) return notifications.show({ message: 'Choose the report type', color: 'red' })
    setRunning(true)
    try {
      setResult(await api.runProfitMargin({ doc_id: Number(docId), start: isoDate(from), end: isoDate(to), item_id: item ? Number(item) : null }))
    } catch (e) {
      notifications.show({ title: 'Could not run the report', message: e?.response?.data?.detail || 'Failed', color: 'red' })
    } finally {
      setRunning(false)
    }
  }
  const cols = result?.columns || []
  const cell = (c, v) => (v == null || v === '' ? '' : c.type === 'number' ? formatINR(v, { decimals: 2 }).replace('₹ ', '') : c.key === 'date' ? dayjs(v).format('DD/MM/YYYY') : String(v))

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={defs?.title || ' '}
        subtitle={result?.available ? result.type : ' '}
        heading={result?.type || defs?.title || ' '}
        sub={defs?.title || ' '}
        facts={result?.available && result.totals.DifferenceValue != null ? [{ label: 'DifferenceValue', value: formatINR(result.totals.DifferenceValue) }] : []}
        emblem={<TrendingUp size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />
      {isLoading ? (
        <Skeleton height={160} radius="md" />
      ) : defs && !defs.available ? (
        <NotAvailableHere feature={defs.title} missing={defs.missing} />
      ) : !defs?.defined ? (
        <Card withBorder p="lg"><EmptyState icon={TrendingUp} title="No report type is defined" hint="Profit Margin reports are designed in the legacy designer (UtlProfitMargin). None exists in this database." /></Card>
      ) : (
        <>
          <Card withBorder p="lg">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <Select label="Type" w={240} placeholder="Select" data={defs.types.map((t) => ({ value: String(t.doc_id), label: t.name }))} value={docId} onChange={(v) => { setDocId(v); setResult(null) }} />
              <DateInput label="From" valueFormat="DD/MM/YYYY" w={150} value={from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
              <DateInput label="To" valueFormat="DD/MM/YYYY" w={150} value={to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
              <Select label="Item" w={300} placeholder="All items" clearable searchable data={items.map((i) => ({ value: String(i.id), label: `${i.code} - ${i.name}` }))} value={item} onChange={setItem} searchValue={itemQ} onSearchChange={setItemQ} filter={({ options }) => options} nothingFoundMessage="No item found" />
              <Button color="kumkum" leftSection={<Play size={16} />} loading={running} onClick={run}>Load</Button>
              {result?.available && <ExportExcelButton filename={result.type} print={{ landscape: true }} rows={result.rows} columns={cols.map((c) => ({ label: c.label, value: (r) => r[c.label] }))} />}
            </Group>
          </Card>
          {result?.available &&
            (result.rows.length === 0 ? (
              <Card withBorder p="lg"><EmptyState icon={TrendingUp} title="Nothing in this range" hint="No document matches the type, dates and item." /></Card>
            ) : (
              <Card withBorder p="md">
                {result.truncated && <Alert icon={<Info size={16} />} color="orange" variant="light" mb="sm">Showing the first {result.rows.length} rows; narrow the range for the rest.</Alert>}
                <div style={{ overflow: 'auto', maxHeight: '65vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
                    <thead><tr>{cols.map((c) => <th key={c.label} style={{ ...th, textAlign: c.type === 'number' ? 'right' : 'left' }}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {result.rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.label} className={c.type === 'number' ? 'vt-num' : undefined} style={{ ...td, textAlign: c.type === 'number' ? 'right' : 'left' }}>{cell(c, r[c.label])}</td>)}</tr>)}
                      <tr style={{ background: 'var(--vt-sandal)', fontWeight: 700 }}>{cols.map((c, i) => <td key={c.label} className="vt-num" style={{ ...td, textAlign: c.type === 'number' ? 'right' : 'left' }}>{i === 0 ? 'Total' : c.type === 'number' && result.totals[c.label] != null && !['Sale Rate', 'Purchase Rate', 'Difference'].includes(c.label) ? formatINR(result.totals[c.label]).replace('₹ ', '') : ''}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
        </>
      )}
    </Stack>
  )
}

const th = { padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', position: 'sticky', top: 0, background: 'var(--vt-sandal)' }
const td = { padding: '6px 10px', borderBottom: '1px solid var(--vt-line)' }
