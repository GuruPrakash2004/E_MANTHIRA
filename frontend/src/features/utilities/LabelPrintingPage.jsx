import { useState } from 'react'
import { Button, Card, Group, Select, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import * as docActions from '../../api/endpoints/docActions'
import { LabelPrintDialog } from '../../components/ui/DocExtraDialogs'
import UtilityBanner from '../../components/ui/UtilityBanner'

/** Label Printing (legacy menu entry, frmRptLblPrint with its Document combo): pick any document, then its label templates. */
export default function LabelPrintingPage() {
  const { data: docs = [] } = useQuery({ queryKey: ['label-documents'], queryFn: docActions.labelDocuments, staleTime: 60_000 })
  const [docId, setDocId] = useState(null)
  const [open, setOpen] = useState(false)
  return (
    <Stack gap="md">
      <UtilityBanner title="Label Printing" subtitle="Design label templates for any document and print one label per record." />
      <Card withBorder p="lg" maw={560}>
        <Title order={5} mb="sm">Document</Title>
        <Group align="flex-end" gap="xs">
          <Select aria-label="Document" searchable placeholder="Select a document" data={docs.map((d) => ({ value: String(d.doc_id), label: d.name }))} value={docId} onChange={setDocId} style={{ flex: 1 }} />
          <Button color="kumkum" disabled={!docId} onClick={() => setOpen(true)}>Open</Button>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">Masters print every active record; other documents print the latest records, or choose Label Print from a document's Options menu to print the one you are on.</Text>
      </Card>
      {open && docId && <LabelPrintDialog docId={Number(docId)} recordId={null} onClose={() => setOpen(false)} />}
    </Stack>
  )
}
