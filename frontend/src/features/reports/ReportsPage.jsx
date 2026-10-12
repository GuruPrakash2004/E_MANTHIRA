import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Grid, Group, Loader, Select, Stack, Table, Tabs, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Download, Play, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import dayjs from 'dayjs'
import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'
import * as reportsApi from '../../api/endpoints/reports'
import LookupSelect from '../../components/LookupSelect'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'
const SEVA_DOC_ID = 1263

// Legacy frmRptReport ("Subsidiary Reports") RptFrmName -> the tab here
// that covers the same report. Any catalog row whose form isn't in this
// map gets shown but disabled — same "metadata lists it, we haven't built
// it" convention as AppShellLayout's sidebar (CAPTION_ROUTE / routeFor).
const CATALOG_FORM_TAB = {
  frmRptCompDaySmry: 'complete-day',
  frmRptDtlColn: 'collection',
  frmRptDonation: 'donations',
  frmRptSevaIssue: 'seva-issue',
}

/** "Subsidiary Reports" — port of frmRptReport, a launcher reading
 * UtlReports (RptName/RptGroupName/RptFrmName). Real data for this client
 * is exactly the 4 reports already built as tabs here; any future row
 * added to UtlReports shows up automatically, disabled until its tab
 * exists. */
function SubsidiaryReportsCatalog({ onOpenTab }) {
  const { data: catalog, isLoading } = useQuery({ queryKey: ['report-catalog'], queryFn: reportsApi.getReportCatalog })

  return (
    <Card withBorder radius="lg" p="lg">
      <Text size="sm" c="dimmed" mb="md">
        Every report registered in UtlReports — the same catalog the legacy "Subsidiary Reports" screen opened from.
      </Text>
      {isLoading && <Loader size="sm" />}
      <Stack gap="xs">
        {(catalog || []).map((r) => {
          const tab = CATALOG_FORM_TAB[r.form_name]
          return (
            <Group key={r.rpt_id} justify="space-between" p="sm" style={{ border: '1px solid var(--mantine-color-gray-2)', borderRadius: 8 }}>
              <div>
                <Text size="sm" fw={600}>
                  {r.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {r.group} &middot; {r.form_name}
                </Text>
              </div>
              <Button size="xs" variant="light" color="kumkum" disabled={!tab} onClick={() => tab && onOpenTab(tab)}>
                {tab ? 'Open' : 'Not available yet'}
              </Button>
            </Group>
          )
        })}
        {!isLoading && (catalog || []).length === 0 && (
          <Text c="dimmed" size="sm">
            No subsidiary reports registered.
          </Text>
        )}
      </Stack>
    </Card>
  )
}

function money(v) {
  return `₹ ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function toCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(',')
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = c.value ? c.value(r) : r[c.key]
        const s = v == null ? '' : String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      })
      .join(',')
  )
  return [header, ...lines].join('\r\n')
}

function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Shared shell: date range + optional Sannidhi/Seva filters, Run + Export, result table. */
function ReportPanel({ runFn, columns, filename, withSevaFilters = true, extraSummary }) {
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').toDate())
  const [toDate, setToDate] = useState(new Date())
  const [sannidhiId, setSannidhiId] = useState('')
  const [sevaId, setSevaId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  async function onRun() {
    setLoading(true)
    try {
      const filters = {
        from_date: dayjs(fromDate).format('YYYY-MM-DD'),
        to_date: dayjs(toDate).format('YYYY-MM-DD'),
      }
      if (withSevaFilters) {
        if (sannidhiId) filters.sannidhi_ids = [Number(sannidhiId)]
        if (sevaId) filters.seva_ids = [Number(sevaId)]
      }
      const data = await runFn(filters)
      setResult(data)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Report failed', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack>
      <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
        />
        <Grid style={{ position: 'relative' }}>
          <Grid.Col span={3}>
            <DateInput label="From Date" value={fromDate} onChange={setFromDate} />
          </Grid.Col>
          <Grid.Col span={3}>
            <DateInput label="To Date" value={toDate} onChange={setToDate} />
          </Grid.Col>
          {withSevaFilters && (
            <>
              <Grid.Col span={3}>
                <LookupSelect docId={SEVA_DOC_ID} field="SANNIDHIID" label="Sannidhi (optional)" value={sannidhiId} onChange={setSannidhiId} />
              </Grid.Col>
              <Grid.Col span={3}>
                <LookupSelect docId={SEVA_DOC_ID} field="SVAID" label="Seva (optional)" value={sevaId} onChange={setSevaId} />
              </Grid.Col>
            </>
          )}
        </Grid>
        <Group justify="flex-end" mt="md" style={{ position: 'relative' }}>
          <Button leftSection={<Play size={16} />} color="kumkum" loading={loading} onClick={onRun}>
            Run Report
          </Button>
          <Button
            leftSection={<Download size={16} />}
            variant="default"
            disabled={!result?.rows?.length}
            onClick={() => downloadCsv(filename, result.rows, columns)}
          >
            Export CSV
          </Button>
        </Group>
      </Card>

      {loading && <Loader color="kumkum" mx="auto" />}

      {result && (
        <>
          <Group>
            <Badge size="lg" color="kumkum" variant="light">
              {result.total_count} record{result.total_count === 1 ? '' : 's'}
            </Badge>
            {result.total_amount != null && (
              <Badge size="lg" color="teal" variant="light">
                Total {money(result.total_amount)}
              </Badge>
            )}
          </Group>
          {extraSummary?.(result)}
          <Card withBorder radius="lg" p={0} shadow="sm" style={{ overflow: 'auto' }}>
            <Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  {columns.map((c) => (
                    <Table.Th key={c.key}>{c.label}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={columns.length}>
                      <Text c="dimmed" ta="center" py="md">
                        No records for this range.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {result.rows.map((r, i) => (
                  <Table.Tr key={i}>
                    {columns.map((c) => (
                      <Table.Td key={c.key}>{c.value ? c.value(r) : r[c.key]}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}
    </Stack>
  )
}

const collectionColumns = [
  { key: 'SEVANO', label: 'Seva No' },
  { key: 'SEVADate', label: 'Date', value: (r) => dayjs(r.SEVADate).format('DD/MM/YYYY') },
  { key: 'Name1', label: 'Name' },
  { key: 'Sannadhi', label: 'Sannidhi' },
  { key: 'Seva', label: 'Seva' },
  { key: 'Payment', label: 'Payment' },
  { key: 'Totalamt', label: 'Amount', value: (r) => money(r.Totalamt) },
  { key: 'AddedBy', label: 'Added By' },
]

const sevaIssueColumns = [
  { key: 'PDATE', label: 'Seva Date', value: (r) => dayjs(r.PDATE).format('DD/MM/YYYY') },
  { key: 'PrintSevaNo', label: 'Receipt No' },
  { key: 'NAME1', label: 'Name' },
  { key: 'SANNADHI', label: 'Sannidhi' },
  { key: 'SEVA', label: 'Seva' },
  { key: 'GOTHRA', label: 'Gothra' },
  { key: 'NAKSHATRA1', label: 'Nakshatra' },
  { key: 'RASHI1', label: 'Rashi' },
  { key: 'MOBNUM', label: 'Mobile' },
]

const donationColumns = [
  { key: 'PrintDONRECNO', label: 'Receipt No' },
  { key: 'DONRECDate', label: 'Date', value: (r) => dayjs(r.DONRECDate).format('DD/MM/YYYY') },
  { key: 'DONOR', label: 'Donor' },
  { key: 'CONTACTNO', label: 'Contact' },
  { key: 'PANNO', label: 'PAN' },
  { key: 'TOTAMT', label: 'Amount', value: (r) => money(r.TOTAMT) },
  { key: 'PAYMNTMODE', label: 'Payment' },
  { key: 'AddedBy', label: 'Added By' },
]

const hallBookingVoucherColumns = [
  { key: 'PrintHBNO', label: 'Booking No' },
  { key: 'HBDate', label: 'Date', value: (r) => dayjs(r.HBDate).format('DD/MM/YYYY') },
  { key: 'NMEOFFUNC', label: 'Function' },
  { key: 'CONPRS', label: 'Contact Person' },
  { key: 'CONTACTNO', label: 'Contact No' },
  { key: 'HBSTARTDT', label: 'Start', value: (r) => dayjs(r.HBSTARTDT).format('DD/MM/YYYY') },
  { key: 'HBENDDT', label: 'End', value: (r) => dayjs(r.HBENDDT).format('DD/MM/YYYY') },
  { key: 'AMOUNT', label: 'Amount', value: (r) => money(r.AMOUNT) },
  { key: 'RCPTVCHNO', label: 'Receipt Voucher No' },
  { key: 'RCPTTYPE', label: 'Receipt Type' },
  { key: 'TOTCR', label: 'Receipt Amount', value: (r) => money(r.TOTCR) },
  { key: 'BALAMT', label: 'Balance', value: (r) => money(r.BALAMT) },
  { key: 'printdonrecno', label: 'Linked Donation Receipt' },
]

function CollectionSummary({ result }) {
  return (
    <Grid>
      <Grid.Col span={6}>
        <Card withBorder radius="lg" p="md">
          <Text fw={600} size="sm" mb={6}>
            By Sannidhi / Seva
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Sannidhi</Table.Th>
                <Table.Th>Seva</Table.Th>
                <Table.Th>Count</Table.Th>
                <Table.Th>Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {result.summary_by_sannidhi_seva.map((g, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{g.sannidhi}</Table.Td>
                  <Table.Td>{g.seva}</Table.Td>
                  <Table.Td>{g.count}</Table.Td>
                  <Table.Td>{money(g.amount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Grid.Col>
      <Grid.Col span={6}>
        <Card withBorder radius="lg" p="md">
          <Text fw={600} size="sm" mb={6}>
            By Payment Mode
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Count</Table.Th>
                <Table.Th>Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {result.summary_by_payment_mode.map((g, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{g.payment_mode}</Table.Td>
                  <Table.Td>{g.count}</Table.Td>
                  <Table.Td>{money(g.amount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Grid.Col>
    </Grid>
  )
}

function GeneralLedgerPanel() {
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').toDate())
  const [toDate, setToDate] = useState(new Date())
  const [ledgerIds, setLedgerIds] = useState([])
  const [pickerValue, setPickerValue] = useState('')
  const { data: allLedgers } = useQuery({ queryKey: ['ledgers-all'], queryFn: () => metaApi.getLedgers() })
  const ledgerName = (id) => allLedgers?.find((l) => l.value === id)?.label || `Ledger #${id}`
  const [mode, setMode] = useState('detail')
  const [hideZero, setHideZero] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cards, setCards] = useState(null)

  function addLedger(v) {
    if (v && !ledgerIds.includes(Number(v))) setLedgerIds((ids) => [...ids, Number(v)])
    setPickerValue('')
  }
  function removeLedger(id) {
    setLedgerIds((ids) => ids.filter((x) => x !== id))
  }

  async function onRun() {
    if (ledgerIds.length === 0) {
      notifications.show({ message: 'Pick at least one ledger', color: 'red' })
      return
    }
    setLoading(true)
    try {
      const data = await reportsApi.runGeneralLedger({
        ac_led_ids: ledgerIds,
        from_date: dayjs(fromDate).format('YYYY-MM-DD'),
        to_date: dayjs(toDate).format('YYYY-MM-DD'),
        mode,
        hide_zero: hideZero,
      })
      setCards(data)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Report failed', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack>
      <Card withBorder radius="lg" p="lg" shadow="sm">
        <Grid>
          <Grid.Col span={3}>
            <DateInput label="From Date" value={fromDate} onChange={setFromDate} />
          </Grid.Col>
          <Grid.Col span={3}>
            <DateInput label="To Date" value={toDate} onChange={setToDate} />
          </Grid.Col>
          <Grid.Col span={3}>
            <Select label="Mode" data={[{ value: 'detail', label: 'Detail' }, { value: 'summary', label: 'Summary' }]} value={mode} onChange={setMode} />
          </Grid.Col>
          <Grid.Col span={3} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Checkbox label="Hide zero balances" checked={hideZero} onChange={(e) => setHideZero(e.currentTarget.checked)} />
          </Grid.Col>
          <Grid.Col span={12}>
            <LookupSelect ledgerPicker label="Add Ledger" value={pickerValue} onChange={addLedger} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Group gap="xs">
              {ledgerIds.map((id) => (
                <Badge key={id} variant="light" color="kumkum" rightSection={<X size={12} style={{ cursor: 'pointer' }} onClick={() => removeLedger(id)} />}>
                  {ledgerName(id)}
                </Badge>
              ))}
            </Group>
          </Grid.Col>
        </Grid>
        <Group justify="flex-end" mt="md">
          <Button leftSection={<Play size={16} />} color="kumkum" loading={loading} onClick={onRun}>
            Run Report
          </Button>
        </Group>
      </Card>

      {loading && <Loader color="kumkum" mx="auto" />}

      {cards &&
        cards.map((c) => (
          <Card key={c.ac_led_id} withBorder radius="lg" p="lg" shadow="sm">
            <Group justify="space-between" mb="sm">
              <Title order={5} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                {c.name}
              </Title>
              <Group gap="lg">
                <Text size="sm">
                  Opening: <b>{money(c.opening)}</b>
                </Text>
                <Text size="sm">
                  Closing: <b>{money(c.closing)}</b>
                </Text>
              </Group>
            </Group>
            {c.rows.length > 0 && (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Voucher No</Table.Th>
                    <Table.Th>Narration</Table.Th>
                    <Table.Th>Debit</Table.Th>
                    <Table.Th>Credit</Table.Th>
                    <Table.Th>Balance</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {c.rows.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{dayjs(r.date).format('DD/MM/YYYY')}</Table.Td>
                      <Table.Td>{r.doc_type}</Table.Td>
                      <Table.Td>{r.trn_no}</Table.Td>
                      <Table.Td>{r.narration}</Table.Td>
                      <Table.Td>{r.dr ? money(r.dr) : ''}</Table.Td>
                      <Table.Td>{r.cr ? money(r.cr) : ''}</Table.Td>
                      <Table.Td>{money(r.balance)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        ))}
      {cards && cards.length === 0 && <Text c="dimmed">No ledgers with activity in this range.</Text>}
    </Stack>
  )
}

function CustomReportsPanel() {
  const [crid, setCrid] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const { data: reportsList } = useQuery({ queryKey: ['custom-reports'], queryFn: reportsApi.listCustomReports })
  const { data: definition } = useQuery({
    queryKey: ['custom-report-fields', crid],
    queryFn: () => reportsApi.getCustomReportFields(crid),
    enabled: Boolean(crid),
  })

  function onPickReport(v) {
    setCrid(v)
    setFilterValues({})
    setResult(null)
  }

  function setFilter(key, value) {
    setFilterValues((f) => ({ ...f, [key]: value }))
  }

  async function onRun() {
    setLoading(true)
    try {
      const data = await reportsApi.runCustomReport(crid, filterValues)
      setResult(data)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Report failed', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  const filterFields = (definition?.fields || []).filter((f) => f.filter_req)
  const visibleFields = definition?.fields || []

  function columnsFor(fields) {
    return fields.map((f) => ({ key: `${f.table}__${f.code}`, label: f.caption }))
  }

  return (
    <Stack>
      <Card withBorder radius="lg" p="lg" shadow="sm">
        <Select
          label="Report"
          placeholder="Choose a report"
          data={(reportsList || []).map((r) => ({ value: String(r.crid), label: r.name }))}
          value={crid}
          onChange={onPickReport}
        />
        {filterFields.length > 0 && (
          <Grid mt="md">
            {filterFields.map((f) =>
              f.data_type === 'DATE' ? (
                <Grid.Col span={3} key={f.code}>
                  <Group grow>
                    <DateInput label={`${f.caption} From`} onChange={(v) => setFilter(`${f.code}_from`, v ? dayjs(v).format('YYYY-MM-DD') : '')} />
                    <DateInput label={`${f.caption} To`} onChange={(v) => setFilter(`${f.code}_to`, v ? dayjs(v).format('YYYY-MM-DD') : '')} />
                  </Group>
                </Grid.Col>
              ) : (
                <Grid.Col span={3} key={f.code}>
                  <TextInput label={f.caption} value={filterValues[f.code] || ''} onChange={(e) => setFilter(f.code, e.currentTarget.value)} />
                </Grid.Col>
              )
            )}
          </Grid>
        )}
        <Group justify="flex-end" mt="md">
          <Button leftSection={<Play size={16} />} color="kumkum" loading={loading} disabled={!crid} onClick={onRun}>
            Run Report
          </Button>
          <Button
            leftSection={<Download size={16} />}
            variant="default"
            disabled={!result?.rows?.length}
            onClick={() => downloadCsv(`${(reportsList || []).find((r) => String(r.crid) === crid)?.name || 'report'}.csv`, result.rows, columnsFor(visibleFields))}
          >
            Export CSV
          </Button>
        </Group>
      </Card>

      {loading && <Loader color="kumkum" mx="auto" />}

      {result && (
        <>
          <Badge size="lg" color="kumkum" variant="light">
            {result.count} record{result.count === 1 ? '' : 's'}
          </Badge>
          <Card withBorder radius="lg" p={0} shadow="sm" style={{ overflow: 'auto' }}>
            <Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  {columnsFor(visibleFields).map((c) => (
                    <Table.Th key={c.key}>{c.label}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.map((r, i) => (
                  <Table.Tr key={i}>
                    {columnsFor(visibleFields).map((c) => (
                      <Table.Td key={c.key}>{result.totals[c.key] != null && r[c.key] != null ? money(r[c.key]) : String(r[c.key] ?? '')}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
              {Object.keys(result.totals).length > 0 && (
                <Table.Tfoot>
                  <Table.Tr>
                    {columnsFor(visibleFields).map((c) => (
                      <Table.Th key={c.key}>{result.totals[c.key] != null ? money(result.totals[c.key]) : ''}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Tfoot>
              )}
            </Table>
          </Card>
        </>
      )}
    </Stack>
  )
}

// Menu items that are tabs here, not their own screens — see
// frontend/src/components/AppShellLayout.jsx's CAPTION_ROUTE, which points
// "Customised Reports…" and "Hall Booking With Voucher Detail Report" at
// /reports?tab=<value> so those legacy MstMenu entries land on the right
// tab instead of being dead (disabled) sidebar links.
const VALID_TABS = ['complete-day', 'collection', 'seva-issue', 'donations', 'general-ledger', 'custom', 'hall-voucher', 'catalog']

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(VALID_TABS.includes(requestedTab) ? requestedTab : 'complete-day')

  function changeTab(value) {
    setActiveTab(value)
    setSearchParams(value === 'complete-day' ? {} : { tab: value }, { replace: true })
  }

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Reports
          </Title>
          <Text size="sm" c="dimmed">
            Complete Day, Detailed Collection, Seva Issue/Schedule and Kanike (Donation) reports
          </Text>
        </div>
      </Group>

      <Tabs value={activeTab} onChange={changeTab} color="kumkum" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="complete-day">Complete Day</Tabs.Tab>
          <Tabs.Tab value="collection">Detailed Collection</Tabs.Tab>
          <Tabs.Tab value="seva-issue">Seva Issue / Schedule</Tabs.Tab>
          <Tabs.Tab value="donations">Kanike / Donation</Tabs.Tab>
          <Tabs.Tab value="general-ledger">General Ledger</Tabs.Tab>
          <Tabs.Tab value="custom">Customised Reports</Tabs.Tab>
          <Tabs.Tab value="hall-voucher">Hall Booking with Voucher Detail</Tabs.Tab>
          <Tabs.Tab value="catalog">Subsidiary Reports</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="complete-day" pt="md">
          <ReportPanel runFn={reportsApi.runCompleteDay} columns={collectionColumns} filename="complete-day.csv" extraSummary={(r) => <CollectionSummary result={r} />} />
        </Tabs.Panel>
        <Tabs.Panel value="collection" pt="md">
          <ReportPanel runFn={reportsApi.runCollection} columns={collectionColumns} filename="detailed-collection.csv" extraSummary={(r) => <CollectionSummary result={r} />} />
        </Tabs.Panel>
        <Tabs.Panel value="seva-issue" pt="md">
          <ReportPanel runFn={reportsApi.runSevaIssue} columns={sevaIssueColumns} filename="seva-issue.csv" />
        </Tabs.Panel>
        <Tabs.Panel value="donations" pt="md">
          <ReportPanel runFn={reportsApi.runDonations} columns={donationColumns} filename="donations.csv" withSevaFilters={false} />
        </Tabs.Panel>
        <Tabs.Panel value="general-ledger" pt="md">
          <GeneralLedgerPanel />
        </Tabs.Panel>
        <Tabs.Panel value="custom" pt="md">
          <CustomReportsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="hall-voucher" pt="md">
          <ReportPanel
            runFn={reportsApi.runHallBookingVoucher}
            columns={hallBookingVoucherColumns}
            filename="hall-booking-voucher.csv"
            withSevaFilters={false}
          />
        </Tabs.Panel>
        <Tabs.Panel value="catalog" pt="md">
          <SubsidiaryReportsCatalog onOpenTab={changeTab} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
