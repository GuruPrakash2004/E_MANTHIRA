import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Group, Modal, Select, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, X } from 'lucide-react'
import * as sevaApi from '../../api/endpoints/seva'
import EmptyState from '../../components/ui/EmptyState'
import { formatINR, isoDate } from '../../utils/format'

/**
 * Group Seva (legacy frmTrnSeva "Group Seva" panel): pick a saved group, tick its members, and one Seva Entry is
 * generated per member using this form's payment, ledgers, days and dates. Everything is saved together or not at all.
 */
export default function GroupSevaModal({ opened, onClose, form, dates, onDone }) {
  const queryClient = useQueryClient()
  const [pick, setPick] = useState(null) // "grpId:sevaId"
  const [ticked, setTicked] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  const { data: groups = [] } = useQuery({ queryKey: ['group-seva-groups'], queryFn: sevaApi.groupSevaGroups, enabled: opened })
  const [grpId, sevaId] = (pick || ':').split(':').map(Number)
  const { data: members = [] } = useQuery({
    queryKey: ['group-seva-members', grpId, sevaId],
    queryFn: () => sevaApi.groupSevaMembers(grpId, sevaId),
    enabled: opened && Boolean(pick),
  })
  useEffect(() => {
    setTicked(new Set(members.map((m) => m.GRPSEVADtlID)))
  }, [members])
  useEffect(() => {
    if (!opened) {
      setPick(null)
      setResult(null)
    }
  }, [opened])

  const options = useMemo(() => groups.map((g) => ({ value: `${g.GRPSEVAID}:${g.SVAID}`, label: `${g.NAME} - ${g.SVANAME} (${g.members})` })), [groups])
  const days = dates.length
  const total = members.filter((m) => ticked.has(m.GRPSEVADtlID)).reduce((t, m) => t + Number(m.rate || 0) * days, 0)
  const all = members.length > 0 && ticked.size === members.length

  async function onGenerate() {
    if (!days) return notifications.show({ message: 'Please add at least one date before generating', color: 'red' })
    if (!form.ledger_id || !form.cash_bank_ledger_id) return notifications.show({ message: 'Choose the Ledger and the Cash or Bank Account on the entry first', color: 'red' })
    setSaving(true)
    try {
      const r = await sevaApi.groupSevaGenerate({
        grp_id: grpId,
        seva_id: sevaId,
        member_ids: [...ticked],
        payment_mode: form.payment_mode,
        bank_name: form.bank_name || null,
        cheque_no: form.cheque_no || null,
        cheque_date: form.cheque_date ? isoDate(form.cheque_date) : null,
        reference_no: form.reference_no || null,
        ledger_id: Number(form.ledger_id),
        cash_bank_ledger_id: Number(form.cash_bank_ledger_id),
        voucher_type: form.voucher_type,
        timing_text: form.timing_text || null,
        dates,
        doc_date: isoDate(form.doc_date),
      })
      setResult(r.created)
      queryClient.invalidateQueries({ queryKey: ['sevas'] })
      notifications.show({ message: `${r.created.length} seva entries saved`, color: 'teal' })
      onDone?.(r.created)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not generate the entries', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Group Seva</Text>}>
      <Stack gap="sm">
        {result ? (
          <>
            <Alert color="teal" variant="light" title={`${result.length} seva entries saved`}>
              {result.map((r) => r.print_no).join(', ')}
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
                Close
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Select data-autofocus searchable label="Group Seva Name" placeholder="Choose a group" data={options} value={pick} onChange={setPick} nothingFoundMessage="No group sevas saved" />
            {options.length === 0 && <EmptyState icon={Users} title="No group sevas saved" hint="Saved Group Seva documents appear here." />}
            {members.length > 0 && (
              <>
                <Checkbox color="kumkum" label="Select All" checked={all} indeterminate={ticked.size > 0 && !all} onChange={(e) => setTicked(e.currentTarget.checked ? new Set(members.map((m) => m.GRPSEVADtlID)) : new Set())} />
                <Table.ScrollContainer minWidth={720} mah={340}>
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={50} />
                        <Table.Th>Sannidhi</Table.Th>
                        <Table.Th>Seva</Table.Th>
                        <Table.Th>Sevakartharu</Table.Th>
                        <Table.Th>Nakshatra</Table.Th>
                        <Table.Th>Gothra</Table.Th>
                        <Table.Th>Name-2</Table.Th>
                        <Table.Th>Nakshatra-2</Table.Th>
                        <Table.Th>Rashi</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {members.map((m) => (
                        <Table.Tr key={m.GRPSEVADtlID}>
                          <Table.Td>
                            <Checkbox
                              color="kumkum"
                              aria-label={`Include ${m.name}`}
                              checked={ticked.has(m.GRPSEVADtlID)}
                              onChange={(e) =>
                                setTicked((t) => {
                                  const n = new Set(t)
                                  if (e.currentTarget.checked) n.add(m.GRPSEVADtlID)
                                  else n.delete(m.GRPSEVADtlID)
                                  return n
                                })
                              }
                            />
                          </Table.Td>
                          <Table.Td>{m.sannidhi}</Table.Td>
                          <Table.Td>{m.seva}</Table.Td>
                          <Table.Td>{m.name}</Table.Td>
                          <Table.Td>{m.nakshatra}</Table.Td>
                          <Table.Td>{m.gothra}</Table.Td>
                          <Table.Td>{m.name2}</Table.Td>
                          <Table.Td>{m.nakshatra2}</Table.Td>
                          <Table.Td>{m.rashi}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <Group justify="space-between" wrap="wrap">
                  <Text size="sm">
                    Total: <b>{formatINR(total)}</b>{' '}
                    <Text span size="xs" c="dimmed">
                      ({ticked.size} members x {days || 0} day{days === 1 ? '' : 's'}, at each Seva's rate)
                    </Text>
                  </Text>
                  <Group gap="xs">
                    <Button color="kumkum" loading={saving} disabled={ticked.size === 0} onClick={onGenerate}>
                      Generate
                    </Button>
                    <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
                      Close
                    </Button>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed">
                  Each member gets their own Seva Entry. Payment, ledgers, dates and timing are taken from the entry form behind this window.
                </Text>
              </>
            )}
          </>
        )}
      </Stack>
    </Modal>
  )
}
