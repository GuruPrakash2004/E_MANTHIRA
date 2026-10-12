import { Card, Skeleton, Stack, Table } from '@mantine/core'
import { FileSearch } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'

/**
 * Shared results table for the inventory report screens. Handles the four states every one of them has:
 * nothing chosen yet (`idle`), loading, no rows, and rows. Columns: { key, label, num?, render?(row) }.
 */
export function ReportTable({ columns, rows, loading, idle, idleTitle, idleHint, emptyTitle = 'No records found', emptyHint, footer, minWidth = 640 }) {
  if (idle) {
    return (
      <Card withBorder>
        <EmptyState icon={FileSearch} title={idleTitle} hint={idleHint} />
      </Card>
    )
  }
  if (loading) {
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
  return (
    <Card withBorder p={0} style={{ overflow: 'hidden' }}>
      {(rows || []).length === 0 ? (
        <EmptyState icon={FileSearch} title={emptyTitle} hint={emptyHint} />
      ) : (
        <Table.ScrollContainer minWidth={minWidth} mah={620} type="native">
          <Table striped highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                {columns.map((c) => (
                  <Table.Th key={c.key} ta={c.num ? 'right' : undefined}>
                    {c.label}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={i}>
                  {columns.map((c) => (
                    <Table.Td key={c.key} ta={c.num ? 'right' : undefined} className={c.num ? 'vt-num' : undefined}>
                      {c.render ? c.render(r) : r[c.key]}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
            {footer && <Table.Tfoot>{footer}</Table.Tfoot>}
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}
