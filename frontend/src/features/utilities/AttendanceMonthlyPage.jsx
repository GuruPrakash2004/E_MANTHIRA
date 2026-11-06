import { useState } from 'react'
import { Button, Card, Group, Modal, Select, Skeleton, Stack, Switch, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Save, X } from 'lucide-react'
import dayjs from 'dayjs'
import * as api from '../../api/endpoints/attendance'
import { DateInput } from '../../components/ui/AppDates'
import EmptyState from '../../components/ui/EmptyState'
import ExportExcelButton from '../../components/ui/ExportExcelButton'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { toneBg } from '../../utils/typeTone'

/**
 * Attendance Monthly (legacy frmUtlAttMonth): one row per staff member, one column per day, then one total column per
 * attendance type. Everything comes from the database: title = menu caption, headings = real column names, the types, their
 * labels and what one mark counts for (weight) = the Attendance rows of UtlGSettings. Double-click a marked day to change it.
 * "Freeze" pins the staff columns while scrolling across the days (a view setting; nothing is written for it).
 */
const NAME_W = 190
const CODE_W = 90

export default function AttendanceMonthlyPage() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(dayjs().startOf('month').toDate())
  const [freeze, setFreeze] = useState(true)
  const [edit, setEdit] = useState(null) // { row, day, current, to }
  const [saving, setSaving] = useState(false)

  const y = month.getFullYear()
  const m = month.getMonth() + 1
  const { data, isLoading } = useQuery({ queryKey: ['attendance-month', y, m], queryFn: () => api.getMonth(y, m) })
  const types = data?.types || []
  const label = Object.fromEntries(types.map((t) => [t.code, t.label]))
  const bg = (code) => toneBg(Math.max(0, types.findIndex((t) => t.code === code)))
  const cap = data?.captions || {}
  const ready = data?.available && !data?.needs_setup

  async function save() {
    setSaving(true)
    try {
      await api.changeCell({ staff_id: edit.row.staff_id, date: dayjs(new Date(y, m - 1, edit.day)).format('YYYY-MM-DD'), att_type: edit.to })
      notifications.show({ message: 'Data Saved Sucessfully!', color: 'teal' })
      setEdit(null)
      qc.invalidateQueries({ queryKey: ['attendance-month'] })
    } catch (e) {
      notifications.show({ title: 'Could not save', message: e?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const sticky = (left, z = 1) => (freeze ? { position: 'sticky', left, zIndex: z, background: 'var(--vt-surface)' } : {})
  const cell = { padding: '6px 8px', borderBottom: '1px solid var(--vt-line)', textAlign: 'center', fontSize: 13, minWidth: 34 }

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title={data?.title || ' '}
        subtitle={dayjs(month).format('MMMM YYYY')}
        heading={dayjs(month).format('MMMM YYYY')}
        sub={data?.title || ' '}
        facts={ready ? [{ label: cap.name, value: data.rows.length }] : []}
        emblem={<CalendarRange size={60} color="#F4E1A6" strokeWidth={1.4} />}
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
              <DateInput label="Month" valueFormat="MMMM YYYY" value={month} onChange={(v) => v && setMonth(dayjs(v).startOf('month').toDate())} w={180} />
              <Switch color="kumkum" label="Freeze" checked={freeze} onChange={(e) => setFreeze(e.currentTarget.checked)} />
            </Group>
            <ExportExcelButton
              filename={`${data?.title} ${dayjs(month).format('MMM-YYYY')}`}
              rows={data?.rows || []}
              columns={[
                { label: cap.code, key: 'code' },
                { label: cap.name, key: 'name' },
                ...(data?.days || []).map((d) => ({ label: String(d), value: (r) => r.days[d] || '' })),
                ...types.map((t) => ({ label: t.label, value: (r) => r.totals[t.code] })),
              ]}
            />
          </Group>

          <Group gap="md" mb="xs">
            {types.map((t) => (
              <Group key={t.code} gap={6}>
                <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: bg(t.code), border: '1px solid var(--vt-line)' }} />
                <Text size="xs">{t.code} = {t.label}</Text>
              </Group>
            ))}
          </Group>

          {!data || data.rows.length === 0 ? (
            <EmptyState icon={CalendarRange} title="No staff" hint="There are no active staff members." />
          ) : (
            <div style={{ overflow: 'auto', maxHeight: '65vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--vt-sandal)' }}>
                  <tr>
                    <th style={{ ...cell, textAlign: 'left', width: CODE_W, minWidth: CODE_W, ...sticky(0, 4), background: 'var(--vt-sandal)' }}>{cap.code}</th>
                    <th style={{ ...cell, textAlign: 'left', width: NAME_W, minWidth: NAME_W, ...sticky(CODE_W, 4), background: 'var(--vt-sandal)' }}>{cap.name}</th>
                    {data.days.map((d) => <th key={d} style={{ ...cell, color: 'var(--vt-accent)' }}>{d}</th>)}
                    {types.map((t) => <th key={t.code} style={{ ...cell, color: 'var(--vt-accent)' }}>{t.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.staff_id}>
                      <td className="vt-num" style={{ ...cell, textAlign: 'left', ...sticky(0) }}>{r.code}</td>
                      <td style={{ ...cell, textAlign: 'left', whiteSpace: 'nowrap', ...sticky(CODE_W) }}>{r.name}</td>
                      {data.days.map((d) => {
                        const v = r.days[d]
                        return (
                          <td
                            key={d}
                            title={v ? label[v] || v : undefined}
                            onDoubleClick={v ? () => setEdit({ row: r, day: d, current: v, to: v }) : undefined}
                            style={{ ...cell, background: v ? bg(v) : undefined, cursor: v ? 'pointer' : 'default', fontWeight: v ? 600 : 400 }}
                          >
                            {v || ''}
                          </td>
                        )
                      })}
                      {types.map((t) => <td key={t.code} className="vt-num" style={cell}>{r.totals[t.code]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal opened={Boolean(edit)} onClose={() => setEdit(null)} radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{data?.title}</Text>}>
        {edit && (
          <Stack gap="sm">
            <Group grow>
              <div><Text size="xs" c="dimmed">{cap.code}</Text><Text fw={600}>{edit.row.code}</Text></div>
              <div><Text size="xs" c="dimmed">{cap.name}</Text><Text fw={600}>{edit.row.name}</Text></div>
            </Group>
            <Group grow>
              <div><Text size="xs" c="dimmed">Date</Text><Text fw={600}>{dayjs(new Date(y, m - 1, edit.day)).format('DD/MM/YYYY')}</Text></div>
              <div><Text size="xs" c="dimmed">Current</Text><Text fw={600}>{label[edit.current] || edit.current}</Text></div>
            </Group>
            <Select label={cap.att_type} allowDeselect={false} data={types.map((t) => ({ value: t.code, label: t.label }))} value={edit.to} onChange={(v) => v && setEdit({ ...edit, to: v })} data-autofocus />
            <Group justify="flex-end">
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={edit.to === edit.current} onClick={save}>Save</Button>
              <Button variant="default" leftSection={<X size={16} />} onClick={() => setEdit(null)}>Cancel</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
