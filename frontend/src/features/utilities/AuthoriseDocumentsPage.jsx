import { useState } from 'react'
import { Button, Card, Checkbox, Group, Modal, Skeleton, Stack, Table, Text, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api/endpoints/utilities'
import EmptyState from '../../components/ui/EmptyState'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'

/**
 * Authorise Documents (legacy fmtUtlAuth + frmUtlAuthDoc): every document set to need authorisation, with how many
 * are waiting at each level. Open a count to see the waiting documents, tick them and authorise. Documents and levels
 * come from UtlTransactions; the levels a user sees come from their rights (ADMIN sees all).
 */
export default function AuthoriseDocumentsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(null) // { doc, level }
  const { data, isLoading, isFetching, refetch, error } = useQuery({ queryKey: ['authorise-summary'], queryFn: api.authoriseSummary })
  const docs = data?.documents || []
  const levels = data?.levels || []
  const pendingTotal = docs.reduce((t, d) => t + d.counts.reduce((a, c) => a + (c || 0), 0), 0)

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title="Authorise Documents"
        subtitle="Approve documents that are waiting for authorisation."
        heading="Authorisation"
        sub="Pending approvals"
        facts={[
          { label: docs.length === 1 ? 'document type' : 'document types', value: isLoading ? '-' : docs.length },
          { label: 'waiting for you', value: isLoading ? '-' : pendingTotal },
        ]}
        emblem={<ShieldCheck size={60} color="#F4E1A6" strokeWidth={1.4} />}
        actions={
          <>
            <Button variant="default" leftSection={<RefreshCw size={16} />} loading={isFetching} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
              Close
            </Button>
          </>
        }
      />

      <Card withBorder p="lg">
        {isLoading ? (
          <Stack gap="xs">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={44} radius="md" />
            ))}
          </Stack>
        ) : error ? (
          <Text c="red" size="sm">{error?.response?.data?.detail || 'Could not load the documents'}</Text>
        ) : docs.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="No document needs authorisation" hint="A document appears here when it is set to require authorisation in the document set-up." />
        ) : (
          <Table.ScrollContainer minWidth={520}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={110}>Type</Table.Th>
                  <Table.Th>Document Name</Table.Th>
                  {levels.map((l) => (
                    <Table.Th key={l.level}>{levels.length > 1 ? `${l.label} Level : ` : ''}No. of documents to authorise</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {docs.map((d) => (
                  <Table.Tr key={d.doc_id}>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{d.type}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={600}>{d.name}</Text>
                    </Table.Td>
                    {levels.map((l, i) => {
                      const c = d.counts[i]
                      return (
                        <Table.Td key={l.level}>
                          {c == null ? (
                            <Text size="sm" c="dimmed">-</Text>
                          ) : c === 0 ? (
                            <Text size="sm" c="dimmed">No documents pending for authorisation.</Text>
                          ) : (
                            <UnstyledButton className="vt-auth-count" onClick={() => setOpen({ doc: d, level: l.level })} aria-label={`Open ${c} pending ${d.name}`}>
                              <span className="vt-num">{c}</span> pending
                            </UnstyledButton>
                          )}
                        </Table.Td>
                      )
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Text size="xs" c="dimmed" mt="md">Select a count to open the list of documents waiting for authorisation.</Text>
      </Card>

      {open && (
        <PendingModal
          doc={open.doc}
          level={open.level}
          onClose={() => setOpen(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['authorise-summary'] })
          }}
        />
      )}
      <style>{`.vt-auth-count { display: inline-block; padding: 4px 12px; border-radius: 999px; font-weight: 700; background: var(--vt-gold-chip); color: var(--vt-badge-ink); border: 1px solid var(--mantine-color-gold-4); }
.vt-auth-count:hover { background: var(--mantine-color-gold-1); } .vt-auth-count:focus-visible { outline: 2px solid var(--mantine-color-kumkum-6); outline-offset: 2px; }`}</style>
    </Stack>
  )
}

function PendingModal({ doc, level, onClose, onDone }) {
  const confirm = useConfirm()
  const [picked, setPicked] = useState([])
  const [saving, setSaving] = useState(false)
  const { data, isLoading, refetch } = useQuery({ queryKey: ['authorise-pending', doc.doc_id, level], queryFn: () => api.authorisePending(doc.doc_id, level) })
  const rows = data?.rows || []
  const isMaster = (data?.type || doc.type).toUpperCase() === 'MASTER'
  const all = rows.length > 0 && picked.length === rows.length

  async function authorise() {
    if (!(await confirm({ title: `Authorise ${picked.length} document${picked.length === 1 ? '' : 's'}?`, message: `${doc.name}: the selected documents will be marked authorised in your name.`, confirmLabel: 'Authorise', tone: 'warning' }))) return
    setSaving(true)
    try {
      const r = await api.authoriseDocs(doc.doc_id, level, picked)
      notifications.show({ message: r.message, color: 'teal' })
      setPicked([])
      onDone()
      refetch()
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not authorise', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{doc.name} {data?.level_label ? `· ${data.level_label} level` : ''}</Text>}>
      <Stack>
        {isLoading ? (
          <Skeleton height={160} radius="md" />
        ) : rows.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="Nothing left to authorise" />
        ) : (
          <Table.ScrollContainer minWidth={380} mah="50dvh">
            <Table stickyHeader highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox color="kumkum" aria-label="Select all" checked={all} indeterminate={picked.length > 0 && !all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} />
                  </Table.Th>
                  <Table.Th>{isMaster ? 'Code' : 'Doc No'}</Table.Th>
                  <Table.Th>{isMaster ? 'Name' : 'Date'}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Checkbox color="kumkum" aria-label={`Select ${r.no}`} checked={picked.includes(r.id)} onChange={() => setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} />
                    </Table.Td>
                    <Table.Td>{r.no}</Table.Td>
                    <Table.Td>{isMaster ? r.name : r.date ? r.date.split('-').reverse().join('/') : ''}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Group justify="flex-end">
          <Button color="kumkum" leftSection={<BadgeCheck size={16} />} disabled={picked.length === 0} loading={saving} onClick={authorise}>
            Authorise
          </Button>
          <Button variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
