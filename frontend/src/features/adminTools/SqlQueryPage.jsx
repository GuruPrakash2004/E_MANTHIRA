import { useState } from 'react'
import { Alert, Badge, Button, Card, Group, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { useHotkeys } from 'react-hotkeys-hook'
import { Database, Play, Search, ShieldCheck } from 'lucide-react'
import * as api from '../../api/endpoints/adminTools'
import UtilityBanner from '../../components/ui/UtilityBanner'
import QueryResult, { TableList } from './QueryResult'

/**
 * SQL Query Execution (legacy frmUtlSQLQueryExec), read-only: one SELECT per run, ADMIN only. The server validates the
 * statement, runs it under a rollback with a row cap, masks secret-looking columns and writes the run to the audit log.
 * The table list and the server / database names come from the database.
 */
export default function SqlQueryPage() {
  const [q, setQ] = useState('')
  const [dq] = useDebouncedValue(q, 250)
  const [sql, setSql] = useState('')
  const [picked, setPicked] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const info = useQuery({ queryKey: ['sql-info'], queryFn: api.sqlInfo, retry: false })
  const tables = useQuery({ queryKey: ['sql-tables', dq], queryFn: () => api.sqlTables(dq), enabled: info.isSuccess })
  const cols = useQuery({ queryKey: ['sql-cols', picked], queryFn: () => api.sqlColumns(picked), enabled: Boolean(picked) })

  async function run() {
    if (!sql.trim() || running) return
    setRunning(true)
    setError('')
    try {
      setResult(await api.runSql(sql))
    } catch (e) {
      setResult(null)
      setError(e?.response?.data?.detail || 'Failed')
    } finally {
      setRunning(false)
    }
  }
  useHotkeys('ctrl+enter, f5', (e) => { e.preventDefault(); run() }, { enableOnFormTags: true }, [sql, running])

  const denied = info.isError && info.error?.response?.status === 403
  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title="SQL Query Execution"
        subtitle="Read data from the database with a SELECT query."
        heading={info.data ? info.data.database : ' '}
        sub={info.data?.server || ' '}
        facts={result ? [{ label: 'rows', value: result.row_count }] : []}
        emblem={<Database size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />
      {denied ? (
        <Alert color="red" variant="light" title="ADMIN only">Only the ADMIN user can use this tool.</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="lg" style={{ alignItems: 'start' }}>
          <Card withBorder p="md" style={{ gridColumn: 'span 1' }}>
            <TextInput leftSection={<Search size={15} />} placeholder="Search tables" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="xs" />
            <TableList tables={tables.data || []} picked={picked} onPick={(name) => { setPicked(name); setSql(`SELECT TOP 100 * FROM [${name}]`) }} />
            {picked && cols.data && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--vt-line)', paddingTop: 8 }}>
                <Text size="xs" fw={700} c="dimmed" mb={4}>{picked}</Text>
                {cols.data.map((c) => <Text key={c.name} size="xs">{c.name} <Text span c="dimmed">{c.type}{c.length ? `(${c.length})` : ''}</Text></Text>)}
              </div>
            )}
          </Card>
          <Stack gap="md" style={{ gridColumn: 'span 3' }}>
            <Card withBorder p="md">
              <Group gap={6} mb={6}><ShieldCheck size={15} color="var(--vt-accent)" /><Text size="xs" c="dimmed">Read-only: one SELECT per run, at most {info.data?.max_rows ?? '...'} rows. Ctrl+Enter runs it.</Text></Group>
              <Textarea aria-label="Query" autosize minRows={5} maxRows={14} styles={{ input: { fontFamily: 'monospace' } }} placeholder="SELECT TOP 100 * FROM ..." value={sql} onChange={(e) => setSql(e.currentTarget.value)} />
              <Group mt="sm"><Button color="kumkum" leftSection={<Play size={16} />} loading={running} disabled={!sql.trim()} onClick={run}>Execute Query</Button></Group>
            </Card>
            {error && <Alert color="red" variant="light" title="Message">{error}</Alert>}
            {result && <Card withBorder p="md"><QueryResult result={result} filename="query" /></Card>}
            {!result && !error && <Badge variant="light" color="gray" tt="none" w="fit-content">Pick a table on the left or type a query.</Badge>}
          </Stack>
        </SimpleGrid>
      )}
    </Stack>
  )
}
