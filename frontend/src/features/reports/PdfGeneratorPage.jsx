import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Checkbox, Grid, Group, MultiSelect, Radio, Select, Stack, Table, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { Download, FileDown, ListChecks, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as printApi from '../../api/endpoints/print'
import { PageHeader } from '../../components/ui/EntryParts'
import EmptyState from '../../components/ui/EmptyState'
import { isoDate } from '../../utils/format'

/**
 * PDF Generator - Bulk (legacy frmUtlBulkPDFGenerator). Pick a transaction (documents that have print types in
 * UtlOption), a print type, optionally parties and a date range; Load lists the records; tick the ones you want
 * (Select All) and Download. The legacy form wrote the files to a server folder; the browser version zips the
 * ticked records and downloads them. Red captions are mandatory, as in the legacy form.
 */
export default function PdfGeneratorPage() {
  const navigate = useNavigate()
  const [docId, setDocId] = useState(null)
  const [optionName, setOptionName] = useState(null)
  const [mode, setMode] = useState('generate')
  const [useParty, setUseParty] = useState(false)
  const [partyIds, setPartyIds] = useState([])
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').toDate())
  const [toDate, setToDate] = useState(new Date())
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(() => new Set())
  const [exported, setExported] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const { data: docs = [] } = useQuery({ queryKey: ['bulk-docs'], queryFn: printApi.bulkDocuments })
  const doc = docs.find((d) => String(d.doc_id) === docId)
  const { data: options = [] } = useQuery({ queryKey: ['print-options', docId], queryFn: () => printApi.getPrintOptions(Number(docId)), enabled: Boolean(docId) })
  const { data: parties = [] } = useQuery({ queryKey: ['bulk-parties', docId], queryFn: () => printApi.bulkParties(docId), enabled: Boolean(docId && doc?.party_label) })

  useEffect(() => {
    setRows(null)
    setSel(new Set())
    setExported(new Set())
    setUseParty(false)
    setPartyIds([])
  }, [docId])
  useEffect(() => {
    const first = options.find((o) => o.available)
    if (first && !optionName) setOptionName(first.option_name)
  }, [options, optionName])

  const allSelected = rows?.length > 0 && sel.size === rows.length
  const selectedCount = sel.size
  const exportedCount = useMemo(() => [...sel].filter((id) => exported.has(id)).length, [sel, exported])

  async function onLoad() {
    if (!docId || !optionName || !fromDate || !toDate) {
      notifications.show({ message: !docId ? 'Please Select transaction' : !optionName ? 'Please Select Print Type' : 'Choose the date range', color: 'red' })
      return
    }
    setLoading(true)
    try {
      const r = await printApi.bulkRecords(docId, { from_date: isoDate(fromDate), to_date: isoDate(toDate), party_ids: useParty && partyIds.length ? partyIds.join(',') : undefined })
      setRows(r)
      setSel(new Set())
      setExported(new Set())
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not load the records', color: 'red' })
    } finally {
      setLoading(false)
    }
  }
  function toggle(id) {
    setSel((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  async function onDownload() {
    if (!rows?.length) return notifications.show({ message: 'No data present!!', color: 'red' })
    if (!selectedCount) return notifications.show({ message: 'Tick the records to download', color: 'red' })
    setGenerating(true)
    try {
      const blob = await printApi.bulkDownloadSelected(docId, optionName, [...sel])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${optionName}_${dayjs().format('YYYYMMDD_HHmm')}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setExported(new Set(sel))
      notifications.show({ message: 'Export Successfully Completed', color: 'teal' })
    } catch (err) {
      let msg = err?.response?.data?.detail
      if (!msg && err?.response?.data instanceof Blob) msg = await err.response.data.text().then((t) => { try { return JSON.parse(t).detail } catch { return null } })
      notifications.show({ message: msg || 'Could not generate PDFs', color: 'red' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="PDF Generator - Bulk" subtitle="One PDF per record, zipped for download" shortcuts={[]} />

      <Card withBorder p="lg">
        <Stack>
          <Grid align="flex-end">
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select
                className="vt-field-required"
                label="Transaction"
                required
                searchable
                data={docs.map((d) => ({ value: String(d.doc_id), label: d.doc_name }))}
                value={docId}
                onChange={(v) => {
                  setDocId(v)
                  setOptionName(null)
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select
                className="vt-field-required"
                label="Select Print Type"
                required
                data={options.filter((o) => o.available).map((o) => ({ value: o.option_name, label: o.option_name }))}
                value={optionName}
                onChange={setOptionName}
                disabled={!docId}
                placeholder={docId ? 'Choose a print type' : 'Choose a transaction first'}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Radio.Group value={mode} onChange={setMode} aria-label="Generation mode">
                <Group gap="md">
                  <Radio color="kumkum" value="generate" label="Fresh PDF Generation" />
                  <Radio color="kumkum" value="pre" label="Pre-Generated" disabled title="Pre-generated PDFs are not kept on the server in the web app" />
                </Group>
              </Radio.Group>
            </Grid.Col>
          </Grid>
          <Grid align="flex-end">
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Checkbox color="kumkum" label={`Select Party${doc?.party_label ? ` (${doc.party_label})` : ''}`} disabled={!doc?.party_label} checked={useParty} onChange={(e) => { setUseParty(e.currentTarget.checked); setPartyIds([]) }} mb={6} />
              {useParty && (
                <MultiSelect aria-label="Parties" searchable clearable placeholder="Select parties" data={parties.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))} value={partyIds} onChange={setPartyIds} />
              )}
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <DatePickerInput className="vt-field-required" label="From" required valueFormat="DD/MM/YYYY" value={fromDate} onChange={setFromDate} />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <DatePickerInput className="vt-field-required" label="To" required valueFormat="DD/MM/YYYY" value={toDate} onChange={setToDate} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 2 }}>
              <Button fullWidth color="kumkum" leftSection={<ListChecks size={16} />} loading={loading} onClick={onLoad}>
                Load
              </Button>
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        {rows === null ? (
          <EmptyState icon={FileDown} title="Press Load" hint="Choose a transaction, print type and dates, then press Load to list the records." />
        ) : rows.length === 0 ? (
          <EmptyState icon={FileDown} title="No records found" hint="Nothing was entered in that date range." />
        ) : (
          <Table.ScrollContainer minWidth={560} mah={460} type="native">
            <Table striped highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={60}>
                    <Checkbox color="kumkum" aria-label="Select all" checked={allSelected} indeterminate={selectedCount > 0 && !allSelected} onChange={(e) => setSel(e.currentTarget.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </Table.Th>
                  <Table.Th>Doc No</Table.Th>
                  <Table.Th>Doc Date</Table.Th>
                  <Table.Th>Party</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => toggle(r.id)}>
                    <Table.Td>
                      <Checkbox color="kumkum" aria-label={`Select ${r.doc_no}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />
                    </Table.Td>
                    <Table.Td fw={600}>{r.doc_no}</Table.Td>
                    <Table.Td>{dayjs(r.doc_date).format('DD/MM/YYYY')}</Table.Td>
                    <Table.Td>{r.party}</Table.Td>
                    <Table.Td>{exported.has(r.id) && sel.has(r.id) ? <Badge color="teal" variant="light">Exported</Badge> : ''}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Text size="sm">Total records : {rows?.length ?? 0}</Text>
          <Text size="sm" c="dimmed">Exported/Record Selected : {exportedCount}/{selectedCount}</Text>
        </Stack>
        <Group gap="sm">
          <Button color="kumkum" leftSection={<Download size={16} />} loading={generating} disabled={!selectedCount} onClick={onDownload}>
            Download
          </Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">At most 200 records per download. Red captions are mandatory.</Text>
    </Stack>
  )
}
