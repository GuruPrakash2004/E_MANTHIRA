import { useMemo, useState } from 'react'
import { Badge, Button, Card, Group, Select, Skeleton, Stack, Switch, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHotkeys } from 'react-hotkeys-hook'
import { CalendarCheck, Save, Search } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/attendance'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { toneColor } from '../../utils/typeTone'
import { isoDate } from '../../utils/format'

/**
 * Attendance (legacy frmUtlAttendance). Every value on this screen comes from the server and so from the database: the
 * title is the menu row's caption, the headings are the real column names, the attendance types (code, label) and the
 * types allowed at this time of day are the Attendance rows of UtlGSettings. Only TODAY can be saved; a row already
 * marked is locked; "Pending only" hides the marked rows (legacy Pending / Restore).
 */
export default function AttendancePage() {
  const qc = useQueryClient()
  const [day, setDay] = useState(new Date())
  const [picks, setPicks] = useState({}) // staff_id -> chosen type code, for rows still open
  const [pendingOnly, setPendingOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  const dayIso = isoDate(day)
  const { data, isLoading } = useQuery({ queryKey: ['attendance-day', dayIso], queryFn: () => api.getDay(dayIso) })

  const types = data?.types || []
  const label = useMemo(() => Object.fromEntries(types.map((t) => [t.code, t.label])), [types])
  const toneOf = (code) => toneColor(Math.max(0, types.findIndex((t) => t.code === code)))
  const rows = (data?.rows || []).filter((r) => !pendingOnly || !r.locked)
  const marked = (data?.rows || []).filter((r) => r.att_type).length
  const chosen = (r) => (r.locked ? r.att_type : picks[r.staff_id] ?? r.att_type)
  const toSave = (data?.rows || []).filter((r) => !r.locked && picks[r.staff_id])
  const cap = data?.captions || {}
  const ready = data?.available && !data?.needs_setup

  async function save() {
    setSaving(true)
    try {
      await api.saveDay((data.rows || []).map((r) => ({ staff_id: r.staff_id, att_type: chosen(r) || '' })))
      notifications.show({ message: 'Data Saved Sucessfully!', color: 'teal' })
      setPicks({})
      qc.invalidateQueries({ queryKey: ['attendance-day'] })
      qc.invalidateQueries({ queryKey: ['attendance-month'] })
    } catch (e) {
      notifications.show({ title: 'Could not save', message: e?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  useHotkeys('alt+s', (e) => { e.preventDefault(); if (data?.editable && toSave.length && !saving) save() }, { enableOnFormTags: true }, [data, picks, saving])

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={data?.title || ' '}
        subtitle={dayjs(day).format('dddd, DD MMMM YYYY')}
        heading={data?.title || ' '}
        sub={data?.title || ' '}
        facts={ready ? [{ label: cap.name, value: data.rows.length }, { label: cap.att_type, value: marked }] : []}
        emblem={<CalendarCheck size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />

      {isLoading ? (
        <Skeleton height={260} radius="md" />
      ) : data && !data.available ? (
        <NotAvailableHere feature={data.title} missing={data.missing} />
      ) : data?.needs_setup ? (
        <NotAvailableHere feature={data.title} missingSettings={data.missing_settings} settingGroup={data.setting_group} settingHelp={data.setting_help} />
      ) : (
        <Card withBorder p="lg">
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="md">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <DateInput label="Date" valueFormat="DD/MM/YYYY" value={day} onChange={(v) => v && (setDay(v), setPicks({}))} maxDate={new Date()} w={160} />
              <Button variant="default" leftSection={<Search size={15} />} onClick={() => qc.invalidateQueries({ queryKey: ['attendance-day'] })}>
                View
              </Button>
              <Switch color="kumkum" label="Pending only" checked={pendingOnly} onChange={(e) => setPendingOnly(e.currentTarget.checked)} />
            </Group>
            <Group gap="xs">
              <ExportExcelButton
                filename={`${data?.title} ${dayjs(day).format('DD-MM-YYYY')}`}
                rows={data?.rows || []}
                columns={[{ label: cap.code, key: 'code' }, { label: cap.name, key: 'name' }, { label: cap.att_type, value: (r) => label[chosen(r)] || '' }]}
              />
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={!data?.editable || toSave.length === 0} onClick={save}>
                Save
              </Button>
            </Group>
          </Group>

          {data?.is_today && data.allowed_types.length === 0 && <Text size="sm" c="dimmed" mb="sm">Nothing can be marked at this time of day.</Text>}
          {data && !data.is_today && <Text size="sm" c="dimmed" mb="sm">Past days are read-only.</Text>}

          {rows.length === 0 ? (
            <EmptyState icon={CalendarCheck} title={pendingOnly ? 'Everyone is marked' : 'No staff'} hint={pendingOnly ? 'Switch off Pending only to see all staff.' : 'There are no active staff members.'} />
          ) : (
            <Table.ScrollContainer minWidth={520}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={140}>{cap.code}</Table.Th>
                    <Table.Th>{cap.name}</Table.Th>
                    <Table.Th w={220}>{cap.att_type}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.staff_id}>
                      <Table.Td className="vt-num">{r.code}</Table.Td>
                      <Table.Td>{r.name}</Table.Td>
                      <Table.Td>
                        {r.locked ? (
                          r.att_type ? <Badge variant="light" color={toneOf(r.att_type)} size="lg">{label[r.att_type] || r.att_type}</Badge> : <Text size="sm" c="dimmed">-</Text>
                        ) : (
                          <Select
                            aria-label={`${cap.att_type} - ${r.name}`}
                            placeholder={data.allowed_types.length ? 'Choose' : 'Not open'}
                            disabled={data.allowed_types.length === 0}
                            clearable
                            data={data.allowed_types.map((c) => ({ value: c, label: label[c] || c }))}
                            value={picks[r.staff_id] || null}
                            onChange={(v) => setPicks((p) => ({ ...p, [r.staff_id]: v || '' }))}
                          />
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
    </Stack>
  )
}
