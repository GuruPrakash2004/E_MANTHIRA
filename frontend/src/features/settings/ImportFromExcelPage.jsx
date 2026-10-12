import { useState } from 'react'
import { Alert, Badge, Button, Card, FileInput, Group, Select, Stack, Table, Text, Title } from '@mantine/core'
import { AlertCircle, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'
import * as excelImportApi from '../../api/endpoints/excelImport'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

/**
 * Import from Excel — port of the legacy frmUtlImportXL ("Import Data from
 * Excel..."). Scoped to masters only (see app/services/excel_import.py's
 * docstring for why transactional documents aren't included here) — pick
 * a master, download its template (columns = real DocShForm Code/Name +
 * any designer-added fields), fill it in Excel, upload it back. Rows that
 * fail validation are listed with their reason; valid rows are still
 * created (same "flag erroneous rows, import what's valid" behaviour as
 * the legacy screen).
 */
export default function ImportFromExcelPage() {
  const [docId, setDocId] = useState(null)
  const [file, setFile] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const { data: menu } = useQuery({ queryKey: ['menu'], queryFn: metaApi.getMenu })
  const masterOptions = (menu || [])
    .filter((m) => m.type === 'Masters' && m.doc_id)
    .map((m) => ({ value: String(m.doc_id), label: m.caption }))

  async function onDownloadTemplate() {
    setDownloading(true)
    try {
      const blob = await excelImportApi.downloadImportTemplate(docId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `import_template_${docId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not generate template', color: 'red' })
    } finally {
      setDownloading(false)
    }
  }

  async function onImport() {
    if (!file) {
      notifications.show({ message: 'Choose a filled-in Excel file first', color: 'red' })
      return
    }
    setImporting(true)
    setResult(null)
    try {
      const r = await excelImportApi.importFromExcel(docId, file)
      setResult(r)
      notifications.show({ message: `Created ${r.created}, failed ${r.failed}`, color: r.failed ? 'saffron' : 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Import failed', color: 'red' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Import from Excel
          </Title>
          <Text size="sm" c="dimmed">
            Bulk-add master records from a spreadsheet
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Stack>
          <Select
            label="Master"
            placeholder="Choose a master to import into"
            data={masterOptions}
            value={docId}
            onChange={(v) => {
              setDocId(v)
              setResult(null)
              setFile(null)
            }}
            searchable
          />

          {docId && (
            <>
              <Group>
                <Button variant="light" color="gray" leftSection={<Download size={16} />} loading={downloading} onClick={onDownloadTemplate}>
                  1. Download Template
                </Button>
              </Group>

              <FileInput
                label="2. Fill it in Excel, then upload it here"
                placeholder="Choose the filled-in .xlsx file"
                leftSection={<FileSpreadsheet size={16} />}
                accept=".xlsx,.xls"
                value={file}
                onChange={setFile}
              />

              <Group>
                <Button color="kumkum" leftSection={<Upload size={16} />} loading={importing} disabled={!file} onClick={onImport}>
                  3. Import
                </Button>
              </Group>
            </>
          )}

          {result && (
            <Stack gap="xs" mt="md">
              <Group gap="xs">
                <Badge color="teal" variant="light">
                  {result.created} created
                </Badge>
                {result.failed > 0 && (
                  <Badge color="red" variant="light">
                    {result.failed} failed
                  </Badge>
                )}
              </Group>
              {result.failed > 0 && (
                <Alert icon={<AlertCircle size={16} />} color="red" variant="light">
                  Fix the rows below in your Excel file and re-upload just those rows — rows that already succeeded won't be duplicated as long as their Code is unique.
                </Alert>
              )}
              <Table.ScrollContainer minWidth={400}>
                <Table striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Excel Row</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Detail</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.rows.map((r) => (
                      <Table.Tr key={r.row}>
                        <Table.Td>{r.row}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" color={r.status === 'ok' ? 'teal' : 'red'} variant="light">
                            {r.status === 'ok' ? 'Created' : 'Error'}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{r.status === 'ok' ? `ID ${r.id}` : r.message}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  )
}
