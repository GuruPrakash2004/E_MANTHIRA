import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Group, NumberInput, Select, SimpleGrid, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Landmark, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/legacyMasters'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { formatINR, isoDate } from '../../utils/format'
import useRights from '../../hooks/useRights'

/**
 * Accounting Ledger Master (legacy frmMstAccountLed + frmMstOPBalLed): pick a ledger, then keep its bill-wise opening
 * balances. Each one is also posted to the books by the server exactly as the EXE does. Title, headings, the ledger-type
 * code and the Dr / Cr choices all come from the database through the server; nothing is typed into this screen.
 */
export default function AccountingLedgerPage() {
  const rights = useRights()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [dq] = useDebouncedValue(search, 250)
  const [ledId, setLedId] = useState(null)
  const [form, setForm] = useState(null) // { op_id | null, ref_no, ref_date, amount, side }
  const [saving, setSaving] = useState(false)

  const { data: list, isLoading } = useQuery({ queryKey: ['acc-ledgers', dq], queryFn: () => api.listAccLedgers(dq) })
  const { data: op } = useQuery({ queryKey: ['acc-opening', ledId], queryFn: () => api.getOpening(ledId), enabled: Boolean(ledId) })
  const cap = list?.captions || {}
  const ocap = op?.captions || {}
  const sides = op?.sides || []
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['acc-opening'] })
    qc.invalidateQueries({ queryKey: ['acc-ledgers'] })
  }
  const fail = (e, fb) => notifications.show({ message: e?.response?.data?.detail || fb, color: 'red' })

  async function save() {
    setSaving(true)
    try {
      const body = { ref_no: form.ref_no, ref_date: isoDate(form.ref_date), amount: Number(form.amount) || 0, dr_cr: form.side }
      const r = form.op_id ? await api.updateOpening(ledId, form.op_id, body) : await api.addOpening(ledId, body)
      notifications.show({ message: r.message || `OpeningBalance RefNo '${form.ref_no}' is added successfully.`, color: 'teal' })
      setForm(null)
      refresh()
    } catch (e) {
      fail(e, 'Error during save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(r) {
    if (!(await confirm({ title: 'Delete this opening balance?', message: `'${r.ref_no}' will be deleted from the ledger.`, confirmLabel: 'Delete' }))) return
    try {
      notifications.show({ message: (await api.deleteOpening(ledId, r.op_id)).message, color: 'teal' })
      refresh()
    } catch (e) {
      fail(e, 'Could not delete')
    }
  }

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={list?.title || ' '}
        subtitle={op?.ledger?.name || ' '}
        heading={op?.ledger?.name || list?.title || ' '}
        sub={list?.title || ' '}
        facts={op ? sides.map((s) => ({ label: s.label, value: formatINR(op.totals[s.value] || 0) })) : []}
        emblem={<Landmark size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />

      {isLoading ? (
        <Skeleton height={260} radius="md" />
      ) : list && !list.available ? (
        <NotAvailableHere feature={list.title} missing={list.missing} />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" style={{ alignItems: 'start' }}>
          <Card withBorder p="md">
            <TextInput leftSection={<Search size={15} />} placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} mb="sm" />
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {(list?.rows || []).length === 0 ? (
                <EmptyState icon={Landmark} title="No ledgers" hint="No ledger matches the search." />
              ) : (
                (list.rows || []).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setLedId(r.id); setForm(null) }}
                    aria-pressed={ledId === r.id}
                    style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', borderRadius: 8, background: ledId === r.id ? 'var(--vt-gold-chip)' : 'transparent' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>{r.name}</Text>
                      <Text size="xs" c="dimmed" truncate>{cap.type}: {r.type} · {cap.group}: {r.group}</Text>
                    </div>
                    {r.op_count > 0 && <Badge variant="light" color="gold" c="var(--vt-badge-ink)">{r.op_count}</Badge>}
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card withBorder p="md">
            {!ledId ? (
              <EmptyState icon={Landmark} title="Choose a ledger" hint="Pick a ledger on the left to see and edit its opening balances." />
            ) : !op ? (
              <Skeleton height={200} radius="md" />
            ) : (
              <Stack gap="sm">
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text fw={700}>{op.ledger.name}</Text>
                    <Text size="xs" c="dimmed">{ocap.type}: {op.ledger.type} · {list?.captions?.group}: {op.ledger.group}</Text>
                  </div>
                  <Group gap="xs">
                    <ExportExcelButton
                      filename={`${op.ledger.name}`}
                      rows={op.rows}
                      columns={[{ label: ocap.ref_no, key: 'ref_no' }, { label: ocap.ref_date, value: (r) => (r.ref_date ? dayjs(r.ref_date).format('DD/MM/YYYY') : '') }, { label: ocap.amount, key: 'amount' }, { label: ocap.side, key: 'side_label' }]}
                    />
                    {rights.add && (
                    <Button color="kumkum" leftSection={<Plus size={16} />} onClick={() => setForm({ op_id: null, ref_no: '', ref_date: new Date(), amount: '', side: sides[0]?.value || '' })}>
                      Add
                    </Button>
                    )}
                  </Group>
                </Group>

                {form && (
                  <Card withBorder p="sm" style={{ background: 'var(--vt-sandal)' }}>
                    <Group gap="xs" align="flex-end" wrap="wrap">
                      <TextInput label={ocap.ref_no} w={160} disabled={Boolean(form.op_id)} data-autofocus value={form.ref_no} onChange={(e) => setForm({ ...form, ref_no: e.currentTarget.value })} />
                      <DateInput label={ocap.ref_date} valueFormat="DD/MM/YYYY" w={150} value={form.ref_date} onChange={(v) => v && setForm({ ...form, ref_date: v })} />
                      <NumberInput label={ocap.amount} w={150} min={0} decimalScale={2} fixedDecimalScale hideControls thousandSeparator="," value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
                      <Select label={ocap.side} w={110} allowDeselect={false} data={sides.map((s) => ({ value: s.value, label: s.label }))} value={form.side} onChange={(v) => v && setForm({ ...form, side: v })} />
                      <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
                      <Button variant="default" leftSection={<X size={16} />} onClick={() => setForm(null)}>Cancel</Button>
                    </Group>
                  </Card>
                )}

                {op.rows.length === 0 ? (
                  <EmptyState icon={Landmark} title="No opening balances" hint="Use Add to enter the first one." />
                ) : (
                  <Table.ScrollContainer minWidth={420}>
                    <Table highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{ocap.ref_no}</Table.Th>
                          <Table.Th>{ocap.ref_date}</Table.Th>
                          <Table.Th ta="right">{ocap.amount}</Table.Th>
                          <Table.Th>{ocap.side}</Table.Th>
                          <Table.Th w={90} />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {op.rows.map((r) => (
                          <Table.Tr key={r.op_id}>
                            <Table.Td className="vt-num">{r.ref_no}</Table.Td>
                            <Table.Td className="vt-num">{r.ref_date ? dayjs(r.ref_date).format('DD/MM/YYYY') : ''}</Table.Td>
                            <Table.Td className="vt-num" ta="right">{formatINR(r.amount)}</Table.Td>
                            <Table.Td>{r.side_label}</Table.Td>
                            <Table.Td>
                              <Group gap={4} wrap="nowrap" justify="flex-end">
                                {rights.edit && (
                                <ActionIcon variant="subtle" color="kumkum" aria-label={`Edit ${r.ref_no}`} onClick={() => setForm({ op_id: r.op_id, ref_no: r.ref_no, ref_date: r.ref_date ? new Date(r.ref_date) : new Date(), amount: r.amount, side: r.side })}><Pencil size={16} /></ActionIcon>
                                )}
                                {rights.del && (
                                <ActionIcon variant="subtle" color="red" aria-label={`Delete ${r.ref_no}`} onClick={() => remove(r)}><Trash2 size={16} /></ActionIcon>
                                )}
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Stack>
            )}
          </Card>
        </SimpleGrid>
      )}
    </Stack>
  )
}
