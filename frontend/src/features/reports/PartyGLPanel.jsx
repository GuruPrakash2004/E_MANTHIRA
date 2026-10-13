import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Group, MultiSelect, Radio, Stack } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Printer, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as reportsApi from '../../api/endpoints/reports'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { downloadCsv } from '../../utils/csv'
import { isoDate } from '../../utils/format'

const n2 = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const drcr = (v, kind) => {
  if (v == null) return ''
  const a = Math.abs(Number(v))
  if (a < 0.005) return '0.00'
  const positiveIsDr = kind !== 'supplier'
  return `${n2(a)} ${Number(v) > 0 === positiveIsDr ? 'Dr' : 'Cr'}`
}

/**
 * General Ledger (legacy FrmRptAccGL): Summary or Detail, for Suppliers, Customers or Ledgers, optionally limited to
 * chosen accounts ("Select Multiple Accounts"), hiding accounts with a zero balance. Rendered on the scalable grid.
 */
export default function PartyGLPanel() {
  const navigate = useNavigate()
  const [from, setFrom] = useState(dayjs().month() >= 3 ? dayjs().month(3).startOf('month').toDate() : dayjs().subtract(1, 'year').month(3).startOf('month').toDate())
  const [to, setTo] = useState(new Date())
  const [mode, setMode] = useState('detail')
  const [kind, setKind] = useState('supplier')
  const [multi, setMulti] = useState(false)
  const [picked, setPicked] = useState([])
  const [hideZero, setHideZero] = useState(true)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const { data: accounts = [] } = useQuery({ queryKey: ['party-gl-accounts', kind], queryFn: () => reportsApi.partyGlAccounts(kind) })
  useEffect(() => { setPicked([]); setResult(null) }, [kind, mode])

  async function view() {
    if (multi && picked.length === 0) return notifications.show({ message: 'Select the accounts', color: 'red' })
    setLoading(true)
    try {
      setResult({ ...(await reportsApi.runPartyGl({ kind, mode, from_date: isoDate(from), to_date: isoDate(to), ac_ids: multi ? picked.map(Number) : undefined, hide_zero: hideZero })), _kind: kind })
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not run the report', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  const label = { supplier: 'Supplier', customer: 'Customer', ledger: 'Ledger' }[kind]
  const columns = useMemo(
    () =>
      mode === 'summary'
        ? [
            { key: 'code', label: `${label} Code`, width: 200 },
            { key: 'group', label: `${label} Group`, width: 160 },
            { key: 'name', label: `${label} Name`, width: 260 },
            { key: 'op_bal', label: 'OP Balance', width: 140, num: true, render: (r) => drcr(r.op_bal, kind) },
            { key: 'dr', label: 'Dr. Amt', width: 130, num: true, render: (r) => n2(r.dr) },
            { key: 'cr', label: 'Cr. Amt', width: 130, num: true, render: (r) => n2(r.cr) },
            { key: 'balance', label: 'Balance', width: 140, num: true, render: (r) => drcr(r.balance, kind) },
          ]
        : [
            { key: 'code', label: `${label} Code`, width: 200 },
            { key: 'name', label: `${label} Name`, width: 220 },
            { key: 'trn_date', label: 'Date', width: 100, render: (r) => (r.trn_date ? dayjs(r.trn_date).format('DD/MM/YYYY') : '') },
            { key: 'doc_type', label: 'Doc Type', width: 100 },
            { key: 'trn_no', label: 'Trn No', width: 120 },
            { key: 'narration', label: 'Narration', width: 280 },
            { key: 'dr', label: 'Dr. Amt', width: 130, num: true, render: (r) => n2(r.dr) },
            { key: 'cr', label: 'Cr. Amt', width: 130, num: true, render: (r) => n2(r.cr) },
            { key: 'balance', label: 'Balance', width: 140, num: true, render: (r) => drcr(r.balance, kind) },
          ],
    [mode, kind, label]
  )
  const rows = useMemo(() => {
    if (!result) return []
    const out = [...result.rows.map((r, i) => ({ ...r, _key: i }))]
    if (out.length) out.push({ _kind: 'total', _key: 'total', code: 'Grand Total', ...(result.mode === 'summary' ? { op_bal: result.totals.op_bal, balance: result.totals.balance } : {}), dr: result.totals.dr, cr: result.totals.cr })
    return out
  }, [result])

  return (
    <Stack gap="md">
      <Card withBorder p="md">
        <Stack gap="sm">
          <Group gap="md" align="flex-end" wrap="wrap">
            <DatePickerInput className="vt-field-required" label="For the Period from" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={160} />
            <DatePickerInput className="vt-field-required" label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={160} />
          </Group>
          <Group gap="xl" wrap="wrap" align="center">
            <Radio.Group value={mode} onChange={setMode} aria-label="Report type">
              <Group gap="md"><Radio color="kumkum" value="detail" label="Detail" /><Radio color="kumkum" value="summary" label="Summary" /></Group>
            </Radio.Group>
            <Radio.Group value={kind} onChange={setKind} aria-label="Account type">
              <Group gap="md"><Radio color="kumkum" value="supplier" label="Supplier" /><Radio color="kumkum" value="customer" label="Customer" /><Radio color="kumkum" value="ledger" label="Ledger" /></Group>
            </Radio.Group>
            <Button color="kumkum" leftSection={<Eye size={16} />} loading={loading} onClick={view}>View</Button>
          </Group>
          <Checkbox color="kumkum" label="Select Multiple Accounts" checked={multi} onChange={(e) => { setMulti(e.currentTarget.checked); setPicked([]) }} />
          {multi && (
            <MultiSelect aria-label="Accounts" placeholder={accounts.length ? 'Select accounts' : `No ${label.toLowerCase()} accounts in this database`} searchable clearable data={accounts.map((a) => ({ value: String(a.id), label: `${a.name} · ${a.grp}` }))} value={picked} onChange={setPicked} />
          )}
        </Stack>
      </Card>

      <ScaleGrid columns={columns} rows={rows} loading={loading} emptyTitle={result ? 'No records' : 'Press View'} emptyHint={result ? 'Nothing was posted for these accounts in this period.' : 'Choose the options and press View.'} footer={result ? `${result.count} line(s)` : undefined} />

      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Button variant="light" color="kumkum" leftSection={<Printer size={16} />} disabled={!rows.length} onClick={() => window.print()}>Print</Button>
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!rows.length} onClick={() => downloadCsv('General Ledger.csv', rows, columns.map((c) => ({ label: c.label, value: (r) => (c.render ? c.render(r) : r[c.key]) })))}>Excel</Button>
          <Checkbox color="kumkum" label="Do Not Show the Party having Zero value" checked={hideZero} onChange={(e) => setHideZero(e.currentTarget.checked)} />
        </Group>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
    </Stack>
  )
}
