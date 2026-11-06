import { useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Group, Select, Skeleton, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Info, Play } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/accReports'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { formatINR, isoDate } from '../../utils/format'

/**
 * Day Book (legacy FrmRptDayBook): vouchers in a date range with the money transfer mode, receipts and payments, subtotalled
 * per document type. Document names, the payment modes on offer and the default dates come from the database through the
 * server. Sources this database cannot supply are listed with the reason instead of being silently left out. Cancelled
 * vouchers are shown struck through and are not added into the totals.
 */
export default function DayBookPage() {
  const [range, setRange] = useState({ from: null, to: null })
  const [mode, setMode] = useState(null)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)

  const { data: opts, isLoading } = useQuery({ queryKey: ['daybook-options'], queryFn: api.dayBookOptions })
  const from = range.from || (opts?.fy ? new Date(opts.fy.from) : null)
  const to = range.to || (opts?.fy ? new Date(opts.fy.to) : null)
  const cap = result?.captions || opts?.captions || {}

  async function run() {
    if (!from || !to) return
    if (from > to) return notifications.show({ message: 'From Date should be less than To Date....', color: 'red' })
    setRunning(true)
    try {
      setResult(await api.runDayBook({ start: isoDate(from), end: isoDate(to), mode: mode || '' }))
    } catch (e) {
      notifications.show({ title: 'Could not run the report', message: e?.response?.data?.detail || 'Failed', color: 'red' })
    } finally {
      setRunning(false)
    }
  }

  const display = useMemo(() => {
    if (!result?.available) return []
    const sub = Object.fromEntries(result.groups.map((g) => [g.doc_type, g]))
    const out = []
    result.rows.forEach((r, i) => {
      out.push({ kind: 'row', r })
      const nxt = result.rows[i + 1]
      if (!nxt || nxt.doc_type !== r.doc_type) out.push({ kind: 'sub', label: r.doc_type, t: sub[r.doc_type] || { received: 0, paid: 0 } })
    })
    return out
  }, [result])

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={opts?.title || ' '}
        subtitle={result?.available ? `${dayjs(result.from).format('DD-MMM-YYYY')} - ${dayjs(result.to).format('DD-MMM-YYYY')}` : ' '}
        heading={opts?.title || ' '}
        sub={opts?.title || ' '}
        facts={result?.available ? [{ label: cap.received, value: formatINR(result.total.received) }, { label: cap.paid, value: formatINR(result.total.paid) }] : []}
        emblem={<BookOpen size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />

      {isLoading ? (
        <Skeleton height={160} radius="md" />
      ) : opts && !opts.available ? (
        <NotAvailableHere feature={opts.title} missing={opts.skipped.map((s) => s.reason)} />
      ) : (
        <>
          <Card withBorder p="lg">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <DateInput label={cap.from} valueFormat="DD/MM/YYYY" w={160} value={from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
              <DateInput label={cap.to} valueFormat="DD/MM/YYYY" w={160} value={to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
              <Select label={cap.mode} w={180} placeholder="All" clearable data={opts?.modes || []} value={mode} onChange={setMode} />
              <Button color="kumkum" leftSection={<Play size={16} />} loading={running} onClick={run}>View</Button>
              {result?.available && (
                <ExportExcelButton
                  filename={opts.title}
                  print={{ period: `${dayjs(from).format('DD/MM/YYYY')} to ${dayjs(to).format('DD/MM/YYYY')}`, filters: mode ? `${cap.mode}: ${mode}` : '' }}
                  rows={result.rows}
                  columns={[
                    { label: cap.doc_type, key: 'doc_type' },
                    { label: cap.no, key: 'no' },
                    { label: cap.date, value: (r) => dayjs(r.date).format('DD/MM/YYYY') },
                    { label: cap.party, key: 'party' },
                    { label: cap.amount, key: 'amount' },
                    { label: cap.mode, key: 'mode' },
                    { label: cap.received, key: 'received' },
                    { label: cap.paid, key: 'paid' },
                  ]}
                />
              )}
            </Group>
            {(opts?.skipped || []).length > 0 && (
              <Alert icon={<Info size={16} />} color="gray" variant="light" mt="md" title="Not included in this database">
                {opts.skipped.map((s) => <Text key={s.label} size="xs">{s.label}: {s.reason}</Text>)}
              </Alert>
            )}
          </Card>

          {result?.available &&
            (result.rows.length === 0 ? (
              <Card withBorder p="lg"><EmptyState icon={BookOpen} title="Nothing in this range" hint="No voucher falls between these dates." /></Card>
            ) : (
              <Card withBorder p="md">
                <div style={{ overflow: 'auto', maxHeight: '65vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--vt-sandal)', zIndex: 1 }}>
                      <tr>
                        {[cap.doc_type, cap.no, cap.date, cap.party].map((h) => <th key={h} style={th}>{h}</th>)}
                        <th style={{ ...th, textAlign: 'right' }}>{cap.amount}</th>
                        <th style={th}>{cap.mode}</th>
                        <th style={{ ...th, textAlign: 'right' }}>{cap.received}</th>
                        <th style={{ ...th, textAlign: 'right' }}>{cap.paid}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {display.map((x, i) =>
                        x.kind === 'row' ? (
                          <tr key={i} style={x.r.cancelled ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                            <td style={td}>{x.r.doc_type}{x.r.cancelled && <Badge ml={6} size="xs" color="red" variant="light">Cancelled</Badge>}</td>
                            <td className="vt-num" style={td}>{x.r.no}</td>
                            <td className="vt-num" style={td}>{dayjs(x.r.date).format('DD/MM/YYYY')}</td>
                            <td style={td}>{x.r.party}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(x.r.amount)}</td>
                            <td style={td}>{x.r.mode}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{x.r.received ? formatINR(x.r.received) : ''}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{x.r.paid ? formatINR(x.r.paid) : ''}</td>
                          </tr>
                        ) : (
                          <tr key={i} style={{ background: 'var(--vt-gold-chip)', fontWeight: 700 }}>
                            <td colSpan={6} style={td}>{x.label}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(x.t.received)}</td>
                            <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(x.t.paid)}</td>
                          </tr>
                        ),
                      )}
                      <tr style={{ background: 'var(--vt-sandal)', fontWeight: 700 }}>
                        <td colSpan={6} style={td}>Total</td>
                        <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(result.total.received)}</td>
                        <td className="vt-num" style={{ ...td, textAlign: 'right' }}>{formatINR(result.total.paid)}</td>
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
