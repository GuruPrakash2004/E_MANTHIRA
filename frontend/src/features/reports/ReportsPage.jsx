import { useState } from 'react'
import DataGrid from '../../components/ui/DataGrid'
import HallVoucherPanel from './HallVoucherPanel'
import PartyGLPanel from './PartyGLPanel'
import CustomReportsPanel from './CustomReportsPanel'
import SubsidiaryCatalogPanel from './SubsidiaryCatalogPanel'
import { CATALOG_FORM_TAB } from './catalogTabs'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Grid, Group, Select, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { BookOpen, Coins, ClipboardList, Download, FileSearch, LayoutList, Play } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import dayjs from 'dayjs'
import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'
import * as reportsApi from '../../api/endpoints/reports'
import LookupSelect from '../../components/LookupSelect'
import MultiPickField from './MultiPickField'
import ReportPrintButtons from '../../components/ui/ReportPrint'
import RptPdfButtons from '../../components/ui/RptPdfButtons'
import * as mastersApi from '../../api/endpoints/masters'
import StatCard from '../../components/ui/StatCard'
import EmptyState from '../../components/ui/EmptyState'
import { formatINR } from '../../utils/format'
import { downloadXls } from '../../utils/xls'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const SEVA_DOC_ID = 1263

function SubsidiaryReportsCatalog({ onOpenTab }) {
  return <SubsidiaryCatalogPanel onOpenTab={onOpenTab} tabFor={(form) => CATALOG_FORM_TAB[form]} />
}

const money = (v) => formatINR(v)

const PRESETS = [
  { label: 'Today', range: () => [dayjs(), dayjs()] },
  { label: 'Yesterday', range: () => [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')] },
  { label: 'This week', range: () => [dayjs().startOf('week'), dayjs()] },
  { label: 'This month', range: () => [dayjs().startOf('month'), dayjs()] },
  { label: 'Last month', range: () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
]

/** From/To dates plus one-tap presets. Dates show as DD-MMM-YYYY. */
function DateRange({ from, to, onFrom, onTo }) {
  return (
    <>
      <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
        <DateInput label="From Date" valueFormat="DD-MMM-YYYY" value={from} onChange={onFrom} />
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
        <DateInput label="To Date" valueFormat="DD-MMM-YYYY" value={to} onChange={onTo} />
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }} style={{ display: 'flex', alignItems: 'flex-end' }}>
        <Group gap={6}>
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="compact-sm"
              variant="light"
              color="gold"
              c="var(--vt-badge-ink)"
              onClick={() => {
                const [a, b] = p.range()
                onFrom(a.toDate())
                onTo(b.toDate())
              }}
            >
              {p.label}
            </Button>
          ))}
        </Group>
      </Grid.Col>
    </>
  )
}

function FilterCard({ children, actions }) {
  return (
    <Card withBorder p="lg">
      <Grid>{children}</Grid>
      <Group justify="flex-end" mt="md">
        {actions}
      </Group>
    </Card>
  )
}

function ResultSkeleton() {
  return (
    <Card withBorder p="md">
      <Stack gap="xs">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={34} radius="sm" />
        ))}
      </Stack>
    </Card>
  )
}

function ResultTable({ columns, rows, name, emptyHint = 'No records for this range.' }) {
  return <DataGrid columns={columns} rows={rows} name={name} emptyTitle="No records found" emptyHint={emptyHint} maxHeight={560} />
}

function RunButtons({ loading, onRun, canExport, onExport, runDisabled, extra }) {
  return (
    <>
      <Button leftSection={<Play size={16} />} color="kumkum" loading={loading} disabled={runDisabled} onClick={onRun}>
        Run report
      </Button>
      {onExport && (
        <Button leftSection={<Download size={16} />} variant="default" disabled={!canExport} onClick={onExport}>
          Export CSV
        </Button>
      )}
      {extra}
    </>
  )
}

