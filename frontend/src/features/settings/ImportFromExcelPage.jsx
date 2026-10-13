import { useState } from 'react'
import { Alert, Badge, Button, Card, Checkbox, FileInput, Group, Select, Stack, Table, Text } from '@mantine/core'
import { AlertCircle, Download, FileSpreadsheet, FileUp, Upload, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as metaApi from '../../api/endpoints/meta'
import * as excelImportApi from '../../api/endpoints/excelImport'
import EmptyState from '../../components/ui/EmptyState'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { downloadCsv } from '../../utils/csv'

const INFO_ROWS = [
  ['Data Type', 'data_type'],
  ['Mandatory', 'mandatory'],
  ['Foreign Key', 'foreign_key'],
  ['Max length', 'max_length'],
  ['Unique', 'unique'],
  ['Example', 'example'],
  ['Default Value', 'default'],
]

/**
 * Import from Excel (legacy frmUtlImportXL), Panchanga-style: pick the document, Generate Template, fill it in Excel,
 * Load from Excel to review the rows, then Import data to database. The info grid under the pickers lists every
 * template column with its type, mandatory / foreign key / unique flags, length and default. Masters only (see
 * app/services/excel_import.py). "Not according to template" and "Clear existing data" are legacy options the web app
 * does not offer (the import never deletes existing data).
 */
export default function ImportFromExcelPage() {
  const navigate = useNavigate()
  const [docId, setDocId] = useState(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState('')
  const [loaded, setLoaded] = useState(null) // preview of the file
  const [result, setResult] = useState(null)

  const { data: menu } = useQuery({ queryKey: ['menu'], queryFn: metaApi.getMenu })
  const masterOptions = (menu || []).filter((m) => m.type === 'Masters' && m.doc_id).map((m) => ({ value: String(m.doc_id), label: m.caption }))
  const { data: fields } = useQuery({ queryKey: ['import-fields', docId], queryFn: () => excelImportApi.getImportFields(docId), enabled: Boolean(docId) })
  const fail = (err, fallback) => notifications.show({ message: err?.response?.data?.detail || fallback, color: 'red' })

  async function onTemplate() {
    setBusy('tpl')
    try {
      const blob = await excelImportApi.downloadImportTemplate(docId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `import_template_${docId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      fail(err, 'Could not generate template')
    } finally {
      setBusy('')
    }
  }
  async function onLoad() {
    setBusy('load')
    setResult(null)
    try {
      setLoaded(await excelImportApi.previewImport(docId, file))
    } catch (err) {
      setLoaded(null)
      fail(err, 'Could not read the Excel file')
    } finally {
      setBusy('')
    }
  }
  async function onImport() {
    setBusy('imp')
    try {
      const r = await excelImportApi.importFromExcel(docId, file)
      setResult(r)
      notifications.show({ message: `Created ${r.created}, failed ${r.failed}`, color: r.failed ? 'saffron' : 'teal' })
    } catch (err) {
      fail(err, 'Import failed')
    } finally {
      setBusy('')
    }
  }
  const docName = masterOptions.find((o) => o.value === docId)?.label

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title="Import from Excel"
        subtitle="Bulk-add master records from a spreadsheet."
        heading={docName || 'Choose a document'}
        sub="Import data"
        facts={[
          { label: 'template columns', value: fields ? fields.length : '-' },
          { label: 'records loaded', value: loaded ? loaded.total : 0 },
        ]}
        emblem={<FileSpreadsheet size={60} color="#F4E1A6" strokeWidth={1.4} />}
        actions={
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        }
      />

      <Card withBorder p="lg">
        <Stack gap="md">
          <Group align="flex-end" gap="md" wrap="wrap">
            <Select
              className="vt-field-required"
              label="Document"
              placeholder="Choose a master to import into"
              data={masterOptions}
              value={docId}
              onChange={(v) => {
                setDocId(v)
                setLoaded(null)
                setResult(null)
                setFile(null)
              }}
              searchable
              w={320}
            />
            <Button variant="light" color="kumkum" leftSection={<Download size={16} />} disabled={!docId} loading={busy === 'tpl'} onClick={onTemplate}>
              Generate Template
            </Button>
          </Group>
          <Group align="flex-end" gap="md" wrap="wrap">
            <FileInput
              className="vt-field-required"
              label="Select Excel File"
              placeholder="Choose the filled-in .xlsx file"
              leftSection={<FileSpreadsheet size={16} />}
              accept=".xlsx,.xls"
              value={file}
              onChange={(f) => {
                setFile(f)
                setLoaded(null)
                setResult(null)
              }}
              disabled={!docId}
              w={320}
            />
            <Button variant="light" color="kumkum" leftSection={<FileUp size={16} />} disabled={!file} loading={busy === 'load'} onClick={onLoad}>
              Load from Excel
            </Button>
            <Checkbox color="kumkum" label="Not according to template" disabled title="Not available in the web app" mb={8} />
            <Checkbox color="kumkum" label="Clear existing Data before Importing" disabled title="Not available: the web import never deletes existing data" mb={8} />
          </Group>
          <Text size="sm" fw={600} style={{ color: 'var(--vt-readonly-ink)' }}>
            {docId ? 'Fill the template, then Load from Excel to review it before importing.' : 'Please select a document'}
          </Text>
        </Stack>
      </Card>

      <Card withBorder p="lg">
        {!fields ? (
          <EmptyState icon={FileSpreadsheet} title="No document chosen" hint="The columns of its template are listed here." />
        ) : (
          <Stack gap="md">
            <Table.ScrollContainer minWidth={520}>
              <Table withTableBorder withColumnBorders>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th>Field Name</Table.Th>
                    {fields.map((f) => (
                      <Table.Th key={f.name}>{f.name}</Table.Th>
                    ))}
                  </Table.Tr>
                  {INFO_ROWS.map(([label, key]) => (
                    <Table.Tr key={key}>
                      <Table.Td fw={600}>{label}</Table.Td>
                      {fields.map((f) => (
                        <Table.Td key={f.name}>{f[key] ?? ''}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Text size="sm" fw={600}>
              Total Number of Records Loaded : <span className="vt-num" style={{ color: 'var(--vt-required-ink)' }}>{loaded ? loaded.total : 0}</span>
            </Text>
            {loaded && loaded.rows.length > 0 && (
              <Table.ScrollContainer minWidth={520} mah="40dvh">
                <Table stickyHeader highlightOnHover striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={70}>Row</Table.Th>
                      {loaded.columns.map((c) => (
                        <Table.Th key={c.key}>{c.label}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {loaded.rows.map((r) => (
                      <Table.Tr key={r.row}>
                        <Table.Td>{r.row}</Table.Td>
                        {loaded.columns.map((c) => (
                          <Table.Td key={c.key}>{r[c.key]}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            <Group justify="space-between" wrap="wrap">
              <Button
                variant="default"
                leftSection={<FileSpreadsheet size={16} />}
                disabled={!loaded?.rows?.length}
                onClick={() => downloadCsv(`${docName || 'import'}.csv`, loaded.rows, loaded.columns.map((c) => ({ label: c.label, value: (r) => r[c.key] })))}
              >
                Export to excel
              </Button>
              <Button color="kumkum" leftSection={<Upload size={16} />} disabled={!loaded?.total} loading={busy === 'imp'} onClick={onImport}>
                Import data to database
              </Button>
            </Group>
          </Stack>
        )}
      </Card>

      {result && (
        <Card withBorder p="lg">
          <Stack gap="xs">
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
              <>
                <Alert icon={<AlertCircle size={16} />} color="red" variant="light">
                  Fix the rows below in your Excel file and load it again. Rows that already succeeded will not be duplicated as long as their Code is unique.
                </Alert>
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
                      {result.rows
                        .filter((r) => r.status !== 'ok')
                        .map((r) => (
                          <Table.Tr key={r.row}>
                            <Table.Td>{r.row}</Table.Td>
                            <Table.Td>
                              <Badge size="sm" color="red" variant="light">
                                Error
                              </Badge>
                            </Table.Td>
                            <Table.Td>{r.message}</Table.Td>
                          </Table.Tr>
                        ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}
