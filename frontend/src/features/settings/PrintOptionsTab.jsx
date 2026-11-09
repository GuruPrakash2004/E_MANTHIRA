import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Checkbox, Group, NumberInput, Select, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core'
import { ArrowDown, ArrowUp, ListOrdered, Pencil, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as printOptionsApi from '../../api/endpoints/printOptions'
import { detectAgent } from '../../lib/localPrint'
import { ReportFontsCard } from '../../components/ReportFonts'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import PrintOptionDialog from './PrintOptionDialog'
import PrefixDefaultDialog from './PrefixDefaultDialog'
import ServicePrinterCard from './ServicePrinterCard'
import { useAuth } from '../../hooks/useAuth'

const AFTER_SAVE_ACTIONS = [
  { value: 'P', label: 'Print' },
  { value: 'PP', label: 'Preview' },
  { value: 'DNP', label: 'Do Not Print' },
]

/**
 * Admin screen for UtlOption — which printer a format sends to (Direct
 * Print), what happens automatically after save, the shared default. Was
 * read-only everywhere in the app until now (PrintPickerModal only ever
 * displayed these values).
 */
export default function PrintOptionsTab() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['print-options-admin'], queryFn: printOptionsApi.listAllPrintOptions })
  const [savingKey, setSavingKey] = useState(null)
  const [dialog, setDialog] = useState(null) // null | 'new' | the row being edited
  // legacy "Print Settings": pick a Transaction, press Load, then work on that screen's print options
  const [pick, setPick] = useState(null)
  const [docFilter, setDocFilter] = useState(null)
  const [alter, setAlter] = useState(null) // null, or the option names in the order being arranged (Alter Order)
  const [prefixOpen, setPrefixOpen] = useState(false)
  const [orderBusy, setOrderBusy] = useState(false)
  const { data: transactions = [] } = useQuery({ queryKey: ['print-transactions'], queryFn: printOptionsApi.listPrintTransactions, staleTime: 60_000 })
  const confirm = useConfirm()
  const { data: serverPrinters } = useQuery({ queryKey: ['server-printers'], queryFn: () => printOptionsApi.listServerPrinters(true), staleTime: 15000 })
  const { data: agent } = useQuery({ queryKey: ['print-agent'], queryFn: detectAgent, staleTime: 15000 })

  // Dropdown list: server printers, then this PC's (Print Agent), plus the saved name if it is in neither.
  function printerData(current) {
    const seen = new Set()
    const group = (label, names) => ({
      group: label,
      items: (names || []).filter((n) => n && !seen.has(n) && seen.add(n)),
    })
    const groups = [
      group('Server printers', serverPrinters?.printers),
      group('This PC (Print Agent)', agent?.printers),
    ].filter((g) => g.items.length)
    if (current && !seen.has(current)) groups.push({ group: 'Saved (not detected)', items: [current] })
    return groups
  }

  const allRows = data || []
  const filtered = docFilter ? allRows.filter((r) => String(r.DocID) === docFilter) : allRows
  const rows = alter ? alter.map((n) => filtered.find((r) => r.OptionName === n)).filter(Boolean) : filtered
  const docName = transactions.find((t) => String(t.doc_id) === docFilter)?.doc_name || ''
  // the Transaction picker: documents first, then the Subsidiary Reports (they have no document, their print options sit under their own id)
  const transactionData = ['Transactions', 'Subsidiary Reports']
    .map((group) => ({ group, items: transactions.filter((t) => (t.group || 'Transactions') === group).map((t) => ({ value: String(t.doc_id), label: t.doc_name })) }))
    .filter((g) => g.items.length)
  const isReportDoc = docFilter && transactions.find((t) => String(t.doc_id) === docFilter)?.group === 'Subsidiary Reports'
  async function addStandard() {
    try {
      const r = await printOptionsApi.createReportDefaults(Number(docFilter))
      notifications.show({ message: r.message, color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['print-options-admin'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not add the print options', color: 'red' })
    }
  }

  function load() {
    setAlter(null)
    setDocFilter(pick)
  }
  function move(i, d) {
    setAlter((cur) => {
      const next = [...cur]
      const j = i + d
      if (j < 0 || j >= next.length) return cur
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  async function saveOrder() {
    setOrderBusy(true)
    try {
      const r = await printOptionsApi.savePrintOptionOrder(Number(docFilter), alter)
      notifications.show({ message: r.message || 'Saved Successfully!', color: 'teal' })
      setAlter(null)
      queryClient.invalidateQueries({ queryKey: ['print-options-admin'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not save the order', color: 'red' })
    } finally {
      setOrderBusy(false)
    }
  }

  async function save(row, patch) {
    const key = `${row.DocID}:${row.OptionName}`
    setSavingKey(key)
    try {
      await printOptionsApi.updatePrintOption(row.DocID, row.OptionName, patch)
      queryClient.invalidateQueries({ queryKey: ['print-options-admin'] })
      notifications.show({ message: 'Saved', color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSavingKey(null)
    }
  }

  async function remove(row) {
    const ok = await confirm({ title: 'Delete this print option?', message: `"${row.OptionName}" of ${row.MenuItemCaption || `Doc ${row.DocID}`} will no longer be offered when printing.`, confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await printOptionsApi.deletePrintOption(row.DocID, row.OptionName)
      queryClient.invalidateQueries({ queryKey: ['print-options-admin'] })
      notifications.show({ message: 'Print option deleted', color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Delete failed', color: 'red' })
    }
  }

  if (isLoading)
    return (
      <Stack gap="xs">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}
      </Stack>
    )

  return (
    <Stack gap="md">
    <Group justify="space-between" align="center" wrap="wrap">
      <Text size="sm" c="dimmed" style={{ flex: '1 1 320px' }}>
        Which printer each print format sends to, what happens after a save, and the default format. Each change saves as soon as you leave the field.
      </Text>
      <Button color="kumkum" leftSection={<Plus size={16} />} onClick={() => setDialog('new')} disabled={Boolean(alter)}>Add Print Option</Button>
    </Group>
    <Card withBorder p="sm">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Select label="Transaction" searchable clearable placeholder="All transactions" nothingFoundMessage="No such transaction" data={transactionData} value={pick} onChange={(v) => { setPick(v); if (!v) { setDocFilter(null); setAlter(null) } }} w={320} disabled={Boolean(alter)} />
        <Button variant="default" onClick={load} disabled={!pick || Boolean(alter)}>Load</Button>
        {docFilter && !alter && filtered.length > 1 && <Button variant="light" color="kumkum" leftSection={<ListOrdered size={16} />} onClick={() => setAlter(filtered.map((r) => r.OptionName))}>Alter Order</Button>}
        {docFilter && !alter && !isReportDoc && <Button variant="light" color="kumkum" onClick={() => setPrefixOpen(true)}>Prefix Default</Button>}
        {isReportDoc && !alter && filtered.length === 0 && <Button variant="light" color="kumkum" onClick={addStandard}>Add standard print options</Button>}
        {alter && (
          <>
            <Button color="kumkum" loading={orderBusy} onClick={saveOrder}>Save order</Button>
            <Button variant="default" onClick={() => setAlter(null)}>Cancel</Button>
            <Text size="xs" c="dimmed">Use the arrows to move a print option up or down, then Save order.</Text>
          </>
        )}
      </Group>
    </Card>
    <ServicePrinterCard printers={serverPrinters?.printers} isAdmin={user?.user_code?.toUpperCase() === 'ADMIN'} />
    <ReportFontsCard />
    <Card withBorder p={0} style={{ overflow: 'hidden' }}>
    <Table.ScrollContainer minWidth={900}>
    <Table highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Screen</Table.Th>
          <Table.Th>Format</Table.Th>
          <Table.Th>Report File</Table.Th>
          <Table.Th w={220}>Direct Printer</Table.Th>
          <Table.Th w={150}>After Save</Table.Th>
          <Table.Th w={90}>Copies</Table.Th>
          <Table.Th w={80}>Default</Table.Th>
          <Table.Th w={90}>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.length === 0 && (
          <Table.Tr>
            <Table.Td colSpan={8}>
              <Text size="sm" c="dimmed" py="sm">
                {docFilter
                  ? `${docName || 'This screen'} has no print options yet.${isReportDoc ? ' Press "Add standard print options" above to add the report files it prints from, or use "Add Print Option".' : ' Use "Add Print Option" to add one.'}`
                  : 'No print options yet.'}
              </Text>
            </Table.Td>
          </Table.Tr>
        )}
        {rows.map((row) => {
          const key = `${row.DocID}:${row.OptionName}`
          const busy = savingKey === key
          return (
            <Table.Tr key={key}>
              <Table.Td>
                <Text size="sm" fw={600}>
                  {row.MenuItemCaption || `Doc ${row.DocID}`}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={6}>
                  {row.OptionName}
                  {row.InActive === 'Y' && (
                    <Badge size="xs" color="gray" variant="light">
                      Inactive
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed" ff="monospace">
                  {row.CrptFileName}
                </Text>
              </Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  searchable
                  clearable
                  placeholder="Default printer"
                  nothingFoundMessage="No printers found"
                  aria-label={`Direct printer, ${row.MenuItemCaption || row.DocID} ${row.OptionName}`}
                  disabled={busy}
                  data={printerData((row.DirectPrinterName || '').trim())}
                  value={(row.DirectPrinterName || '').trim() || null}
                  onDropdownOpen={() => queryClient.invalidateQueries({ queryKey: ['server-printers'] })}
                  onChange={(v) => save(row, { direct_printer_name: v || '' })}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  aria-label={`After save, ${row.MenuItemCaption || row.DocID} ${row.OptionName}`}
                  data={AFTER_SAVE_ACTIONS}
                  value={(row.AfterSaveAction || '').trim() || null}
                  disabled={busy}
                  onChange={(v) => v && save(row, { after_save_action: v })}
                />
              </Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
                  aria-label={`Copies, ${row.MenuItemCaption || row.DocID} ${row.OptionName}`}
                  disabled={busy}
                  defaultValue={row.NoOfCopies || 1}
                  min={1}
                  onBlur={(e) => {
                    const v = Number(e.currentTarget.value) || 1
                    if (v !== row.NoOfCopies) save(row, { no_of_copies: v })
                  }}
                />
              </Table.Td>
              <Table.Td>
                <Checkbox
                  aria-label={`Default format, ${row.MenuItemCaption || row.DocID} ${row.OptionName}`}
                  color="kumkum"
                  checked={row.DefaultPrint === 'Y'}
                  disabled={busy}
                  onChange={(e) => save(row, { default_print: e.currentTarget.checked ? 'Y' : 'N' })}
                />
              </Table.Td>
              <Table.Td>
                {alter ? (
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="light" color="kumkum" size={32} aria-label={`Move ${row.OptionName} up`} disabled={rows.indexOf(row) === 0} onClick={() => move(rows.indexOf(row), -1)}><ArrowUp size={16} /></ActionIcon>
                    <ActionIcon variant="light" color="kumkum" size={32} aria-label={`Move ${row.OptionName} down`} disabled={rows.indexOf(row) === rows.length - 1} onClick={() => move(rows.indexOf(row), 1)}><ArrowDown size={16} /></ActionIcon>
                  </Group>
                ) : (
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="subtle" color="kumkum" size={32} aria-label={`Edit ${row.OptionName}`} onClick={() => setDialog(row)}><Pencil size={16} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" size={32} aria-label={`Delete ${row.OptionName}`} onClick={() => remove(row)}><Trash2 size={16} /></ActionIcon>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
    </Table.ScrollContainer>
    </Card>
    {dialog && (
      <PrintOptionDialog
        row={dialog === 'new' ? null : dialog}
        defaultDocId={docFilter}
        printerData={printerData}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); queryClient.invalidateQueries({ queryKey: ['print-options-admin'] }) }}
      />
    )}
    {prefixOpen && <PrefixDefaultDialog docId={Number(docFilter)} docName={docName} optionNames={filtered.map((r) => r.OptionName)} onClose={() => setPrefixOpen(false)} />}
    </Stack>
  )
}