/** Shared shell: date range + optional Sannidhi/Seva filters, Run + Export, summary tiles, result table. */
function ReportPanel({ runFn, columns, filename, title, withSevaFilters = true, extraSummary, pdfFn }) {
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').toDate())
  const [toDate, setToDate] = useState(new Date())
  const [sannidhis, setSannidhis] = useState([]) // "Selected Sannidhi / Selected Seva / Selected User": ticked from a checklist window
  const [sevas, setSevas] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const buildFilters = () => {
    const filters = {
      from_date: dayjs(fromDate).format('YYYY-MM-DD'),
      to_date: dayjs(toDate).format('YYYY-MM-DD'),
    }
    if (withSevaFilters) {
      if (sannidhis.length) filters.sannidhi_ids = sannidhis.map(Number)
      if (sevas.length) filters.seva_ids = sevas.map(Number)
      if (users.length) filters.users = users
    }
    return filters
  }

  async function onRun() {
    setLoading(true)
    try {
      const filters = buildFilters()
      const data = await runFn(filters)
      setResult(data)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Report failed', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack gap="lg">
      <FilterCard actions={<RunButtons
            loading={loading}
            onRun={onRun}
            canExport={Boolean(result?.rows?.length)}
            onExport={() => downloadXls(filename, result.rows, columns)}
            extra={pdfFn ? (
              // reports that have their own .rpt print from it, with the filters as set on the screen
              <RptPdfButtons title={title || filename} load={() => pdfFn(buildFilters())} hotkey />
            ) : (
              <ReportPrintButtons
                title={title || filename.replace(/\.xls$/, '')}
                period={`Period From ${dayjs(fromDate).format('DD/MM/YYYY')} To ${dayjs(toDate).format('DD/MM/YYYY')}`}
                filters={[sannidhis.length && `${sannidhis.length} sannidhi(s)`, sevas.length && `${sevas.length} seva(s)`, users.length && `Users: ${users.join(', ')}`].filter(Boolean).join('  |  ')}
                columns={columns}
                rows={result?.rows || []}
                hotkey
              />
            )}
          />}>
        <DateRange from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
        {withSevaFilters && (
          <Grid.Col span={12}>
            <Group gap="xl" wrap="wrap">
              <MultiPickField
                label="Selected Sannidhi"
                title="Select [Multiple] Sannidhi Name"
                codeCaption="SANNIDHICODE"
                nameCaption="SANNIDHINAME"
                queryKey={['pick', 'sannidhi']}
                load={() => metaApi.getLookup(SEVA_DOC_ID, 'SANNIDHIID', '').then((r) => r.map((o) => ({ value: o.value, label: o.label })))}
                value={sannidhis}
                onChange={setSannidhis}
              />
              <MultiPickField
                label="Selected Seva"
                title="Select [Multiple] Seva Name"
                codeCaption="SEVACODE"
                nameCaption="SEVANAME"
                queryKey={['pick', 'seva']}
                load={() => metaApi.getLookup(SEVA_DOC_ID, 'SVAID', '').then((r) => r.map((o) => ({ value: o.value, label: o.label })))}
                value={sevas}
                onChange={setSevas}
              />
              <MultiPickField
                label="Selected User"
                title="Select [Multiple] User Name"
                codeCaption="USERCODE"
                nameCaption="USERNAME"
                queryKey={['pick', 'users']}
                load={() => mastersApi.listMaster(18, { top: 5000 }).then((d) => (d.rows || []).filter((u) => u.UserID > 0).map((u) => ({ value: String(u.UserCode), code: u.UserCode, label: u.UserName || u.UserCode })))}
                value={users}
                onChange={setUsers}
              />
            </Group>
          </Grid.Col>
        )}
      </FilterCard>

      {loading ? (
        <ResultSkeleton />
      ) : !result ? (
        <Card withBorder>
          <EmptyState icon={FileSearch} title="Ready when you are" hint="Choose the dates and filters, then run the report." />
        </Card>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, xs: result.total_amount != null ? 2 : 1 }}>
            <StatCard label="Records" value={result.total_count} icon={ClipboardList} footer={`${dayjs(fromDate).format('DD-MMM-YYYY')} to ${dayjs(toDate).format('DD-MMM-YYYY')}`} />
            {result.total_amount != null && <StatCard label="Total amount" value={money(result.total_amount)} icon={Coins} tone="dark" footer="For the records shown" />}
          </SimpleGrid>
          {extraSummary?.(result)}
          <ResultTable columns={columns} rows={result.rows} name={filename} />
        </>
      )}
    </Stack>
  )
}

const collectionColumns = [
  { key: 'SEVANO', label: 'Seva No' },
  { key: 'SEVADate', label: 'Date', value: (r) => dayjs(r.SEVADate).format('DD-MMM-YYYY') },
  { key: 'Name1', label: 'Name' },
  { key: 'Sannadhi', label: 'Sannidhi' },
  { key: 'Seva', label: 'Seva' },
  { key: 'Payment', label: 'Payment' },
  { key: 'Totalamt', label: 'Amount', num: true, value: (r) => money(r.Totalamt) },
  { key: 'AddedBy', label: 'Added By' },
]

const sevaIssueColumns = [
  { key: 'PDATE', label: 'Seva Date', value: (r) => dayjs(r.PDATE).format('DD-MMM-YYYY') },
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
  { key: 'DONRECDate', label: 'Date', value: (r) => dayjs(r.DONRECDate).format('DD-MMM-YYYY') },
  { key: 'DONOR', label: 'Donor' },
  { key: 'CONTACTNO', label: 'Contact' },
  { key: 'PANNO', label: 'PAN' },
  { key: 'TOTAMT', label: 'Amount', num: true, value: (r) => money(r.TOTAMT) },
  { key: 'PAYMNTMODE', label: 'Payment' },
  { key: 'AddedBy', label: 'Added By' },
]

