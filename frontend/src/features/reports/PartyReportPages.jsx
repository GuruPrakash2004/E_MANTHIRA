import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Group, NumberInput, SegmentedControl, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useSearchParams } from 'react-router-dom'
import { BellRing, Clock, Scale, Play, WalletCards } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/partyReports'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import { formatINR, isoDate } from '../../utils/format'
import { BucketEditor, FilterCard, GridBox, KindToggle, PartyFilters, ReportFrame, right, td, th, useKinds } from './PartyReportParts'

const fail = (e) => notifications.show({ title: 'Could not run the report', message: e?.response?.data?.detail || 'Failed', color: 'red' })
const initialKind = (params) => (params.get('kind') === 'payable' ? 'payable' : 'receivable')

function useRunner(fn) {
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  async function run(body) {
    setRunning(true)
    try {
      setResult(await fn(body))
    } catch (e) {
      fail(e)
    } finally {
      setRunning(false)
    }
  }
  return { result, setResult, running, run }
}

const money = (v) => (v ? formatINR(v) : '')
const dmy = (d) => (d ? dayjs(d).format('DD/MM/YYYY') : '')

/* ------------------------------------------------------------------ Party wise Outstanding */
export function PartyWiseOutstandingPage() {
  const [params] = useSearchParams()
  const { kind, setKind, opts, kinds, loading } = useKinds('party-outstanding', initialKind(params))
  const [filters, setFilters] = useState({ party_ids: [], group_ids: [] })
  const [asOn, setAsOn] = useState(new Date())
  const [dr, setDr] = useState(0)
  const [cr, setCr] = useState(0)
  const run = useRunner((b) => api.partyOutstanding(kind, b))
  const r = run.result
  const c = r?.captions || {}
  return (
    <ReportFrame opts={opts} loading={loading} result={r} emblem={<Scale size={60} color="#F4E1A6" strokeWidth={1.4} />}
      banner={{ subtitle: r?.available ? dmy(r.as_on) : ' ', facts: r?.available ? [{ label: c.debit, value: formatINR(r.total.debit) }, { label: c.credit, value: formatINR(r.total.credit) }] : [] }}>
      <FilterCard>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <KindToggle kind={kind} setKind={setKind} kinds={kinds} onChange={() => { setFilters({ party_ids: [], group_ids: [] }); run.setResult(null) }} />
          <DateInput label="As on" valueFormat="DD/MM/YYYY" w={150} value={asOn} onChange={(v) => v && setAsOn(v)} />
          <NumberInput label="Debit over" w={130} min={0} hideControls value={dr} onChange={setDr} />
          <NumberInput label="Credit over" w={130} min={0} hideControls value={cr} onChange={setCr} />
          <Button color="kumkum" leftSection={<Play size={16} />} loading={run.running} onClick={() => run.run({ as_on: isoDate(asOn), debit_over: Number(dr) || 0, credit_over: Number(cr) || 0, ...filters })}>View</Button>
        </Group>
        <PartyFilters kind={kind} opts={opts} value={filters} onChange={setFilters} />
      </FilterCard>
      {r?.available && (r.rows.length === 0 ? <Card withBorder p="lg"><EmptyState icon={Scale} title="Nothing to show" hint="No party has a balance for these filters." /></Card> : (
        <Card withBorder p="md">
          <Group justify="flex-end" mb="xs"><ExportExcelButton print={{}} filename={`${r.party_caption} party wise outstanding`} rows={r.rows} columns={[{ label: c.code, key: 'code' }, { label: c.name, key: 'name' }, { label: c.debit, key: 'debit' }, { label: c.credit, key: 'credit' }]} /></Group>
          <GridBox>
            <thead><tr><th style={th}>{c.code}</th><th style={th}>{c.name}</th><th style={{ ...th, ...right }}>{c.debit}</th><th style={{ ...th, ...right }}>{c.credit}</th></tr></thead>
            <tbody>
              {r.rows.map((x) => <tr key={x.code}><td className="vt-num" style={td}>{x.code}</td><td style={td}>{x.name}</td><td className="vt-num" style={{ ...td, ...right }}>{money(x.debit)}</td><td className="vt-num" style={{ ...td, ...right }}>{money(x.credit)}</td></tr>)}
              <tr style={{ background: 'var(--vt-sandal)', fontWeight: 700 }}><td colSpan={2} style={td}>Total</td><td className="vt-num" style={{ ...td, ...right }}>{formatINR(r.total.debit)}</td><td className="vt-num" style={{ ...td, ...right }}>{formatINR(r.total.credit)}</td></tr>
            </tbody>
          </GridBox>
        </Card>
      ))}
    </ReportFrame>
  )
}

