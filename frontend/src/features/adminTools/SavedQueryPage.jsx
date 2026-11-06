import { useState } from 'react'
import { Alert, Button, Card, Group, Select, SimpleGrid, Skeleton, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Plus, Save, Trash2, FileSearch } from 'lucide-react'
import * as api from '../../api/endpoints/adminTools'
import EmptyState from '../../components/ui/EmptyState'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import QueryResult, { TableList } from './QueryResult'

/**
 * SQL Saved Query (legacy frmRptQuery): named SELECT queries in groups, kept in the EXE's `RptQuery` table. The groups and
 * queries are read from it; a database without the table says so. A stored query can only ever be a SELECT (the server checks
 * it on save and again on every run).
 */
export default function SavedQueryPage() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [group, setGroup] = useState(null)
  const [current, setCurrent] = useState(null) // saved name being viewed, or null while writing a new one
  const [form, setForm] = useState({ name: '', group: '', query: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [picked, setPicked] = useState(null)

  const list = useQuery({ queryKey: ['saved-queries', group], queryFn: () => api.savedList(group), retry: false })
  const tables = useQuery({ queryKey: ['saved-tables'], queryFn: () => api.savedTables(), enabled: Boolean(list.data?.available) })
  const fail = (e, fb) => notifications.show({ message: e?.response?.data?.detail || fb, color: 'red' })

  async function open(name) {
    try {
      const q = await api.savedGet(name)
      setCurrent(name)
      setForm({ name: q.name, group: q.group, query: q.query })
      setResult(null)
      setError('')
    } catch (e) {
      fail(e, 'Could not open the query')
    }
  }
  async function run() {
    setRunning(true)
    setError('')
    try {
      setResult(current ? await api.savedRun(current) : null)
      if (!current) setError('Save the query first, then view its result.')
    } catch (e) {
      setResult(null)
      setError(e?.response?.data?.detail || 'Failed')
    } finally {
      setRunning(false)
    }
  }
  async function save() {
    try {
      const r = await api.savedSave(form)
      notifications.show({ message: r.message, color: 'teal' })
      setCurrent(form.name.trim())
      qc.invalidateQueries({ queryKey: ['saved-queries'] })
    } catch (e) {
      fail(e, 'Error during save')
    }
  }
  async function remove() {
    if (!current || !(await confirm({ title: 'Remove this query?', message: `'${current}' will be removed from the list.`, confirmLabel: 'Remove' }))) return
    try {
      notifications.show({ message: (await api.savedDelete(current)).message, color: 'teal' })
      setCurrent(null)
      setForm({ name: '', group: '', query: '' })
      setResult(null)
      qc.invalidateQueries({ queryKey: ['saved-queries'] })
    } catch (e) {
      fail(e, 'Could not delete')
    }
  }

  const d = list.data
  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner title="SQL Saved Query" subtitle="Run the queries saved for this temple." heading={current || 'Query list'} sub="SQL Saved Query" facts={d?.available ? [{ label: 'queries', value: d.queries.length }] : []} emblem={<FileSearch size={60} color="#F4E1A6" strokeWidth={1.4} />} />
      {list.isLoading ? <Skeleton height={200} radius="md" /> : d && !d.available ? (
        <NotAvailableHere feature="SQL Saved Query" missing={d.missing} />
      ) : list.isError ? (
        <Alert color="red" variant="light">{list.error?.response?.data?.detail || 'You do not have access to this screen.'}</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg" style={{ alignItems: 'start' }}>
          <Card withBorder p="md">
            <Select label="Group Name" placeholder="All groups" clearable data={d.groups} value={group} onChange={setGroup} mb="sm" />
            {d.queries.length === 0 ? <EmptyState icon={FileSearch} title="No saved queries" hint="Write one on the right and Save it." /> : (
              <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
                {d.queries.map((x) => (
                  <button key={x.name} type="button" onClick={() => open(x.name)} style={{ all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', padding: '6px 8px', cursor: 'pointer', borderRadius: 6, fontSize: 13, background: current === x.name ? 'var(--vt-gold-chip)' : 'transparent' }}>
                    {x.name}<Text span size="xs" c="dimmed"> - {x.group}</Text>
                  </button>
                ))}
              </div>
            )}
            <Text size="xs" fw={700} c="dimmed" mt="md" mb={4}>Tables</Text>
            <TableList tables={tables.data || []} picked={picked} onPick={(n) => { setPicked(n); setCurrent(null); setForm((f) => ({ ...f, query: `SELECT * FROM [${n}]` })) }} />
          </Card>
          <Stack gap="md" style={{ gridColumn: 'span 2' }}>
            <Card withBorder p="md">
              <Group gap="sm" align="flex-end" wrap="wrap" mb="sm">
                <TextInput label="Query Name" w={260} disabled={Boolean(current)} value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
                <TextInput label="Group Name" w={200} disabled={Boolean(current)} list="vt-qgroups" value={form.group} onChange={(e) => setForm({ ...form, group: e.currentTarget.value })} />
                <datalist id="vt-qgroups">{d.groups.map((g) => <option key={g} value={g} />)}</datalist>
              </Group>
              <Textarea aria-label="Query" autosize minRows={5} maxRows={12} disabled={Boolean(current)} styles={{ input: { fontFamily: 'monospace' } }} value={form.query} onChange={(e) => setForm({ ...form, query: e.currentTarget.value })} />
              <Group mt="sm" gap="xs">
                <Button variant="default" leftSection={<Plus size={15} />} onClick={() => { setCurrent(null); setForm({ name: '', group: '', query: '' }); setResult(null); setError('') }}>New</Button>
                <Button color="kumkum" leftSection={<Save size={15} />} disabled={Boolean(current) || !form.name.trim() || !form.query.trim()} onClick={save}>Save</Button>
                <Button variant="light" color="kumkum" leftSection={<Play size={15} />} loading={running} disabled={!current} onClick={run}>View Result</Button>
                <Button variant="light" color="red" leftSection={<Trash2 size={15} />} disabled={!current} onClick={remove}>Remove</Button>
              </Group>
              <Text size="xs" c="dimmed" mt="xs">Only SELECT queries can be saved. Use single quotation marks for text, e.g. WHERE status = 'Y'.</Text>
            </Card>
            {error && <Alert color="red" variant="light" title="Message">{error}</Alert>}
            {result && <Card withBorder p="md"><QueryResult result={result} filename={current || 'query'} /></Card>}
          </Stack>
        </SimpleGrid>
      )}
    </Stack>
  )
}
