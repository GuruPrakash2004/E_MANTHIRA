import { useState } from 'react'
import { Alert, Button, Card, Grid, Group, Select, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { FileSpreadsheet, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { downloadXls } from '../../utils/xls'
import * as tradeApi from '../../api/endpoints/tradeReports'
import { ReportTable } from '../inventory/ReportParts'
import { PageHeader } from '../../components/ui/EntryParts'

/**
 * Stock Level Report — port of frmRptStockLevel. The legacy screen has no fixed layout: each report is a stored
 * SQL template (UtlStkLevelReport.SRptName/StkQuery, with <<CFDATE>>/<<CTDATE>> placeholders) picked from a combo.
 * Templates are authored in the legacy Designer; this page only lists and runs them (read-only, single SELECT).
 */
export default function StockLevelPage() {
  const [template, setTemplate] = useState(null)
  const [asOn, setAsOn] = useState(new Date())
  const navigate = useNavigate()

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({ queryKey: ['stock-level-templates'], queryFn: tradeApi.getStockLevelTemplates })
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-level', template, asOn],
    queryFn: () => tradeApi.getStockLevel({ template, as_on: dayjs(asOn).format('YYYY-MM-DD') }),
    enabled: Boolean(template),
  })

  const columns = (data?.columns || []).map((c, i) => ({
    key: String(i),
    label: c,
    num: (data.rows || []).some((r) => typeof r[i] === 'number'),
  }))
  const rows = (data?.rows || []).map((r) => Object.fromEntries(r.map((v, i) => [String(i), typeof v === 'number' ? v.toLocaleString('en-IN') : v ?? ''])))

  return (
    <Stack gap="lg" className="vt-rise">
      <PageHeader title="Stock Level Report" subtitle="Run a stock report template defined in the Report Designer" shortcuts={[]} />

      <Card withBorder p="lg">
        <Grid align="flex-end">
          <Grid.Col span={{ base: 12, sm: 6, md: 5 }}>
            <Select label="Select Report" data={templates} value={template} onChange={setTemplate} searchable placeholder={loadingTemplates ? 'Loading...' : 'Choose a report'} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <DateInput label="As On" value={asOn} onChange={setAsOn} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Group justify="flex-end" gap="sm">
              <Button variant="light" color="kumkum" leftSection={<FileSpreadsheet size={16} />} disabled={!(data?.rows || []).length} onClick={() => downloadXls(`${template}.xls`, data.rows, data.columns.map((c, i) => ({ label: c, value: (r) => r[i] })))}>Excel</Button>
              <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
            </Group>
          </Grid.Col>
        </Grid>
      </Card>

      {!loadingTemplates && templates.length === 0 && (
        <Alert color="kumkum" variant="light" title="No report templates yet">
          <Text size="sm">
            This database has no Stock Level report templates (UtlStkLevelReport is empty). Templates are created in the legacy Report Designer; once one is
            saved it appears in the list above.
          </Text>
        </Alert>
      )}
      {error && (
        <Alert color="red" variant="light" role="alert">
          {error?.response?.data?.detail || 'Could not run this report'}
        </Alert>
      )}
      {data?.truncated && <Alert color="yellow" variant="light">Showing the first 5,000 rows only.</Alert>}

      <ReportTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        idle={!template}
        idleTitle="Choose a report"
        idleHint="Pick a report template to run it."
        emptyTitle="There are no items to report under this criteria"
        minWidth={640}
      />
    </Stack>
  )
}
