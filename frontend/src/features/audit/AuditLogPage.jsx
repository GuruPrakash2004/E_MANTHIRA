import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Group, Radio, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, ListChecks, Pin, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as auditApi from '../../api/endpoints/audit'
import ScaleGrid from '../../components/ui/ScaleGrid'
import { PageHeader } from '../../components/ui/EntryParts'
import { downloadXls } from '../../utils/xls'
import { isoDate } from '../../utils/format'

/**
 * Audit Log (legacy frmUtlRecAuditLog): pick Masters or Transactions, the document, optionally a modified-between date
 * range, and Load. Entries come from this app's audit table (the legacy separate log database is not part of this
 * deployment). Freeze keeps the first column in view while scrolling sideways.
 */
export default function AuditLogPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState('master')
  const [doc, setDoc] = useState(null)
  const [useDate, setUseDate] = useState(true)
  const [from, setFrom] = useState(new Date())
  const [to, setTo] = useState(new Date())
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [frozen, setFrozen] = useState(false)

  const { data: docs = [] } = useQuery({ queryKey: ['audit-docs', kind], queryFn: () => auditApi.auditDocuments(kind) })
  useEffect(() => { setDoc(null); setRows(null) }, [kind])

  async function load() {
    if (useDate && dayjs(from).isAfter(dayjs(to), 'day')) return notifications.show({ message: 'From date Should Be less than To Date!', color: 'red' })
    if (!doc) return notifications.show({ message: `${kind === 'master' ? 'Master' : 'Transaction'} field Should Not be empty!!`, color: 'red' })
    setLoading(true)
    try {
      const r = await auditApi.listAuditLog({ entity: doc, from_date: useDate ? isoDate(from) : '2000-01-01', to_date: useDate ? isoDate(to) : isoDate(new Date()), top: 5000 })
      setRows(r)
      if (r.length === 0) notifications.show({ message: 'No Records found', color: 'yellow' })
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not load the audit log', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  const columns = useMemo(
    () => [
      { key: 'at', label: 'Action Date Time', width: 170, render: (r) => dayjs(r.at).format('DD/MM/YYYY HH:mm:ss') },
      { key: 'entity', label: 'Document', width: 200 },
      { key: 'entity_id', label: 'Record', width: 110 },
      { key: 'action_label', label: 'Action', width: 110 },
      { key: 'user_code', label: 'User', width: 120 },
      { key: 'details', label: 'Details', width: 460 },
    ],
    []
  )
  const shown = (rows || []).map((r) => ({ ...r, _key: r.id }))

  return (
    <Stack gap="md" className="vt-rise">
      <PageHeader title="Audit Log" subtitle="What was added, changed or deleted, by whom and when" shortcuts={[]} />
      <Card withBorder p="md">
        <Stack gap="sm">
          <Radio.Group value={kind} onChange={setKind} aria-label="Audit log type">
            <Group gap="lg"><Radio color="kumkum" value="master" label="Masters" /><Radio color="kumkum" value="transaction" label="Transactions" /></Group>
          </Radio.Group>
          <Select className="vt-field-required" aria-label={kind === 'master' ? 'Master' : 'Transaction'} placeholder={kind === 'master' ? 'Select master' : 'Select transaction'} searchable data={docs} value={doc} onChange={setDoc} maw={420} />
          <Checkbox color="kumkum" label="Modified Between Date Range" checked={useDate} onChange={(e) => setUseDate(e.currentTarget.checked)} />
          {useDate && (
            <Group gap="md" align="flex-end">
              <DatePickerInput label="From" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} w={150} />
              <DatePickerInput label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} w={150} />
              <Button color="kumkum" leftSection={<ListChecks size={16} />} loading={loading} onClick={load}>Load</Button>
            </Group>
          )}
          {!useDate && <Group><Button color="kumkum" leftSection={<ListChecks size={16} />} loading={loading} onClick={load}>Load</Button></Group>}
          <Text size="sm" fw={600}>Total Records Loaded : {rows ? rows.length : ''}</Text>
        </Stack>
      </Card>

      <ScaleGrid columns={columns} rows={shown} loading={loading} emptyTitle={rows ? 'No records found' : 'Press Load'} emptyHint={rows ? 'Nothing was logged for this document in that period.' : 'Choose the document and press Load.'} frozenCols={frozen ? 1 : 0} />

      <Group justify="space-between">
        <Group gap="sm">
          <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!shown.length} onClick={() => downloadXls('Audit Log.xls', shown, columns.map((c) => ({ label: c.label, value: (r) => (c.render ? c.render(r) : r[c.key]) })))}>Excel</Button>
          <Button variant={frozen ? 'filled' : 'default'} color="kumkum" leftSection={<Pin size={16} />} onClick={() => setFrozen((f) => !f)} aria-pressed={frozen}>{frozen ? 'UnFreeze' : 'Freeze'}</Button>
        </Group>
        <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
      </Group>
    </Stack>
  )
}
