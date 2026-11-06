import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Checkbox, Group, NumberInput, Select, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as printOptionsApi from '../../api/endpoints/printOptions'
import { detectAgent } from '../../lib/localPrint'
import { ReportFontsCard } from '../../components/ReportFonts'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import PrintOptionDialog from './PrintOptionDialog'

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
  const { data, isLoading } = useQuery({ queryKey: ['print-options-admin'], queryFn: printOptionsApi.listAllPrintOptions })
  const [savingKey, setSavingKey] = useState(null)
  const [dialog, setDialog] = useState(null) // null | 'new' | the row being edited
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

  const rows = data || []

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
      <Button color="kumkum" leftSection={<Plus size={16} />} onClick={() => setDialog('new')}>Add Print Option</Button>
    </Group>
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
                <Group gap={4} wrap="nowrap">
                  <ActionIcon variant="subtle" color="kumkum" size={32} aria-label={`Edit ${row.OptionName}`} onClick={() => setDialog(row)}><Pencil size={16} /></ActionIcon>
                  <ActionIcon variant="subtle" color="red" size={32} aria-label={`Delete ${row.OptionName}`} onClick={() => remove(row)}><Trash2 size={16} /></ActionIcon>
                </Group>
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
        printerData={printerData}
        onClose={() => setDialog(null)}
        onSaved={() => { setDialog(null); queryClient.invalidateQueries({ queryKey: ['print-options-admin'] }) }}
      />
    )}
    </Stack>
  )
}
