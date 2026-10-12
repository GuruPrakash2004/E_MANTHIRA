import { useState } from 'react'
import { Badge, Checkbox, Group, NumberInput, Select, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as printOptionsApi from '../../api/endpoints/printOptions'

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

  if (isLoading) return <Text size="sm" c="dimmed">Loading…</Text>

  return (
    <Table striped highlightOnHover style={{ position: 'relative' }}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Screen</Table.Th>
          <Table.Th>Format</Table.Th>
          <Table.Th>Report File</Table.Th>
          <Table.Th w={220}>Direct Printer</Table.Th>
          <Table.Th w={150}>After Save</Table.Th>
          <Table.Th w={90}>Copies</Table.Th>
          <Table.Th w={80}>Default</Table.Th>
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
                <TextInput
                  size="xs"
                  disabled={busy}
                  defaultValue={(row.DirectPrinterName || '').trim()}
                  onBlur={(e) => {
                    const v = e.currentTarget.value
                    if (v !== (row.DirectPrinterName || '').trim()) save(row, { direct_printer_name: v })
                  }}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  data={AFTER_SAVE_ACTIONS}
                  value={(row.AfterSaveAction || '').trim() || null}
                  disabled={busy}
                  onChange={(v) => v && save(row, { after_save_action: v })}
                />
              </Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
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
                  checked={row.DefaultPrint === 'Y'}
                  disabled={busy}
                  onChange={(e) => save(row, { default_print: e.currentTarget.checked ? 'Y' : 'N' })}
                />
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}
