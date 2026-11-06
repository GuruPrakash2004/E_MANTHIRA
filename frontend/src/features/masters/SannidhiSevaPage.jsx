import { useState } from 'react'
import { Badge, Button, Card, Group, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Search } from 'lucide-react'
import * as api from '../../api/endpoints/legacyMasters'
import EmptyState from '../../components/ui/EmptyState'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import AttachSevaModal from './AttachSevaModal'

/**
 * Sannidhi vs Seva (menu row frmMstSanSeva). The old EXE has no such form: the mapping is the "Attach Sevas" dialog of the
 * Sannidhi master. This screen lists every Sannidhi with how many sevas it offers and opens that same dialog. Title,
 * headings and the master's DocID all come from the database through the server.
 */
export default function SannidhiSevaPage() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['sannidhi-sevas'], queryFn: api.sannidhiSevas })
  const cap = data?.captions || {}
  const rows = (data?.rows || []).filter((r) => !q.trim() || `${r.code} ${r.name}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={data?.title || ' '}
        subtitle={cap.sevas ? `${data.total_sevas} ${cap.sevas}` : ' '}
        heading={data?.title || ' '}
        sub={data?.title || ' '}
        facts={data?.available ? [{ label: cap.sannidhi, value: data.rows.length }, { label: cap.sevas, value: data.total_sevas }] : []}
        emblem={<Link2 size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />

      {isLoading ? (
        <Skeleton height={240} radius="md" />
      ) : data && !data.available ? (
        <NotAvailableHere feature={data.title} missing={data.missing} />
      ) : (
        <Card withBorder p="lg">
          <TextInput leftSection={<Search size={15} />} placeholder="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="md" w={260} />
          {rows.length === 0 ? (
            <EmptyState icon={Link2} title="Nothing found" hint="No Sannidhi matches the search." />
          ) : (
            <Table.ScrollContainer minWidth={480}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{cap.sannidhi}</Table.Th>
                    <Table.Th w={160}>{cap.sevas}</Table.Th>
                    <Table.Th w={140} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td><Text fw={600}>{r.name}</Text></Table.Td>
                      <Table.Td><Badge variant="light" color="gold" c="var(--vt-badge-ink)" size="lg">{r.seva_count} / {data.total_sevas}</Badge></Table.Td>
                      <Table.Td><Button size="xs" variant="light" color="kumkum" onClick={() => setPick(r)}>Attach</Button></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      {pick && data?.sannidhi_doc_id && (
        <AttachSevaModal
          opened
          onClose={() => { setPick(null); qc.invalidateQueries({ queryKey: ['sannidhi-sevas'] }) }}
          docId={data.sannidhi_doc_id}
          sannidhiId={pick.id}
          sannidhiName={pick.name}
        />
      )}
    </Stack>
  )
}
