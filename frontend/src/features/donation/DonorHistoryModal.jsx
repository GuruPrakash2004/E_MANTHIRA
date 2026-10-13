import { useState } from 'react'
import { Group, Modal, Stack, Table, Text, TextInput } from '@mantine/core'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as donationApi from '../../api/endpoints/donation'
import EmptyState from '../../components/ui/EmptyState'

/** Show Donor (legacy frmTrnDONREC.btnShowDonars_Click): earlier donors, newest first; picking one copies the details. */
export default function DonorHistoryModal({ opened, onClose, onPick, initialName = '', limit = 0 }) {
  const [name, setName] = useState(initialName)
  const { data = [], isLoading } = useQuery({
    queryKey: ['donor-history', name, limit],
    queryFn: () => donationApi.donorHistory({ name, top: limit || undefined }),
    enabled: opened,
  })
  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Select Donor</Text>}>
      <Stack gap="sm">
        <Group gap="sm">
          <TextInput data-autofocus leftSection={<Search size={16} />} placeholder="Donor name starts with" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
          <Text size="xs" c="dimmed">
            {limit ? `Showing the latest ${limit}` : 'All earlier donors'}
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={600} mah={380}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Receipt No</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Donor</Table.Th>
                <Table.Th>Contact No</Table.Th>
                <Table.Th>Seva</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((r, i) => (
                <Table.Tr key={`${r.DONRECID}-${i}`} style={{ cursor: 'pointer' }} onClick={() => onPick(r)}>
                  <Table.Td className="vt-num">{r.PrintDONRECNO || r.DONRECNO}</Table.Td>
                  <Table.Td className="vt-num">{r.DONRECDate ? dayjs(r.DONRECDate).format('DD/MM/YYYY') : ''}</Table.Td>
                  <Table.Td>{r.DONOR}</Table.Td>
                  <Table.Td>{r.CONTACTNO}</Table.Td>
                  <Table.Td>{r.SEVANME}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!isLoading && data.length === 0 && <EmptyState title="No donors found" hint="Saved donation receipts appear here." />}
      </Stack>
    </Modal>
  )
}
