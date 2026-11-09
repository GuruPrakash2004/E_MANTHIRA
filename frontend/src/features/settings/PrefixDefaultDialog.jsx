import { useEffect, useState } from 'react'
import { Button, Group, Loader, Modal, Select, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import * as printOptionsApi from '../../api/endpoints/printOptions'

/**
 * Prefix Wise Default Print Settings (legacy "Prefix Default" button): each document-number prefix of the screen gets the print
 * option that prints by default for bills of that prefix. `optionNames` = the screen's print options.
 */
export default function PrefixDefaultDialog({ docId, docName, optionNames, onClose }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    printOptionsApi
      .getPrefixDefaults(docId)
      .then((r) => live && setRows(r))
      .catch((e) => {
        notifications.show({ id: 'prefix-default-na', message: e?.response?.data?.detail || 'Could not load the prefixes', color: 'yellow' })
        onClose()
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function save() {
    if (rows.some((r) => !r.print_option_name)) return notifications.show({ message: 'Please Select Print Name...', color: 'yellow' })
    setBusy(true)
    try {
      const r = await printOptionsApi.savePrefixDefaults(docId, rows)
      notifications.show({ message: r.message || 'Updated Successfully...', color: 'teal' })
      onClose()
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not save', color: 'red' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} size="md" radius="lg" centered title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Prefix Wise Default Print Settings</Text>}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">{docName}</Text>
        {rows === null ? (
          <Group justify="center" py="md"><Loader size="sm" /></Group>
        ) : (
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr><Table.Th w={120}>Prefix</Table.Th><Table.Th>Print Name</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={r.prefix}>
                  <Table.Td><Text fw={600}>{r.prefix}</Text></Table.Td>
                  <Table.Td>
                    <Select size="xs" aria-label={`Print name for prefix ${r.prefix}`} placeholder="Select print name" data={optionNames} value={r.print_option_name || null} onChange={(v) => setRows((cur) => cur.map((x, xi) => (xi === i ? { ...x, print_option_name: v || '' } : x)))} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="kumkum" loading={busy} disabled={rows === null} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
