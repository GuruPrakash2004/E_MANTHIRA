import { useState } from 'react'
import { Alert, Button, Card, Checkbox, Group, Radio, Select, Stack, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { Info, ListChecks, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api/endpoints/utilities'
import EmptyState from '../../components/ui/EmptyState'
import UtilityBanner from '../../components/ui/UtilityBanner'

/**
 * ShortClose Documents (legacy frmUtlShortclose): close the unfulfilled balance of a linked document (an order, say).
 * The documents offered are the ones other documents are linked from (UtlTransactions.LinkedFromDocShForm). This
 * client's database links none, so the screen opens with the legacy filters switched off and says why.
 */
export default function ShortCloseDocumentsPage() {
  const navigate = useNavigate()
  const { data: docs, isLoading } = useQuery({ queryKey: ['shortclose-docs'], queryFn: api.shortcloseDocuments })
  const [doc, setDoc] = useState(null)
  const [range, setRange] = useState(true)
  const [from, setFrom] = useState(new Date())
  const [to, setTo] = useState(new Date())
  const [state, setState] = useState('both')
  const none = !isLoading && (docs || []).length === 0

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title="ShortClose Documents"
        subtitle="Close the pending balance of a linked document."
        heading="Short-close"
        sub="Pending balances"
        facts={[{ label: 'linkable documents', value: isLoading ? '-' : (docs || []).length }]}
        emblem={<ListChecks size={60} color="#F4E1A6" strokeWidth={1.4} />}
        actions={
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        }
      />

      {none && (
        <Alert color="kumkum" variant="light" icon={<Info size={18} />} title="Nothing can be short-closed here">
          <Text size="sm">No document in this database is linked from another document (for example an order that a bill is raised against), so there are no pending balances to close.</Text>
        </Alert>
      )}

      <Card withBorder p="lg">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select className="vt-field-required" label="Document" placeholder="Choose a document" disabled={none} data={(docs || []).map((d) => ({ value: String(d.doc_id), label: d.name }))} value={doc} onChange={setDoc} w={260} searchable />
          <Select label="Doc No" disabled placeholder="All" data={[]} w={200} />
          <Checkbox color="kumkum" label="Date Range" checked={range} disabled={none} onChange={(e) => setRange(e.currentTarget.checked)} mb={8} />
          <DatePickerInput label="From" valueFormat="DD/MM/YYYY" value={from} onChange={setFrom} disabled={none || !range} w={150} />
          <DatePickerInput label="To" valueFormat="DD/MM/YYYY" value={to} onChange={setTo} disabled={none || !range} w={150} />
          <Radio.Group value={state} onChange={setState} label="Show">
            <Group gap="md" mt={6}>
              <Radio color="kumkum" value="shortclosed" label="ShortClosed" disabled={none} />
              <Radio color="kumkum" value="pending" label="Pending" disabled={none} />
              <Radio color="kumkum" value="both" label="Both" disabled={none} />
            </Group>
          </Radio.Group>
          <Stack gap={4}>
            <Checkbox color="kumkum" label="Select Item Code" disabled={none} />
            <Checkbox color="kumkum" label="Select Party" disabled={none} />
          </Stack>
          <Button color="kumkum" leftSection={<Search size={16} />} disabled={none || !doc}>
            Load
          </Button>
        </Group>
      </Card>

      <Card withBorder p="lg">
        <EmptyState icon={ListChecks} title={none ? 'No documents to short-close' : 'Press Load'} hint={none ? undefined : 'Choose a document and press Load; double-click a line to short-close it.'} />
      </Card>
    </Stack>
  )
}