/* ------------------------------------------------------------------ Ageing */
export function AgeingPage() {
  const [params] = useSearchParams()
  const { kind, setKind, opts, kinds, loading } = useKinds('ageing', initialKind(params))
  const [filters, setFilters] = useState({ party_ids: [], group_ids: [] })
  const [asOn, setAsOn] = useState(new Date())
  const [billwise, setBillwise] = useState(params.get('view') === 'bills')
  const [dr, setDr] = useState(0)
  const [cr, setCr] = useState(0)
  const [buckets, setBuckets] = useState(null) // null = use the database's setting
  const run = useRunner((b) => api.ageing(kind, b))
  const r = run.result
  const c = r?.captions || {}
  const shown = buckets ?? opts?.default_buckets ?? []

  return (
    <ReportFrame opts={opts} loading={loading} result={r} emblem={<Clock size={60} color="#F4E1A6" strokeWidth={1.4} />}
      banner={{ subtitle: r?.available ? dmy(r.as_on) : ' ', facts: r?.available ? [{ label: 'Total', value: formatINR(r.total.buckets.reduce((a, b) => a + b, 0) + r.total.not_due) }] : [] }}>
      <FilterCard>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <KindToggle kind={kind} setKind={setKind} kinds={kinds} onChange={() => { setFilters({ party_ids: [], group_ids: [] }); run.setResult(null); setBuckets(null) }} />
          <SegmentedControl value={billwise ? 'bills' : 'party'} onChange={(v) => setBillwise(v === 'bills')} color="kumkum" data={[{ value: 'party', label: 'Party wise' }, { value: 'bills', label: 'Bill wise' }]} />
          <DateInput label="As on" valueFormat="DD/MM/YYYY" w={150} value={asOn} onChange={(v) => v && setAsOn(v)} />
          <NumberInput label="Debit over" w={120} min={0} hideControls value={dr} onChange={setDr} />
          <NumberInput label="Credit over" w={120} min={0} hideControls value={cr} onChange={setCr} />
          <Button color="kumkum" leftSection={<Play size={16} />} loading={run.running} onClick={() => run.run({ as_on: isoDate(asOn), billwise, debit_over: Number(dr) || 0, credit_over: Number(cr) || 0, buckets: shown.filter((b) => b.from !== '' && b.from != null).map((b) => ({ from: Number(b.from), to: b.to == null || b.to === '' ? null : Number(b.to) })), party_ids: filters.party_ids, group_ids: filters.group_ids })}>View</Button>
        </Group>
        <PartyFilters kind={kind} opts={opts} value={filters} onChange={setFilters} />
        <BucketEditor value={shown} onChange={setBuckets} setting={opts?.bucket_setting} />
      </FilterCard>
      {r?.available && (r.parties.length === 0 ? <Card withBorder p="lg"><EmptyState icon={Clock} title="Nothing pending" hint="No pending bill for these filters." /></Card> : (
        <Card withBorder p="md">
          <Group justify="flex-end" mb="xs"><ExportExcelButton print={{}} filename={`${r.party_caption} ageing`} rows={r.parties} columns={[{ label: c.party_code, key: 'code' }, { label: c.party_name, key: 'name' }, ...r.labels.map((l, i) => ({ label: l, value: (p) => p.buckets[i] })), { label: c.not_due, key: 'not_due' }]} /></Group>
          <GridBox>
            <thead><tr><th style={th}>{c.party_name}</th>{r.labels.map((l) => <th key={l} style={{ ...th, ...right }}>{l}</th>)}<th style={{ ...th, ...right }}>{c.not_due}</th></tr></thead>
            <tbody>
              {r.parties.map((p) => <tr key={p.acled_id}><td style={td}>{p.code} - {p.name}</td>{p.buckets.map((v, i) => <td key={i} className="vt-num" style={{ ...td, ...right }}>{money(v)}</td>)}<td className="vt-num" style={{ ...td, ...right }}>{money(p.not_due)}</td></tr>)}
              <tr style={{ background: 'var(--vt-sandal)', fontWeight: 700 }}><td style={td}>Total</td>{r.total.buckets.map((v, i) => <td key={i} className="vt-num" style={{ ...td, ...right }}>{formatINR(v)}</td>)}<td className="vt-num" style={{ ...td, ...right }}>{formatINR(r.total.not_due)}</td></tr>
            </tbody>
          </GridBox>
          {billwise && r.bills.length > 0 && (
            <>
              <Text fw={700} mt="lg" mb="xs">Bills</Text>
              <GridBox>
                <thead><tr>{[c.party_name, c.doc_type, c.ref, c.date, c.due].map((h) => <th key={h} style={th}>{h}</th>)}<th style={{ ...th, ...right }}>{c.age}</th>{r.labels.map((l) => <th key={l} style={{ ...th, ...right }}>{l}</th>)}</tr></thead>
                <tbody>
                  {r.bills.map((b) => (
                    <tr key={b.acc_id + b.ref}><td style={td}>{b.party_code} - {b.party_name}</td><td style={td}>{b.doc_type}</td><td className="vt-num" style={td}>{b.ref}</td><td className="vt-num" style={td}>{dmy(b.date)}</td><td className="vt-num" style={td}>{dmy(b.due)}</td><td className="vt-num" style={{ ...td, ...right }}>{b.age}</td>
                      {r.labels.map((l, i) => <td key={l} className="vt-num" style={{ ...td, ...right }}>{b.bucket === i ? formatINR(b.amount) : ''}</td>)}</tr>
                  ))}
                </tbody>
              </GridBox>
            </>
          )}
        </Card>
      ))}
    </ReportFrame>
  )
}

