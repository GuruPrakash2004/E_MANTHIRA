import { useEffect, useState } from 'react'
import { Button, Checkbox, Group, Modal, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import * as mastersApi from '../../api/endpoints/masters'
import EmptyState from '../../components/ui/EmptyState'
import { formatINR } from '../../utils/format'

/** Options > Attach Seva on Sannidhi Master: tick the Sevas offered at this Sannidhi (frmUtlAttachSeva, MstSanSeva). */
export default function AttachSevaModal({ opened, onClose, docId, sannidhiId, sannidhiName }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['attach-seva', docId, sannidhiId], queryFn: () => mastersApi.getAttachSeva(docId, sannidhiId), enabled: opened && Boolean(sannidhiId) })
  const [ticked, setTicked] = useState(new Set())
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setTicked(new Set(data.filter((s) => s.attached).map((s) => s.seva_id)))
  }, [data])
  const all = data.length > 0 && ticked.size === data.length

  async function onSave() {
    setSaving(true)
    try {
      await mastersApi.saveAttachSeva(docId, sannidhiId, [...ticked])
      notifications.show({ message: 'Sevas attached successfully!', color: 'teal' })
      onClose()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Error While attaching Sevas!', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Attach Sevas</Text>}>
      <Stack gap="sm">
        <Text size="sm" fw={600}>
          SANNIDHI: {sannidhiName}
        </Text>
        <Checkbox color="kumkum" label="Select All" checked={all} indeterminate={ticked.size > 0 && !all} onChange={(e) => setTicked(e.currentTarget.checked ? new Set(data.map((s) => s.seva_id)) : new Set())} />
        <Table.ScrollContainer minWidth={420} mah={380}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Seva Name</Table.Th>
                <Table.Th w={80}>Attach</Table.Th>
                <Table.Th w={120} ta="right">
                  Amount
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((s) => (
                <Table.Tr key={s.seva_id}>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td>
                    <Checkbox
                      color="kumkum"
                      aria-label={`Attach ${s.name}`}
                      checked={ticked.has(s.seva_id)}
                      onChange={(e) =>
                        setTicked((t) => {
                          const n = new Set(t)
                          if (e.currentTarget.checked) n.add(s.seva_id)
                          else n.delete(s.seva_id)
                          return n
                        })
                      }
                    />
                  </Table.Td>
                  <Table.Td ta="right" className="vt-num">
                    {formatINR(s.amount)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!isLoading && data.length === 0 && <EmptyState title="No active Sevas" hint="Add a Seva in Seva Master first." />}
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
            Save
          </Button>
          <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
