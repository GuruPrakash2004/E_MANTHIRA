import { useMemo, useState } from 'react'
import { Button, Card, Group, Modal, MultiSelect, SegmentedControl, Skeleton, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Plus, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api/endpoints/utilities'
import EmptyState from '../../components/ui/EmptyState'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'

/**
 * Reminder Alert (legacy frmUtlNotification): short messages between users. Inbox = sent to me, Sent = sent by me.
 * One row is written per recipient (UtlNotify, status 'N'); delete removes a row, Delete All clears everything I sent.
 */
export default function ReminderAlertPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [box, setBox] = useState('inbox')
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState(null) // { title, note, to: [] }
  const [saving, setSaving] = useState(false)
  const [userQ, setUserQ] = useState('')
  const [dq] = useDebouncedValue(userQ, 250)

  const { data, isLoading } = useQuery({ queryKey: ['notifications', box], queryFn: () => api.listNotifications(box) })
  const { data: found } = useQuery({ queryKey: ['notify-users', dq], queryFn: () => api.searchNotifyUsers(dq), enabled: Boolean(form) && dq.trim().length > 0 })
  const rows = data?.rows || []
  const sent = box === 'sent'
  const userOptions = useMemo(() => {
    const byCode = new Map((form?.picked || []).map((u) => [u.code, u]))
    ;(found || []).forEach((u) => byCode.set(u.code, u))
    return [...byCode.values()].map((u) => ({ value: u.code, label: u.name ? `${u.code} - ${u.name}` : u.code }))
  }, [found, form?.picked])

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  const fail = (e, fallback) => notifications.show({ message: e?.response?.data?.detail || fallback, color: 'red' })

  async function send() {
    setSaving(true)
    try {
      const r = await api.sendNotification({ title: form.title, note: form.note, to: form.to })
      notifications.show({ message: r.message, color: 'teal' })
      setForm(null)
      setUserQ('')
      refresh()
    } catch (e) {
      fail(e, 'Error during Save')
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    const cur = rows.find((r) => r.id === sel)
    if (!cur) return notifications.show({ message: 'No data present to delete!', color: 'yellow' })
    if (!(await confirm({ title: 'Delete notification?', message: `Are you sure you want to delete the data: '${cur.notification}'?`, confirmLabel: 'Delete' }))) return
    try {
      await api.deleteNotification(cur.id)
      setSel(null)
      refresh()
    } catch (e) {
      fail(e, 'Error during Deletion')
    }
  }
  async function removeAll() {
    if (!(await confirm({ title: 'Delete all sent notifications?', message: 'Every notification you have sent will be deleted.', confirmLabel: 'Delete all' }))) return
    try {
      const r = await api.deleteAllSentNotifications()
      notifications.show({ message: r.message, color: 'teal' })
      setSel(null)
      refresh()
    } catch (e) {
      fail(e, 'Error during Deletion')
    }
  }

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title="Reminder Alert"
        subtitle="Send short messages to other users and read the ones sent to you."
        heading={sent ? 'Notifications sent by me' : 'Notifications for me'}
        sub="Reminder Alert"
        facts={[{ label: 'unread', value: data?.unread ?? '-' }]}
        emblem={<Bell size={60} color="#F4E1A6" strokeWidth={1.4} />}
        actions={
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        }
      />

      <Card withBorder p="lg">
        <Stack gap="md">
          <SegmentedControl
            color="kumkum"
            value={box}
            onChange={(v) => { setBox(v); setSel(null) }}
            data={[{ value: 'inbox', label: 'Received' }, { value: 'sent', label: 'Sent' }]}
            maw={260}
          />
          {isLoading ? (
            <Skeleton height={140} radius="md" />
          ) : rows.length === 0 ? (
            <EmptyState icon={Bell} title={sent ? 'Nothing sent yet' : 'No notifications for you'} hint="Press New to send one." />
          ) : (
            <Table.ScrollContainer minWidth={520}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{sent ? 'To' : 'From'}</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Notification</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.id} onClick={() => setSel(r.id)} style={{ cursor: 'pointer', background: sel === r.id ? 'var(--vt-gold-chip)' : undefined }}>
                      <Table.Td>{sent ? r.to : r.from}</Table.Td>
                      <Table.Td fw={r.status === 'N' && !sent ? 700 : undefined}>{r.title}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'pre-wrap' }}>{r.notification}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Plus size={16} />} onClick={() => setForm({ title: '', note: '', to: [], picked: [] })}>
              New
            </Button>
            <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={!sel} onClick={remove}>
              Delete
            </Button>
            {sent && (
              <Button variant="light" color="red" disabled={rows.length === 0} onClick={removeAll}>
                Delete All
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {form && (
        <Modal opened onClose={() => setForm(null)} radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>New notification</Text>}>
          <Stack gap="sm">
            <MultiSelect
              className="vt-field-required"
              label="To (users)"
              required
              searchable
              placeholder="Type a user code"
              data={userOptions}
              value={form.to}
              searchValue={userQ}
              onSearchChange={setUserQ}
              nothingFoundMessage={userQ.trim() ? 'No matching user' : 'Type to search users'}
              filter={({ options }) => options}
              onChange={(v) => setForm({ ...form, to: v, picked: userOptions.filter((o) => v.includes(o.value)).map((o) => ({ code: o.value, name: o.label.split(' - ')[1] || '' })) })}
              data-autofocus
            />
            <TextInput className="vt-field-required" label="Title" required maxLength={50} value={form.title} onChange={(e) => setForm({ ...form, title: e.currentTarget.value })} />
            <Textarea className="vt-field-required" label="Note" required autosize minRows={3} maxLength={250} value={form.note} onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button color="kumkum" loading={saving} disabled={!form.title.trim() || !form.note.trim() || form.to.length === 0} onClick={send}>Send</Button>
              <Button variant="default" onClick={() => setForm(null)}>Cancel</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