/* ------------------------------------------------------------------ Reminder */
export function ReminderPage() {
  const [params] = useSearchParams()
  const { kind, setKind, opts, kinds, loading } = useKinds('reminder', initialKind(params))
  const [filters, setFilters] = useState({ party_ids: [], group_ids: [] })
  const [asOn, setAsOn] = useState(new Date())
  const [omit, setOmit] = useState(0)
  const run = useRunner((b) => api.reminders(kind, b))
  const r = run.result
  const c = r?.captions || {}
  const rows = (r?.parties || []).flatMap((p) => p.bills.map((b) => ({ ...b, party: `${p.code} - ${p.name}` })))
  return (
    <ReportFrame opts={opts} loading={loading} result={r} emblem={<BellRing size={60} color="#F4E1A6" strokeWidth={1.4} />}
      banner={{ subtitle: r?.available ? dmy(r.as_on) : ' ', facts: r?.available ? [{ label: c.party_name, value: r.parties.length }, { label: c.balance, value: formatINR(r.total.balance) }] : [] }}>
      <FilterCard>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <KindToggle kind={kind} setKind={setKind} kinds={kinds} onChange={() => { setFilters({ party_ids: [], group_ids: [] }); run.setResult(null) }} />
          <DateInput label="As on" valueFormat="DD/MM/YYYY" w={150} value={asOn} onChange={(v) => v && setAsOn(v)} />
          <NumberInput label="Omit parties owing less than" w={230} min={0} hideControls value={omit} onChange={setOmit} />
          <Button color="kumkum" leftSection={<Play size={16} />} loading={run.running} onClick={() => run.run({ as_on: isoDate(asOn), omit_below: Number(omit) || 0, ...filters })}>View</Button>
        </Group>
        <PartyFilters kind={kind} opts={opts} value={filters} onChange={setFilters} />
      </FilterCard>
      {r?.available && (r.parties.length === 0 ? <Card withBorder p="lg"><EmptyState icon={BellRing} title="Nobody to remind" hint="No party has a pending bill for these filters." /></Card> : (
        <Card withBorder p="md">
          <Group justify="flex-end" mb="xs"><ExportExcelButton print={{}} filename={`${r.party_caption} reminder`} rows={rows} columns={[{ label: c.party_name, key: 'party' }, { label: c.doc_type, key: 'doc_type' }, { label: c.ref, key: 'ref' }, { label: c.date, value: (x) => dmy(x.date) }, { label: c.due, value: (x) => dmy(x.due) }, { label: c.doc_amt, key: 'doc_amt' }, { label: c.adjusted, key: 'adjusted' }, { label: c.balance, key: 'balance' }, { label: c.age, key: 'age' }]} /></Group>
          {r.parties.map((p) => (
            <Card key={p.acled_id} withBorder p="sm" mb="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start" mb={6}>
                <div><Text fw={700}>{p.code} - {p.name}</Text>{p.address.length > 0 && <Text size="xs" c="dimmed">{p.address.join(', ')}</Text>}</div>
                <Text fw={700} className="vt-num">{formatINR(p.balance)}</Text>
              </Group>
              <GridBox>
                <thead><tr>{[c.doc_type, c.ref, c.date, c.due].map((h) => <th key={h} style={th}>{h}</th>)}{[c.doc_amt, c.adjusted, c.balance, c.age].map((h) => <th key={h} style={{ ...th, ...right }}>{h}</th>)}</tr></thead>
                <tbody>{p.bills.map((b) => <tr key={b.acc_id + b.ref}><td style={td}>{b.doc_type}</td><td className="vt-num" style={td}>{b.ref}</td><td className="vt-num" style={td}>{dmy(b.date)}</td><td className="vt-num" style={td}>{dmy(b.due)}</td><td className="vt-num" style={{ ...td, ...right }}>{money(b.doc_amt)}</td><td className="vt-num" style={{ ...td, ...right }}>{money(b.adjusted)}</td><td className="vt-num" style={{ ...td, ...right }}>{money(b.balance)}</td><td className="vt-num" style={{ ...td, ...right }}>{b.age}</td></tr>)}</tbody>
              </GridBox>
            </Card>
          ))}
        </Card>
      ))}
    </ReportFrame>
  )
}