const hallBookingVoucherColumns = [
  { key: 'PrintHBNO', label: 'Booking No' },
  { key: 'HBDate', label: 'Date', value: (r) => dayjs(r.HBDate).format('DD-MMM-YYYY') },
  { key: 'NMEOFFUNC', label: 'Function' },
  { key: 'CONPRS', label: 'Contact Person' },
  { key: 'CONTACTNO', label: 'Contact No' },
  { key: 'HBSTARTDT', label: 'Start', value: (r) => dayjs(r.HBSTARTDT).format('DD-MMM-YYYY') },
  { key: 'HBENDDT', label: 'End', value: (r) => dayjs(r.HBENDDT).format('DD-MMM-YYYY') },
  { key: 'AMOUNT', label: 'Amount', num: true, value: (r) => money(r.AMOUNT) },
  { key: 'RCPTVCHNO', label: 'Receipt Voucher No' },
  { key: 'RCPTTYPE', label: 'Receipt Type' },
  { key: 'TOTCR', label: 'Receipt Amount', num: true, value: (r) => money(r.TOTCR) },
  { key: 'BALAMT', label: 'Balance', num: true, value: (r) => money(r.BALAMT) },
  { key: 'printdonrecno', label: 'Linked Donation Receipt' },
]

function CollectionSummary({ result }) {
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p="md" h="100%">
          <Text fw={700} mb={6}>
            By Sannidhi / Seva
          </Text>
          <Table.ScrollContainer minWidth={360}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sannidhi</Table.Th>
                  <Table.Th>Seva</Table.Th>
                  <Table.Th ta="right">Count</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.summary_by_sannidhi_seva.map((g, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{g.sannidhi}</Table.Td>
                    <Table.Td>{g.seva}</Table.Td>
                    <Table.Td ta="right" className="vt-num">
                      {g.count}
                    </Table.Td>
                    <Table.Td ta="right" className="vt-num">
                      {money(g.amount)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p="md" h="100%">
          <Text fw={700} mb={6}>
            By payment mode
          </Text>
          <Table.ScrollContainer minWidth={280}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th ta="right">Count</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.summary_by_payment_mode.map((g, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{g.payment_mode}</Table.Td>
                    <Table.Td ta="right" className="vt-num">
                      {g.count}
                    </Table.Td>
                    <Table.Td ta="right" className="vt-num">
                      {money(g.amount)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
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
    <Stack gap="lg">
      <FilterCard actions={<RunButtons loading={loading} onRun={onRun} />}>
        <DateRange from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
        <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
          <Select label="Mode" data={[{ value: 'detail', label: 'Detail' }, { value: 'summary', label: 'Summary' }]} value={mode} onChange={setMode} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 4 }} style={{ display: 'flex', alignItems: 'flex-end', minHeight: 56 }}>
          <Checkbox label="Hide zero balances" checked={hideZero} onChange={(e) => setHideZero(e.currentTarget.checked)} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <LookupSelect ledgerPicker label="Add Ledger" value={pickerValue} onChange={addLedger} />
        </Grid.Col>
        <Grid.Col span={12}>
          {ledgerIds.length === 0 ? (
            <Text size="sm" c="dimmed">
              No ledgers chosen yet. Pick one or more above.
            </Text>
          ) : (
            <Group gap="xs">
              {ledgerIds.map((id) => (
                <Badge
                  key={id}
                  size="lg"
                  variant="light"
                  color="kumkum"
                  tt="none"
                  pr={4}
                  rightSection={
                    <UnstyledButton aria-label={`Remove ${ledgerName(id)}`} onClick={() => removeLedger(id)} style={{ display: 'grid', placeItems: 'center', width: 22, height: 22 }}>
                      <X size={14} />
                    </UnstyledButton>
                  }
                >
                  {ledgerName(id)}
                </Badge>
              ))}
            </Group>
          )}
        </Grid.Col>
      </FilterCard>

      {loading && <ResultSkeleton />}

      {!loading && !cards && (
        <Card withBorder>
          <EmptyState icon={BookOpen} title="Ready when you are" hint="Pick the ledgers and dates, then run the report." />
        </Card>
      )}

      {!loading &&
        cards &&
        cards.map((c) => (
          <Card key={c.ac_led_id} withBorder p="lg">
            <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap="sm">
              <Title order={4}>{c.name}</Title>
              <Group gap="sm">
                <Badge size="lg" variant="light" color="gold" c="var(--vt-badge-ink)" tt="none" className="vt-num">
                  Opening {money(c.opening)}
                </Badge>
                <Badge size="lg" variant="filled" color="kumkum" tt="none" className="vt-num">
                  Closing {money(c.closing)}
                </Badge>
              </Group>
            </Group>
            {c.rows.length > 0 && (
              <Table.ScrollContainer minWidth={720}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Voucher No</Table.Th>
                      <Table.Th>Narration</Table.Th>
                      <Table.Th ta="right">Debit</Table.Th>
                      <Table.Th ta="right">Credit</Table.Th>
                      <Table.Th ta="right">Balance</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {c.rows.map((r, i) => (
                      <Table.Tr key={i}>
                        <Table.Td className="vt-num">{dayjs(r.date).format('DD-MMM-YYYY')}</Table.Td>
                        <Table.Td>{r.doc_type}</Table.Td>
                        <Table.Td className="vt-num">{r.trn_no}</Table.Td>
                        <Table.Td>{r.narration}</Table.Td>
                        <Table.Td ta="right" className="vt-num">
                          {r.dr ? money(r.dr) : ''}
                        </Table.Td>
                        <Table.Td ta="right" className="vt-num">
                          {r.cr ? money(r.cr) : ''}
                        </Table.Td>
                        <Table.Td ta="right" className="vt-num" fw={600}>
                          {money(r.balance)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        ))}
      {!loading && cards && cards.length === 0 && (
        <Card withBorder>
          <EmptyState icon={FileSearch} title="No ledger activity" hint="None of the chosen ledgers have entries in this range." />
        </Card>
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
// heading of each report (the tab strip is gone: the sidebar menu and Subsidiary Reports open them)
const TAB_TITLE = {
  'complete-day': 'Complete Day',
  collection: 'Detailed Collection',
  'seva-issue': 'Seva Issue / Schedule',
  donations: 'Kanike / Donation',
  'general-ledger': 'General Ledger',
  custom: 'Customised Reports',
  'hall-voucher': 'Hall Booking with Voucher Detail',
  catalog: 'Subsidiary Reports',
}
const FROM_SUBSIDIARY = ['complete-day', 'collection', 'seva-issue', 'donations'] // listed under Subsidiary Reports in the menu

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  // read from the address on every render, so a sidebar click between two reports switches the panel
  const activeTab = VALID_TABS.includes(requestedTab) ? requestedTab : 'complete-day'

  function changeTab(value) {
    setSearchParams(value === 'complete-day' ? {} : { tab: value }, { replace: true })
  }

  return (
    <Stack gap="lg" className="vt-rise">
      <Group gap="sm" wrap="nowrap" justify="space-between">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>{TAB_TITLE[activeTab]}</Title>
            <Text size="sm" c="dimmed">
              Daily collection, sevas, donations, ledgers and customised reports
            </Text>
          </div>
        </Group>
        {FROM_SUBSIDIARY.includes(activeTab) && (
          <Button variant="subtle" color="kumkum" leftSection={<LayoutList size={16} />} onClick={() => changeTab('catalog')}>
            Back to Subsidiary Reports
          </Button>
        )}
      </Group>

      <Tabs value={activeTab} color="kumkum" keepMounted={false}>
        <Tabs.Panel value="complete-day">
          <ReportPanel runFn={reportsApi.runCompleteDay} columns={collectionColumns} filename="complete-day.xls" title="Complete Day Report" pdfFn={reportsApi.completeDayPdf} extraSummary={(r) => <CollectionSummary result={r} />} />
        </Tabs.Panel>
        <Tabs.Panel value="collection">
          <ReportPanel runFn={reportsApi.runCollection} columns={collectionColumns} filename="detailed-collection.xls" title="Detailed Collection Report" extraSummary={(r) => <CollectionSummary result={r} />} />
        </Tabs.Panel>
        <Tabs.Panel value="seva-issue">
          <ReportPanel runFn={reportsApi.runSevaIssue} columns={sevaIssueColumns} filename="seva-issue.xls" title="Seva Issue / Schedule Report" />
        </Tabs.Panel>
        <Tabs.Panel value="donations">
          <ReportPanel runFn={reportsApi.runDonations} columns={donationColumns} filename="donations.xls" title="Kanike / Donation Report" withSevaFilters={false} />
        </Tabs.Panel>
        <Tabs.Panel value="general-ledger">
          <PartyGLPanel />
        </Tabs.Panel>
        <Tabs.Panel value="custom">
          <CustomReportsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="hall-voucher">
          <HallVoucherPanel />
        </Tabs.Panel>
        <Tabs.Panel value="catalog">
          <SubsidiaryReportsCatalog onOpenTab={changeTab} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
