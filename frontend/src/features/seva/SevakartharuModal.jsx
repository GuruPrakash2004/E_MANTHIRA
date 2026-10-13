import { useState } from 'react'
import { Group, Modal, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as sevaApi from '../../api/endpoints/seva'
import EmptyState from '../../components/ui/EmptyState'

/**
 * Select Sevakartharu (legacy frmTrnSeva.btnLoadSevaDtls_Click): earlier sevas of regular devotees, newest first.
 * Picking one copies that devotee's name, gotra, nakshatra, rashi, address and mobile into the new entry.
 * The name typed on the entry narrows the list; `limit` is the "Nos" box next to the button.
 */
export default function SevakartharuModal({ opened, onClose, onPick, initialName = '', limit = 0 }) {
  const [name, setName] = useState(initialName)
  const { data = [], isLoading } = useQuery({
    queryKey: ['regular-devotees', name, limit],
    queryFn: () => sevaApi.regularDevotees({ name, top: limit || undefined }),
    enabled: opened,
  })
  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Select Sevakartharu</Text>}>
      <Stack gap="sm">
        <Group gap="sm">
          <TextInput data-autofocus leftSection={<Search size={16} />} placeholder="Search by name" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
          <Text size="xs" c="dimmed">
            {limit ? `Showing the latest ${limit}` : 'Regular devotees only'}
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={640} mah={380}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Seva No</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Mobile</Table.Th>
                <Table.Th>Gothra</Table.Th>
                <Table.Th>Nakshatra</Table.Th>
                <Table.Th>Name-2</Table.Th>
                <Table.Th>Nakshatra-2</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((r) => (
                <Table.Tr key={r.SEVAID} style={{ cursor: 'pointer' }} onClick={() => onPick(r)}>
                  <Table.Td className="vt-num">
                    <UnstyledButton onClick={() => onPick(r)} fw={600}>
                      {r.PrintSEVANO || r.SEVANO}
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>{r.KNAME}</Table.Td>
                  <Table.Td>{r.MOBNO}</Table.Td>
                  <Table.Td>{r.GothraName}</Table.Td>
                  <Table.Td>{r.NakshatraName}</Table.Td>
                  <Table.Td>{r.SECKNAME}</Table.Td>
                  <Table.Td>{r.NakshatraName2}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!isLoading && data.length === 0 && <EmptyState title="No Records Found!" hint="Tick Regular Devotee on a seva entry to see it here." />}
      </Stack>
    </Modal>
  )
}

