import { useState } from 'react'
import { ActionIcon, Button, Card, Group, Modal, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarHeart, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/legacyMasters'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { isoDate } from '../../utils/format'
import useRights from '../../hooks/useRights'

/**
 * Holiday Master (legacy frmMstHoliday): the holidays of the financial year, one per date. The title is the menu row's
 * caption and the headings are the real column names (both from the server); the list shows the active financial year
 * unless another From / To is chosen. Rules as in the EXE: a name is required and must be words, the date must fall in the
 * financial year, one holiday per date.
 */
export default function HolidayMasterPage() {
  const rights = useRights()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [range, setRange] = useState(null) // { from, to } once the user changes it
  const [draft, setDraft] = useState({ from: null, to: null })
  const [form, setForm] = useState(null) // { date, name, editing }
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  const params = range ? { from: isoDate(range.from), to: isoDate(range.to) } : undefined
  const { data, isLoading } = useQuery({ queryKey: ['holidays', params?.from || '', params?.to || ''], queryFn: () => api.listHolidays(params) })
  const cap = data?.captions || {}
  const rows = (data?.rows || []).filter((r) => !q.trim() || `${r.name} ${r.date}`.toLowerCase().includes(q.trim().toLowerCase()))
  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] })
  const fail = (e, fb) => notifications.show({ message: e?.response?.data?.detail || fb, color: 'red' })

  async function save() {
    setSaving(true)
    try {
      const body = { date: isoDate(form.date), name: form.name }
      const r = form.editing ? await api.updateHoliday(body) : await api.addHoliday(body)
      notifications.show({ message: r.message, color: 'teal' })
      setForm(null)
      refresh()
    } catch (e) {
      fail(e, 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(r) {
    if (!(await confirm({ title: 'Delete this holiday?', message: `${r.name} (${dayjs(r.date).format('DD/MM/YYYY')}) will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      const res = await api.deleteHoliday(r.date)
      notifications.show({ message: res.message, color: 'teal' })
      refresh()
    } catch (e) {
      fail(e, 'Could not delete')
    }
  }

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={data?.title || ' '}
        subtitle={data?.available ? `${dayjs(data.from).format('DD/MM/YYYY')} - ${dayjs(data.to).format('DD/MM/YYYY')}` : ' '}
        heading={data?.title || ' '}
        sub={data?.title || ' '}
        facts={data?.available ? [{ label: cap.name, value: data.rows.length }] : []}
        emblem={<CalendarHeart size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />

      {isLoading ? (
        <Skeleton height={240} radius="md" />
      ) : data && !data.available ? (
        <NotAvailableHere feature={data.title} missing={data.missing} />
      ) : (
        <Card withBorder p="lg">
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="md">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <DateInput label="From" valueFormat="DD/MM/YYYY" value={draft.from || (data ? new Date(data.from) : null)} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} w={150} />
              <DateInput label="To" valueFormat="DD/MM/YYYY" value={draft.to || (data ? new Date(data.to) : null)} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} w={150} />
              <Button
                variant="default"
                leftSection={<Search size={15} />}
                onClick={() => {
                  const from = draft.from || new Date(data.from)
                  const to = draft.to || new Date(data.to)
                  if (from > to) return notifications.show({ message: 'From Date should be less than To Date....', color: 'red' })
                  setRange({ from, to })
                }}
              >
                View
              </Button>
              <TextInput placeholder="Search" leftSection={<Search size={15} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={200} />
            </Group>
            <Group gap="xs">
              <ExportExcelButton filename={data?.title || 'Holidays'} rows={rows} columns={[{ label: cap.date, value: (r) => dayjs(r.date).format('DD/MM/YYYY') }, { label: cap.name, key: 'name' }]} />
              {rights.add && (
              <Button color="kumkum" leftSection={<Plus size={16} />} onClick={() => setForm({ date: new Date(data.from), name: '', editing: false })}>
                Add
              </Button>
              )}
            </Group>
          </Group>

          {rows.length === 0 ? (
            <EmptyState icon={CalendarHeart} title="No holidays" hint="Nothing is listed for this range. Use Add to enter one." />
          ) : (
            <Table.ScrollContainer minWidth={420}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={150}>{cap.date}</Table.Th>
                    <Table.Th>{cap.name}</Table.Th>
                    <Table.Th w={100} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.date}>
                      <Table.Td className="vt-num">{dayjs(r.date).format('DD/MM/YYYY')}</Table.Td>
                      <Table.Td>{r.name}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          {rights.edit && (
                          <ActionIcon variant="subtle" color="kumkum" aria-label={`Edit ${r.name}`} onClick={() => setForm({ date: new Date(r.date), name: r.name, editing: true })}><Pencil size={16} /></ActionIcon>
                          )}
                          {rights.del && (
                          <ActionIcon variant="subtle" color="red" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><Trash2 size={16} /></ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      <Modal opened={Boolean(form)} onClose={() => setForm(null)} radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{data?.title}</Text>}>
        {form && (
          <Stack gap="sm">
            <DateInput label={cap.date} valueFormat="DD/MM/YYYY" value={form.date} disabled={form.editing} onChange={(v) => v && setForm({ ...form, date: v })} />
            <TextInput label={cap.name} data-autofocus value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
              <Button variant="default" leftSection={<X size={16} />} onClick={() => setForm(null)}>Cancel</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
