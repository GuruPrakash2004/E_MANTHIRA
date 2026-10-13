import { useEffect, useState } from 'react'
import { Badge, Button, Card, Checkbox, Grid, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as inventoryApi from '../../api/endpoints/inventory'
import { ReportTable } from './ReportParts'
import { PageHeader } from '../../components/ui/EntryParts'
import { isoDate } from '../../utils/format'

/**
 * Item Quick Referencer / History (legacy frmRptStkRef). Find an item by code or name; see its UOM and group, stock on
 * hand (total + per location), the latest entry per transaction document, and the item's transactions between two dates
 * (every document, or the one chosen). Documents and columns come from the backend (UtlTransactions), per client.
 */
export default function ItemReferencerPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [itemId, setItemId] = useState(null)
  const [useTrn, setUseTrn] = useState(false)
  const [doc, setDoc] = useState(null)
  const [from, setFrom] = useState(null)
  const [to, setTo] = useState(new Date())
  const [query, setQuery] = useState(null)

  const { data: matches = [] } = useQuery({ queryKey: ['ref-items', search], queryFn: () => inventoryApi.referencerItems(search), enabled: search.trim().length > 0 && !itemId })
  const { data: info } = useQuery({ queryKey: ['ref-item', itemId], queryFn: () => inventoryApi.referencerItem(itemId), enabled: Boolean(itemId) })
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['ref-trn', itemId, query],
    queryFn: () => inventoryApi.referencerTransactions(itemId, query),
    enabled: Boolean(itemId && query),
  })

  // Legacy FillItemDtls: From = financial-year start, To = today, then Load.
  useEffect(() => {
    if (!info) return
    const start = new Date(info.fy_start)
    const today = new Date()
    setFrom(start)
    setTo(today)
    setQuery({ from_date: isoDate(start), to_date: isoDate(today) })
  }, [info])

  function pick(m) {
    setItemId(m.id)
    setSearch(m.code)
    setDoc(null)
    setUseTrn(false)
    setQuery(null)
  }
  const load = () => setQuery({ from_date: isoDate(from), to_date: isoDate(to), ...(useTrn && doc ? { doc_name: doc } : {}) })

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Item Quick Referencer / History" subtitle="Stock on hand and the latest activity of one item" shortcuts={[]} />

      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput
              className="vt-field-required"
              label="Item Code"
              leftSection={<Search size={16} />}
              placeholder="Type item code or name"
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value)
                setItemId(null)
                setQuery(null)
              }}
              rightSection={search ? <X size={14} style={{ cursor: 'pointer' }} aria-label="Clear" onClick={() => { setSearch(''); setItemId(null); setQuery(null) }} /> : null}
            />
            {!itemId && search.trim() && matches.length > 0 && (
              <Card withBorder p={4} mt={4} mah={220} style={{ overflow: 'auto' }}>
                {matches.map((m) => (
                  <Group key={m.id} gap="sm" p={6} style={{ cursor: 'pointer', borderRadius: 8 }} className="vt-lift" onClick={() => pick(m)}>
                    <Text fw={600} size="sm">{m.code}</Text>
                    <Text size="sm" c="dimmed">{m.name}</Text>
                  </Group>
                ))}
              </Card>
            )}
          </Grid.Col>
          {info && (
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Group gap="sm" wrap="wrap">
                <Text fw={600}>{info.name}</Text>
                <Text size="sm" c="dimmed">Grouped Under : {info.group}</Text>
                <Badge variant="light" color="gold" c="var(--vt-badge-ink)">UOM : {info.uom}</Badge>
                {info.bom_available && <Badge variant="light" color="kumkum">BOM Available</Badge>}
                <Badge size="lg" variant="light" color="kumkum">Stock on Hand : {info.qoh.toFixed(2)}</Badge>
              </Group>
            </Grid.Col>
          )}
        </Grid>
      </Card>

      {info && (
        <>
          <Grid>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Text fw={600} mb={6}>Stock by location</Text>
              <ReportTable
                columns={[{ key: 'location', label: 'Location' }, { key: 'qoh', label: 'QOH', num: true }]}
                rows={info.by_location}
                emptyTitle="No stock"
                emptyHint="No stock movement for this item in the active financial year."
                minWidth={280}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Text fw={600} mb={6}>Latest entry per document</Text>
              <ReportTable
                columns={[{ key: 'group', label: 'Group' }, { key: 'doc_name', label: 'Document' }, { key: 'info', label: 'Doc-Info' }]}
                rows={info.last_transactions}
                emptyTitle="No transactions"
                emptyHint="This item has not been used in any document this financial year."
                minWidth={420}
              />
            </Grid.Col>
          </Grid>

          <Card withBorder p="md">
            <Group align="flex-end" gap="md" wrap="wrap">
              <Checkbox color="kumkum" label="Transactions" checked={useTrn} onChange={(e) => setUseTrn(e.currentTarget.checked)} mb={8} />
              <Select aria-label="Transaction document" placeholder="All documents" data={info.docs} value={doc} onChange={setDoc} disabled={!useTrn} searchable clearable w={240} />
              <DatePickerInput className="vt-field-required" label="From" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={150} />
              <DatePickerInput className="vt-field-required" label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={150} />
              <Button color="kumkum" onClick={load} disabled={!from || !to}>Load</Button>
            </Group>
          </Card>

          <ReportTable
            columns={[
              { key: 'doc_name', label: 'Doc Name' },
              { key: 'doc_no', label: 'Doc No' },
              { key: 'doc_date', label: 'Doc Date', render: (r) => dayjs(r.doc_date).format('DD/MM/YYYY') },
              { key: 'party_code', label: 'Party Code' },
              { key: 'qty', label: 'Doc Qty', num: true },
              { key: 'uom', label: 'UOM' },
              { key: 'rate', label: 'Doc Rate', num: true },
            ]}
            rows={rows}
            loading={isFetching}
            idle={!query}
            idleTitle="Press Load"
            idleHint="Choose the dates (and a document if needed) and press Load."
            emptyTitle="No transactions in this period"
            minWidth={720}
          />
        </>
      )}
      <Group justify="flex-end">
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
    </Stack>
  )
}
