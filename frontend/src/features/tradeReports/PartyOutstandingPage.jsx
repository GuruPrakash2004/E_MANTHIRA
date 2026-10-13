import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Group, MultiSelect, NumberInput, Radio, SegmentedControl, Stack } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Printer, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import * as tradeApi from '../../api/endpoints/tradeReports'
import * as reportsApi from '../../api/endpoints/reports'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { PageHeader } from '../../components/ui/EntryParts'
import { downloadCsv } from '../../utils/csv'
import { isoDate } from '../../utils/format'

const n2 = (v) => (v == null ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const d8 = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '')

/**
 * Customer / Supplier Outstanding (legacy FrmRptAccOSBillWise). Summary: opening balance, period debit and credit, and
 * balance per party (receivable lists customers who owe, payable suppliers we owe). Detailed: the bill-wise pending
 * list as on the To date (runs the client's own mSP_RptAccBillWisePend_* procedure). Optionally limited to chosen
 * parties, hiding balances at or below an amount.
 */
export default function PartyOutstandingPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [party, setParty] = useState(params.get('party') === 'S' ? 'S' : 'C')
  const [mode, setMode] = useState('summary')
  const fyStart = dayjs().month() >= 3 ? dayjs().month(3).startOf('month').toDate() : dayjs().subtract(1, 'year').month(3).startOf('month').toDate()
  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(new Date())
  const [minAmount, setMinAmount] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [selParty, setSelParty] = useState(false)
  const [picked, setPicked] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const receivable = party === 'C'
  const name = receivable ? 'Customer' : 'Supplier'
  const { data: accounts = [] } = useQuery({ queryKey: ['party-gl-accounts', receivable ? 'customer' : 'supplier'], queryFn: () => reportsApi.partyGlAccounts(receivable ? 'customer' : 'supplier') })

  async function view() {
    if (selParty && picked.length === 0) return notifications.show({ message: `Select the ${name.toLowerCase()}(s)`, color: 'red' })
    setLoading(true)
    try {
      const ac_ids = selParty ? picked.join(',') : undefined
      const r =
        mode === 'summary'
          ? await tradeApi.getPartyOutstanding({ party, from_date: isoDate(from), to_date: isoDate(to), receivable, min_amount: Number(minAmount) || 0, show_all_nonzero: showAll, ac_ids })
          : await tradeApi.getPartyOutstandingDetail({ party, to_date: isoDate(to), ac_ids })
      setResult({ ...r, _mode: mode, _name: name })
    } catch (e) {
      setResult(null)
      notifications.show({ message: e?.response?.data?.detail || 'Could not run the report', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  const columns = useMemo(
    () =>
      result?._mode === 'detail'
        ? [
            { key: 'party_code', label: `${result._name} Code`, width: 160 },
            { key: 'party_name', label: `${result._name} Name`, width: 240 },
            { key: 'doc_type', label: 'Doc Type', width: 100 },
            { key: 'trn_no', label: 'Doc No', width: 130 },
            { key: 'doc_ref', label: 'Doc Ref', width: 130 },
            { key: 'trn_date', label: 'Doc Date', width: 110, render: (r) => d8(r.trn_date) },
            { key: 'due_date', label: 'Due Date', width: 110, render: (r) => d8(r.due_date) },
            { key: 'doc_amt', label: 'Doc Amt', width: 120, num: true, render: (r) => n2(r.doc_amt) },
            { key: 'rcvd_amt', label: 'Rcvd Amt', width: 120, num: true, render: (r) => n2(r.rcvd_amt) },
            { key: 'balance', label: 'Balance', width: 130, num: true, render: (r) => n2(r.balance) },
          ]
        : [
            { key: 'party_code', label: `${name} Code`, width: 180 },
            { key: 'party_name', label: `${name} Name`, width: 280 },
            { key: 'opening', label: 'Opening Balance', width: 150, num: true, render: (r) => n2(r.opening) },
            { key: 'debit', label: 'Debit', width: 130, num: true, render: (r) => n2(r.debit) },
            { key: 'credit', label: 'Credit', width: 130, num: true, render: (r) => n2(r.credit) },
            { key: 'balance', label: 'Balance', width: 150, num: true, render: (r) => n2(r.balance) },
          ],
    [result, name]
  )
  const rows = useMemo(() => {
    if (!result) return []
    const base = result.rows.map((r, i) => ({ ...r, _key: i }))
    if (!base.length) return base
    const keys = result._mode === 'detail' ? ['doc_amt', 'rcvd_amt', 'balance'] : ['opening', 'debit', 'credit', 'balance']
    return [...base, { _kind: 'total', _key: 'total', party_code: 'Grand Total', ...Object.fromEntries(keys.map((k) => [k, base.reduce((t, r) => t + (r[k] || 0), 0)])) }]
  }, [result])

  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title={`${name} Wise Outstanding`} subtitle="Opening balance, period debit and credit, and what is still due" shortcuts={[]} />
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="xl" wrap="wrap" align="center">
            <Radio.Group value={mode} onChange={setMode} aria-label="Report type">
              <Group gap="md"><Radio color="kumkum" value="summary" label="Summary" /><Radio color="kumkum" value="detail" label="Detailed" /></Group>
            </Radio.Group>
            <SegmentedControl value={party} onChange={(v) => { setParty(v); setPicked([]); setResult(null) }} data={[{ label: 'Receivable (customers)', value: 'C' }, { label: 'Payable (suppliers)', value: 'S' }]} />
          </Group>
          <Group gap="md" align="flex-end" wrap="wrap">
            {mode === 'summary' && <DatePickerInput className="vt-field-required" label="For the Period from" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={160} />}
            <DatePickerInput className="vt-field-required" label={mode === 'summary' ? 'To' : 'As on'} valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={160} />
            <Button color="kumkum" leftSection={<Eye size={16} />} loading={loading} onClick={view}>View</Button>
          </Group>
          <Group gap="lg" wrap="wrap" align="flex-end">
            <Checkbox color="kumkum" label={`Select ${name}`} checked={selParty} onChange={(e) => { setSelParty(e.currentTarget.checked); setPicked([]) }} />
            {mode === 'summary' && <Checkbox color="kumkum" label="Show Excess also" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} />}
            {mode === 'summary' && <NumberInput label="Omit outstanding Amt less than or equal to" value={minAmount} onChange={setMinAmount} decimalScale={2} disabled={showAll} hideControls w={260} />}
          </Group>
          {selParty && <MultiSelect aria-label={`${name}s`} placeholder={accounts.length ? `Select ${name.toLowerCase()}s` : `No ${name.toLowerCase()} accounts in this database`} searchable clearable data={accounts.map((a) => ({ value: String(a.id), label: `${a.name} · ${a.grp}` }))} value={picked} onChange={setPicked} />}
        </Stack>
      </Card>

      {result && result.rows.length === 0 && !loading && <Alert color="gray" variant="light">No {name.toLowerCase()} outstanding. This database has no {name.toLowerCase()} accounts with postings for these options.</Alert>}
      <ScaleGrid columns={columns} rows={rows} loading={loading} emptyTitle={result ? `No ${name.toLowerCase()} outstanding` : 'Press View'} emptyHint={result ? undefined : 'Choose the options and press View.'} />

      <Group justify="space-between">
        <Group gap="sm">
          <Button variant="light" color="kumkum" leftSection={<Printer size={16} />} disabled={!rows.length} onClick={() => window.print()}>Print</Button>
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!rows.length} onClick={() => downloadCsv(`${name} Outstanding.csv`, rows, columns.map((c) => ({ label: c.label, value: (r) => (c.render ? c.render(r) : r[c.key]) })))}>Excel</Button>
        </Group>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
    </Stack>
  )
}
