import { Button, Tooltip, ActionIcon } from '@mantine/core'
import { FileSpreadsheet } from 'lucide-react'
import { downloadXls } from '../../utils/xls'
import ReportPrintButtons from './ReportPrint'

/**
 * One "Export to Excel" button for any list: `rows` are the objects shown, `columns` = [{ label, key | value(row) }].
 * `iconOnly` gives a compact icon for card headers. Disabled while there is nothing to export.
 */
export default function ExportExcelButton({ filename, rows = [], columns, label = 'Export to Excel', iconOnly = false, title, print, ...rest }) {
  const disabled = rows.length === 0
  const go = () => downloadXls(filename, rows, columns, title)
  if (iconOnly) {
    return (
      <Tooltip label={label} withArrow>
        <ActionIcon variant="light" color="kumkum" size={32} aria-label={label} disabled={disabled} onClick={go} {...rest}>
          <FileSpreadsheet size={16} />
        </ActionIcon>
      </Tooltip>
    )
  }
  const excel = (
    <Button variant="default" size="xs" leftSection={<FileSpreadsheet size={14} />} disabled={disabled} onClick={go} {...rest}>
      {label}
    </Button>
  )
  if (!print) return excel
  // print={{ title, period, filters, groupKey }}: Preview + Print of the same rows / columns beside the Excel button
  return (
    <>
      <ReportPrintButtons size="xs" title={filename} {...print} columns={columns} rows={rows} />
      {excel}
    </>
  )
}
