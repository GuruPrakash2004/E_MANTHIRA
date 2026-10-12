import { useState } from 'react'
import { Alert, Button, Card, Grid, Group, Select, Stack, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { AlertCircle, FileArchive } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as printApi from '../../api/endpoints/print'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'

// The documents that have print options configured (UtlOption) — same set
// CLAUDE.md §6's domain cheat-sheet lists as printable.
const DOCS = [
  { doc_id: 1263, label: 'Seva Entry' },
  { doc_id: 1261, label: 'Donation Reciept Entry' },
  { doc_id: 1281, label: 'Hall Booking' },
  { doc_id: 1224, label: 'Payment Voucher' },
  { doc_id: 1248, label: 'Receipt Voucher' },
]

/**
 * PDF Generator (bulk) — port of the legacy "PDF Generator - Bulk" form
 * (frmUtlBulkPDFGenerator): pick a document + print format + date range,
 * get a PDF for every matching record. The legacy form wrote one file per
 * record into a chosen folder; here the backend zips them and the browser
 * downloads the zip (see GET /print/{doc}/{option}/bulk-pdf).
 */
export default function PdfGeneratorPage() {
  const [docId, setDocId] = useState(null)
  const [optionName, setOptionName] = useState(null)
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').toDate())
  const [toDate, setToDate] = useState(new Date())
  const [generating, setGenerating] = useState(false)

  const { data: options } = useQuery({
    queryKey: ['print-options', docId],
    queryFn: () => printApi.getPrintOptions(Number(docId)),
    enabled: Boolean(docId),
  })

  async function onGenerate() {
    if (!docId || !optionName) {
      notifications.show({ message: 'Choose a document and a print format', color: 'red' })
      return
    }
    setGenerating(true)
    try {
      const blob = await printApi.bulkPdf(docId, optionName, dayjs(fromDate).format('YYYY-MM-DD'), dayjs(toDate).format('YYYY-MM-DD'))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${optionName}_${dayjs(fromDate).format('YYYYMMDD')}_${dayjs(toDate).format('YYYYMMDD')}.zip`
      a.click()
      URL.revokeObjectURL(url)
      notifications.show({ message: 'Downloaded', color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not generate PDFs', color: 'red' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            PDF Generator
          </Title>
          <Text size="sm" c="dimmed">
            One PDF per record for a date range, zipped for download
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="lg">
        <Stack>
          <Grid align="flex-end">
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select
                label="Document"
                data={DOCS.map((d) => ({ value: String(d.doc_id), label: d.label }))}
                value={docId}
                onChange={(v) => {
                  setDocId(v)
                  setOptionName(null)
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select
                label="Print Format"
                data={(options || []).filter((o) => o.available).map((o) => ({ value: o.option_name, label: o.option_name }))}
                value={optionName}
                onChange={setOptionName}
                disabled={!docId}
                placeholder={docId ? 'Choose a format' : 'Choose a document first'}
              />
            </Grid.Col>
          </Grid>
          <Grid align="flex-end">
            <Grid.Col span={{ base: 6, md: 3 }}>
              <DateInput label="From" value={fromDate} onChange={setFromDate} valueFormat="DD/MM/YYYY" />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 3 }}>
              <DateInput label="To" value={toDate} onChange={setToDate} valueFormat="DD/MM/YYYY" />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Button leftSection={<FileArchive size={16} />} color="kumkum" loading={generating} onClick={onGenerate} fullWidth>
                Generate &amp; Download
              </Button>
            </Grid.Col>
          </Grid>
          <Alert icon={<AlertCircle size={16} />} color="gray" variant="light">
            Limited to 200 records per download — narrow the date range if there are more.
          </Alert>
        </Stack>
      </Card>
    </Stack>
  )
}
