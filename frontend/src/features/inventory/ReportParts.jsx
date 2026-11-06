import { Card } from '@mantine/core'
import { FileSearch } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import DataGrid from '../../components/ui/DataGrid'

/**
 * Shared results table for the inventory report screens. Handles the four states every one of them has:
 * nothing chosen yet (`idle`), loading, no rows, and rows. Columns: { key, label, num?, render?(row) }.
 */
export function ReportTable({ columns, rows, loading, idle, idleTitle, idleHint, emptyTitle = 'No records found', emptyHint, footer, name }) {
  if (idle) {
    return (
      <Card withBorder>
        <EmptyState icon={FileSearch} title={idleTitle} hint={idleHint} />
      </Card>
    )
  }
  if (loading) return <DataGrid columns={columns} rows={[]} loading />
  return <DataGrid columns={columns} rows={rows || []} name={name || emptyTitle} emptyTitle={emptyTitle} emptyHint={emptyHint} footer={footer} maxHeight={620} />
}
