import { useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Group, Radio, Select, Skeleton, Stack, Tabs, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp, Pencil, Search, Trash2, Upload } from 'lucide-react'
import * as api from '../../api/endpoints/adminTools'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { saveBlob } from '../../utils/xls'

/**
 * Bulk Update (legacy frmUtlBulkUpdate): load up to 1000 rows of a table, filter them, then change one field of the rows
 * shown (Complete: rows whose value equals the current one get the new value; Partial: replace text inside the field) or
 * delete them. ADMIN only. The server only allows writable columns (never the key, computed, identity or secret ones), never
 * touches the books, never deletes documents, and does it all in one transaction with an audit entry.
 * The second tab uploads an Excel of item codes and HSN codes (legacy "Bulk Update for PreTime").
 */
export default function BulkUpdatePage() {
  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner title="Bulk Update" subtitle="Change or delete many records at once." heading="Bulk Update" sub="Admin" emblem={<Pencil size={60} color="#F4E1A6" strokeWidth={1.4} />} />
      <Tabs defaultValue="table" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="table">Table records</Tabs.Tab>
          <Tabs.Tab value="hsn">Item HSN upload</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="table" pt="md"><TablePanel /></Tabs.Panel>
        <Tabs.Panel value="hsn" pt="md"><HsnPanel /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', position: 'sticky', top: 0, background: 'var(--vt-sandal)', whiteSpace: 'nowrap' }
const td = { padding: '4px 8px', borderBottom: '1px solid var(--vt-line)', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }

function TablePanel() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [table, setTable] = useState(null)
  const [loaded, setLoaded] = useState(null) // the response of GET /bulk/tables/{name}
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({})
  const [field, setField] = useState(null)
  const [current, setCurrent] = useState('')
  const [mode, setMode] = useState('complete')
  const [partial, setPartial] = useState('')
  const [replace, setReplace] = useState('')
  const [busy, setBusy] = useState(false)

  const tables = useQuery({ queryKey: ['bulk-tables'], queryFn: api.bulkTables, retry: false })
  const fail = (e, fb) => notifications.show({ title: 'Could not do that', message: e?.response?.data?.detail || fb, color: 'red' })

  async function load(name = table) {
    if (!name) return
    setLoading(true)
    try {
      const r = await api.bulkRows(name, {})
      setLoaded(r)
      setFilters({})
      setField(null)
      setCurrent('')
      setReplace('')
      setPartial('')
    } catch (e) {
      fail(e, 'Please select a table from the drop down!')
    } finally {
      setLoading(false)
    }
  }

  const cols = loaded?.columns || []
  const visible = useMemo(() => {
    if (!loaded) return []
    return loaded.rows.filter((r) => Object.entries(filters).every(([c, v]) => !v || String(r[c] ?? '').toLowerCase().includes(v.toLowerCase())))
  }, [loaded, filters])
  const col = cols.find((c) => c.name === field)
  const keys = visible.map((r) => r[loaded.key])
  const used = (loaded?.total ?? 0) > (loaded?.shown ?? 0)

  async function doUpdate() {
    if (!(await confirm({ title: 'Update these records?', message: `${mode === 'partial' ? `Replace "${partial}" with "${replace}" in` : `Set ${field} to "${replace}" for`} ${keys.length} shown record${keys.length === 1 ? '' : 's'} of ${loaded.table}.`, confirmLabel: 'Update' }))) return
    setBusy(true)
    try {
      const r = await api.bulkUpdate({ table: loaded.table, keys, field, mode, current: mode === 'complete' ? current : null, partial, replace })
      notifications.show({ message: r.message, color: 'teal' })
      await load(loaded.table)
    } catch (e) {
      fail(e, 'Error during Update')
    } finally {
      setBusy(false)
    }
  }
  async function doDelete() {
    if (!(await confirm({ title: 'Delete these records?', message: `${keys.length} shown record${keys.length === 1 ? '' : 's'} will be deleted from ${loaded.table}. This cannot be undone.`, confirmLabel: 'Delete' }))) return
    setBusy(true)
    try {
      notifications.show({ message: (await api.bulkDelete({ table: loaded.table, keys })).message, color: 'teal' })
      await load(loaded.table)
    } catch (e) {
      fail(e, 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  if (tables.isError) return <Alert color="red" variant="light" title="ADMIN only">Only the ADMIN user can use this tool.</Alert>
  return (
    <Stack gap="md">
      <Card withBorder p="md">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select label="Table Name" w={300} searchable placeholder="Select a table" data={(tables.data || []).map((t) => t.name)} value={table} onChange={setTable} />
          <Button color="kumkum" leftSection={<Search size={15} />} loading={loading} disabled={!table} onClick={() => load()}>Show Record</Button>
          {loaded && <ExportExcelButton filename={loaded.table} rows={visible} columns={cols.map((c) => ({ label: c.name, key: c.name }))} />}
        </Group>
      </Card>
      {loading ? <Skeleton height={220} radius="md" /> : loaded && (
        <>
          {used && <Alert color="orange" variant="light">This table has {loaded.total} records; the first {loaded.shown} are loaded. Updates and deletes apply to the records shown below.</Alert>}
          {!loaded.editable_table && <Alert color="gray" variant="light">{loaded.table} is part of the books, so it can be viewed here but not changed.</Alert>}
          <Card withBorder p="md">
            <Group justify="space-between" mb={6}><Text size="sm" fw={700}>Total Number of Records Loaded : {visible.length}{visible.length !== loaded.rows.length ? ` of ${loaded.rows.length}` : ''}</Text>{(Object.values(filters).some(Boolean)) && <Button size="compact-xs" variant="subtle" color="kumkum" onClick={() => setFilters({})}>Clear filters</Button>}</Group>
            {loaded.rows.length === 0 ? <EmptyState icon={Pencil} title="No records" hint="This table has no records." /> : (
              <div style={{ overflow: 'auto', maxHeight: '45vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
                  <thead>
                    <tr>{cols.map((c) => <th key={c.name} style={th}>{c.name}{c.editable ? '' : ' *'}</th>)}</tr>
                    <tr>{cols.map((c) => <th key={c.name} style={{ ...th, top: 28, padding: '2px 4px' }}><input aria-label={`Filter ${c.name}`} placeholder="Filter" value={filters[c.name] || ''} onChange={(e) => setFilters((f) => ({ ...f, [c.name]: e.target.value }))} style={{ width: '100%', minWidth: 70, height: 24, fontSize: 12, borderRadius: 5, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', color: 'inherit', padding: '0 6px' }} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r[loaded.key]}>
                        {cols.map((c) => (
                          <td key={c.name} title={r[c.name] == null ? '' : String(r[c.name])} style={td} onDoubleClick={c.editable && loaded.editable_table ? () => { setField(c.name); setCurrent(r[c.name] == null ? '' : String(r[c.name])) } : undefined}>{r[c.name] == null ? '' : String(r[c.name])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Text size="xs" c="dimmed" mt={4}>* cannot be changed here (key, computed, identity or secret). Double-click a cell of a changeable column to pick that field and its current value.</Text>
          </Card>

          {loaded.editable_table && loaded.rows.length > 0 && (
            <Card withBorder p="md">
              <Text fw={700} mb="xs">Updation</Text>
              <Radio.Group value={mode} onChange={setMode} mb="sm"><Group><Radio color="kumkum" value="complete" label="Complete Field Updation" /><Radio color="kumkum" value="partial" label="Partial Field Updation" /></Group></Radio.Group>
              <Group gap="sm" align="flex-end" wrap="wrap">
                <Select label="Fields" w={220} searchable placeholder="Choose" data={cols.filter((c) => c.editable).map((c) => c.name)} value={field} onChange={setField} />
                {mode === 'complete' ? <TextInput label="Current value" w={200} description="empty = any / blank" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} /> : <TextInput label="Text to replace" w={200} value={partial} onChange={(e) => setPartial(e.currentTarget.value)} />}
                <TextInput label="Replace With Value" w={240} description={col?.length ? `at most ${col.length} characters` : col?.type} value={replace} onChange={(e) => setReplace(e.currentTarget.value)} />
                <Button color="kumkum" leftSection={<Pencil size={15} />} loading={busy} disabled={!field || keys.length === 0 || (mode === 'partial' && !partial)} onClick={doUpdate}>Update</Button>
              </Group>
              {loaded.deletable_table ? (
                <Group mt="md" gap="sm"><Badge variant="light" color="red" tt="none">Deletion</Badge><Button variant="light" color="red" leftSection={<Trash2 size={15} />} loading={busy} disabled={keys.length === 0} onClick={doDelete}>Delete shown records</Button></Group>
              ) : <Text size="xs" c="dimmed" mt="md">Records of this table are not deleted here (documents and the books are deleted on their own screens, which also reverse their ledger postings).</Text>}
            </Card>
          )}
        </>
      )}
    </Stack>
  )
}

function HsnPanel() {
  const [file, setFile] = useState(null)
  const [prev, setPrev] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const fail = (e, fb) => notifications.show({ title: 'Could not do that', message: e?.response?.data?.detail || fb, color: 'red' })

  async function pick(f) {
    setFile(f)
    setPrev(null)
    if (!f) return
    try {
      setPrev(await api.hsnPreview(f))
    } catch (e) {
      fail(e, 'Please select a valid file for importing')
    }
  }
  async function apply() {
    setBusy(true)
    try {
      const r = await api.hsnApply(file)
      notifications.show({ message: `${r.message}${r.skipped ? `, ${r.skipped} skipped` : ''}`, color: 'teal' })
      setPrev(null)
      setFile(null)
    } catch (e) {
      fail(e, 'Update failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack gap="md">
      <Card withBorder p="md">
        <Group gap="sm" wrap="wrap">
          <Button variant="default" leftSection={<Download size={15} />} onClick={async () => saveBlob(await api.hsnTemplate(), 'HSN Template.xlsx')}>Template</Button>
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
          <Button variant="light" color="kumkum" leftSection={<FileUp size={15} />} onClick={() => input.current?.click()}>{file ? file.name : 'Select File'}</Button>
          <Button color="kumkum" leftSection={<Upload size={15} />} loading={busy} disabled={!prev?.available || prev.ok === 0} onClick={apply}>Upload</Button>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">The file needs two columns: ItemCode and HSNCode. Items that are not found, or rows with an empty or too long code, are skipped.</Text>
      </Card>
      {prev && !prev.available && <NotAvailableHere feature="Item HSN upload" missing={prev.missing} />}
      {prev?.available && (
        <Card withBorder p="md">
          <Text size="sm" fw={700} mb={6}>{prev.ok} to update, {prev.skipped} skipped</Text>
          <div style={{ overflow: 'auto', maxHeight: '45vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
              <thead><tr>{['Row', 'ItemCode', 'Current HSN', 'New HSN', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{prev.rows.map((r) => <tr key={r.row} style={r.ok ? undefined : { color: 'var(--mantine-color-red-7)' }}><td style={td}>{r.row}</td><td style={td}>{r.item_code}</td><td style={td}>{r.current_hsn}</td><td style={td}>{r.hsn}</td><td style={td}>{r.problem}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}
    </Stack>
  )
}
