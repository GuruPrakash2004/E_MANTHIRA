import { Alert, Group, Text } from '@mantine/core'
import { Info } from 'lucide-react'
import ExportExcelButton from '../../components/ui/ExportExcelButton'

const th = { textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', position: 'sticky', top: 0, background: 'var(--vt-sandal)', whiteSpace: 'nowrap' }
const td = { padding: '5px 10px', borderBottom: '1px solid var(--vt-line)', whiteSpace: 'nowrap', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }

/** The grid of a query result + "Total no of rows" + export. `result` is what POST /admin-tools/.../run returns. */
export default function QueryResult({ result, filename = 'query' }) {
  if (!result) return null
  const rows = result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]])))
  return (
    <div>
      <Group justify="space-between" mb={6} wrap="wrap">
        <Text size="sm" fw={700}>Total no of rows : {result.row_count} <Text span size="xs" c="dimmed">({result.ms} ms)</Text></Text>
        <ExportExcelButton filename={filename} rows={rows} columns={result.columns.map((c) => ({ label: c, key: c }))} />
      </Group>
      {result.truncated && <Alert icon={<Info size={16} />} color="orange" variant="light" mb={6}>Only the first {result.row_count} rows are shown.</Alert>}
      <div style={{ overflow: 'auto', maxHeight: '50vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12.5 }}>
          <thead><tr>{result.columns.map((c, i) => <th key={i} style={th}>{c}</th>)}</tr></thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 ? 'var(--vt-sandal)' : 'transparent' }}>
                {r.map((v, j) => <td key={j} title={v == null ? '' : String(v)} style={{ ...td, ...(typeof v === 'number' ? { textAlign: 'right' } : {}), ...(v === null ? { color: 'var(--mantine-color-dimmed)' } : {}) }}>{v === null ? 'NULL' : String(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const TableList = ({ tables, onPick, picked }) => (
  <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
    {tables.map((t) => (
      <button key={t.name} type="button" onClick={() => onPick(t.name)} style={{ all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', padding: '5px 8px', cursor: 'pointer', fontSize: 13, borderRadius: 6, background: picked === t.name ? 'var(--vt-gold-chip)' : 'transparent' }}>
        {t.name}
      </button>
    ))}
  </div>
)
