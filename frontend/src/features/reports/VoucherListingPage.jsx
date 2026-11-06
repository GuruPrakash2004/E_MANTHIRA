import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Group, MultiSelect, Select, Skeleton, Stack, Switch, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { Info, ListChecks, Play } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/accReports'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { formatINR, isoDate } from '../../utils/format'

/**
 * Voucher Listing (legacy frmRptVoucherList): the detail lines of one voucher document with optional date range, ledgers,
 * prefix and any header fields. The voucher types and names, prefixes, field list and captions, and the default dates all
 * come from the database through the server; nothing is typed into this screen. Cancelled vouchers are shown struck through
 * and are not added into the totals.
 */
export default function VoucherListingPage() {
  const [type, setType] = useState(null)
  const [docId, setDocId] = useState(null)
  const [useRange, setUseRange] = useState(true)
  const [range, setRange] = useState({ from: null, to: null })
  const [prefix, setPrefix] = useState(null)
  const [ledgers, setLedgers] = useState([]) // [{ value, label }]
  const [fields, setFields] = useState([])
  const [dayTot, setDayTot] = useState(false)
  const [monthTot, setMonthTot] = useState(false)
  const [ledQ, setLedQ] = useState('')
  const [dq] = useDebouncedValue(ledQ, 250)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)

  const { data: opts, isLoading } = useQuery({ queryKey: ['vl-options'], queryFn: api.voucherListingOptions })
  const { data: info } = useQuery({ queryKey: ['vl-doc', docId], queryFn: () => api.voucherListingDoc(docId), enabled: Boolean(docId) })
  const { data: found = [] } = useQuery({ queryKey: ['vl-ledgers', dq], queryFn: () => api.voucherListingLedgers(dq), enabled: Boolean(opts?.available) })

  const cap = opts?.captions || {}
  const from = range.from || (opts?.fy ? new Date(opts.fy.from) : null)
  const to = range.to || (opts?.fy ? new Date(opts.fy.to) : null)
  const ledgerOptions = useMemo(() => {
    const m = new Map(ledgers.map((l) => [l.value, l]))
    found.forEach((l) => m.set(String(l.id), { value: String(l.id), label: l.name }))
    return [...m.values()]
  }, [found, ledgers])
  const docs = opts?.types.find((t) => t.type === type)?.docs || []

  async function run() {
    if (!docId) return notifications.show({ message: `Choose the ${cap.name}`, color: 'red' })
    setRunning(true)
    try {
      setResult(
        await api.runVoucherListing({
          doc_id: Number(docId),
          start: useRange && from ? isoDate(from) : null,
          end: useRange && to ? isoDate(to) : null,
          ledger_ids: ledgers.map((l) => Number(l.value)),
          prefix: prefix || '',
          fields,
        }),
      )
    } catch (e) {
      notifications.show({ title: 'Could not run the report', message: e?.response?.data?.detail || 'Failed', color: 'red' })
    } finally {
      setRunning(false)
    }
  }

  // result rows with the day / month subtotal rows the user asked for, built from the server's totals
  const display = useMemo(() => {
    if (!result) return []
    const dayOf = Object.fromEntries(result.by_day.map((d) => [d.key, d]))
    const monthOf = Object.fromEntries(result.by_month.map((d) => [d.key, d]))
    const out = []
    result.rows.forEach((r, i) => {
      out.push({ kind: 'row', r })
      const nxt = result.rows[i + 1]
      if (dayTot && (!nxt || nxt.date !== r.date)) out.push({ kind: 'day', label: dayjs(r.date).format('DD/MM/YYYY'), t: dayOf[r.date] || { dr: 0, cr: 0 } })
      if (monthTot && (!nxt || nxt.month !== r.month)) out.push({ kind: 'month', label: r.month, t: monthOf[r.month] || { dr: 0, cr: 0 } })
    })
    return out
  }, [result, dayTot, monthTot])
  const rc = result?.captions || {}
  const fieldCols = fields

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={opts?.title || ' '}
        subtitle={result?.title || ' '}
        heading={result?.title || opts?.title || ' '}
        sub={opts?.title || ' '}
        facts={result ? [{ label: rc.dr, value: formatINR(result.total.dr) }, { label: rc.cr, value: formatINR(result.total.cr) }] : []}
        emblem={<ListChecks size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />

      {isLoading ? (
        <Skeleton height={220} radius="md" />
      ) : opts && !opts.available ? (
        <NotAvailableHere feature={opts.title} missing={['a voucher document with its header and detail tables']} />
      ) : (
        <>
          <Card withBorder p="lg">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <Select label={cap.type} w={180} placeholder="Select" data={(opts?.types || []).map((t) => t.type)} value={type} onChange={(v) => { setType(v); setDocId(null); setPrefix(null); setFields([]); setResult(null) }} />
              <Select label={cap.name} w={220} placeholder="Select" disabled={!type} data={docs.map((d) => ({ value: String(d.doc_id), label: d.name }))} value={docId} onChange={(v) => { setDocId(v); setPrefix(null); setFields([]); setResult(null) }} />
              <Select label={cap.prefix} w={140} placeholder="All" clearable disabled={!info?.prefixes?.length} data={info?.prefixes || []} value={prefix} onChange={setPrefix} />
              <Switch color="kumkum" label="Date range" checked={useRange} onChange={(e) => setUseRange(e.currentTarget.checked)} />
              <DateInput label="From" valueFormat="DD/MM/YYYY" w={150} disabled={!useRange} value={from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
              <DateInput label="To" valueFormat="DD/MM/YYYY" w={150} disabled={!useRange} value={to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
            </Group>
            <Group gap="sm" align="flex-end" wrap="wrap" mt="sm">
              <MultiSelect
                label={cap.ledger}
                w={420}
                searchable
                clearable
                placeholder="All ledgers"
                data={ledgerOptions}
                value={ledgers.map((l) => l.value)}
                onChange={(vals) => setLedgers(vals.map((v) => ledgerOptions.find((o) => o.value === v)).filter(Boolean))}
                searchValue={ledQ}
                onSearchChange={setLedQ}
                filter={({ options }) => options}
                nothingFoundMessage="No ledger found"
              />
              <Checkbox label="Day wise total" checked={dayTot} onChange={(e) => setDayTot(e.currentTarget.checked)} />
              <Checkbox label="Month wise total" checked={monthTot} onChange={(e) => setMonthTot(e.currentTarget.checked)} />
              <Button color="kumkum" leftSection={<Play size={16} />} loading={running} onClick={run}>View</Button>
              {result && (
                <ExportExcelButton
                  filename={`${result.title}`}
                  print={{ landscape: true }}
                  rows={result.rows}
                  columns={[
                    { label: rc.date, value: (r) => dayjs(r.date).format('DD/MM/YYYY') },
                    { label: rc.no, key: 'no' },
                    { label: rc.ledger, key: 'ledger' },
                    { label: rc.dr, key: 'dr' },
                    { label: rc.cr, key: 'cr' },
                    ...fieldCols.map((f) => ({ label: rc.fields[f], value: (r) => r.fields[f] })),
                  ]}
                />
              )}
            </Group>
            {info?.fields?.length > 0 && (
              <Stack gap={4} mt="md">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">Additional fields</Text>
                <Checkbox.Group value={fields} onChange={setFields}>
                  <Group gap="md" wrap="wrap">
                    {info.fields.map((f) => <Checkbox key={f.code} size="xs" value={f.code} label={f.caption || f.code} />)}
                  </Group>
                </Checkbox.Group>
              </Stack>
            )}
          </Card>

          {result &&
            (result.rows.length === 0 ? (
              <Card withBorder p="lg"><EmptyState icon={ListChecks} title="Nothing to list" hint="No voucher line matches these filters." /></Card>
            ) : (
              <Card withBorder p="md">
                {result.truncated && <Alert icon={<Info size={16} />} color="orange" variant="light" mb="sm">Showing the first {result.rows.length} lines; narrow the date range for the rest.</Alert>}
                <div style={{ overflow: 'auto', maxHeight: '65vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--vt-sandal)', zIndex: 1 }}>
                      <tr>
                        {[rc.date, rc.no, rc.ledger].map((h) => <th key={h} style={th}>{h}</th>)}
                        <th style={{ ...th, textAlign: 'right' }}>{rc.dr}</th>
                        <th style={{ ...th, textAlign: 'right' }}>{rc.cr}</th>
                        {fieldCols.map((f) => <th key={f} style={th}>{rc.fields[f]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {display.map((x, i) =>
                        x.kind === 'row' ? (
                          <tr key={i} style={x.r.cancelled ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                            <td className="vt-num" style={td}>{dayjs(x.r.date).format('DD/MM/YYYY')}</td>
                            <td className="vt-num" style={td}>{x.r.no}</td>
                            <td style={td}>{x.r.ledger}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{x.r.dr ? formatINR(x.r.dr) : ''}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{x.r.cr ? formatINR(x.r.cr) : ''}</td>
                            {fieldCols.map((f) => <td key={f} style={td}>{x.r.fields[f]}</td>)}
                          </tr>
                        ) : (
                          <tr key={i} style={{ background: 'var(--vt-gold-chip)', fontWeight: 700 }}>
                            <td colSpan={3} style={td}>{x.kind === 'day' ? 'Day total' : 'Month total'} - {x.label}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(x.t.dr)}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(x.t.cr)}</td>
                            {fieldCols.map((f) => <td key={f} style={td} />)}
                          </tr>
                        ),
                      )}
                      <tr style={{ background: 'var(--vt-sandal)', fontWeight: 700 }}>
                        <td colSpan={3} style={td}>Total</td>
                        <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(result.total.dr)}</td>
                        <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(result.total.cr)}</td>
                        {fieldCols.map((f) => <td key={f} style={td} />)}
                      </tr>
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

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)' }
const td = { padding: '6px 10px', borderBottom: '1px solid var(--vt-line)' }