/* ------------------------------------------------------------------ Generate Multi Payment Voucher (the planning half) */
export function MultiPaymentPage() {
  const opts = useQuery({ queryKey: ['party-options', 'payable', 'multi-payment'], queryFn: () => api.partyOptions('payable', 'multi-payment') })
  const [filters, setFilters] = useState({ party_ids: [], group_ids: [] })
  const [asOn, setAsOn] = useState(new Date())
  const [maxOut, setMaxOut] = useState(0)
  const [pay, setPay] = useState({}) // AcLedID -> amount
  const run = useRunner(api.paymentPlan)
  const r = run.result
  const c = r?.captions || {}
  const go = () => run.run({ as_on: isoDate(asOn), max_outstanding: Number(maxOut) || 0, payments: Object.fromEntries(Object.entries(pay).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])), ...filters })
  const rows = (r?.parties || []).flatMap((p) => p.bills.map((b) => ({ ...b, party: `${p.code} - ${p.name}` })))
  return (
    <ReportFrame opts={opts.data} loading={opts.isLoading} result={r} emblem={<WalletCards size={60} color="#F4E1A6" strokeWidth={1.4} />}
      banner={{ subtitle: r?.available ? dmy(r.as_on) : ' ', facts: r?.available ? [{ label: c.balance, value: formatINR(r.total.balance) }, { label: 'Allocated', value: formatINR(r.total.allocated) }] : [] }}>
      <FilterCard>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <DateInput label="As on" valueFormat="DD/MM/YYYY" w={150} value={asOn} onChange={(v) => v && setAsOn(v)} />
          <NumberInput label="Outstanding at most" w={170} min={0} hideControls value={maxOut} onChange={setMaxOut} />
          <Button color="kumkum" leftSection={<Play size={16} />} loading={run.running} onClick={go}>{r ? 'Adjust bills' : 'View'}</Button>
        </Group>
        <PartyFilters kind="payable" opts={opts.data} value={filters} onChange={setFilters} />
        <Text size="xs" c="dimmed">Enter an amount against a supplier and press Adjust bills: it is spread over that supplier's bills in due-date order. This is a payment plan; it does not create vouchers.</Text>
      </FilterCard>
      {r?.available && (r.parties.length === 0 ? <Card withBorder p="lg"><EmptyState icon={WalletCards} title="Nothing payable" hint="No supplier has a pending bill for these filters." /></Card> : (
        <Card withBorder p="md">
          <Group justify="flex-end" mb="xs"><ExportExcelButton print={{}} filename={`${r.party_caption} payment plan`} rows={rows} columns={[{ label: c.party_name, key: 'party' }, { label: c.doc_type, key: 'doc_type' }, { label: c.ref, key: 'ref' }, { label: c.due, value: (x) => dmy(x.due) }, { label: c.balance, key: 'balance' }, { label: 'Allocate', key: 'allocate' }]} /></Group>
          {r.parties.map((p) => (
            <Card key={p.acled_id} withBorder p="sm" mb="sm">
              <Group justify="space-between" wrap="wrap" mb={6}>
                <Text fw={700}>{p.code} - {p.name} <Text span c="dimmed" size="sm"> - {c.balance}: {formatINR(p.balance)}</Text></Text>
                <Group gap="xs">
                  <NumberInput aria-label={`Amount to pay ${p.name}`} placeholder="Amount to pay" w={160} min={0} hideControls decimalScale={2} value={pay[p.acled_id] ?? ''} onChange={(v) => setPay((x) => ({ ...x, [p.acled_id]: v }))} />
                  {p.pay > 0 && <Text size="sm" className="vt-num">allocated {formatINR(p.allocated)}{p.on_account > 0 ? ` - ${formatINR(p.on_account)} on account` : ''}</Text>}
                </Group>
              </Group>
              <GridBox>
                <thead><tr>{[c.doc_type, c.ref, c.date, c.due].map((h) => <th key={h} style={th}>{h}</th>)}{[c.balance, 'Allocate'].map((h) => <th key={h} style={{ ...th, ...right }}>{h}</th>)}</tr></thead>
                <tbody>{[...p.bills].map((b) => <tr key={b.acc_id + b.ref}><td style={td}>{b.doc_type}</td><td className="vt-num" style={td}>{b.ref}</td><td className="vt-num" style={td}>{dmy(b.date)}</td><td className="vt-num" style={td}>{dmy(b.due)}</td><td className="vt-num" style={{ ...td, ...right }}>{money(b.balance)}</td><td className="vt-num" style={{ ...td, ...right, fontWeight: 700 }}>{money(b.allocate)}</td></tr>)}</tbody>
              </GridBox>
            </Card>
          ))}
        </Card>
      ))}
    </ReportFrame>
  )
}
