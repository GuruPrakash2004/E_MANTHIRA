import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Grid, Group, Menu, Modal, ScrollArea, Skeleton, Stack, Text, TextInput, Textarea, Select } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronUp, Info, Plus, Save, Settings2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as settingsApi from '../../api/endpoints/settings'
import { useAuth } from '../../hooks/useAuth'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import WelcomeVideoCard from './WelcomeVideoCard'

// "Other Settings..." of the legacy screen -> the web screen that does the same job (null = not in the web app).
const OTHER = [
  ['Grid Colour Settings', null],
  ['SMTP Settings', '/settings/admin-master?tab=email'],
  ['SMS Settings', '/settings/admin-master?tab=email'],
  ['Post Doc List', null],
  ['Doc Prefix Settings', null],
  ['Form Colour Settings', null],
  ['Form Userwise Settings', null],
  ['Login Settings', null],
  ['Field Captions', null],
  ['Menu Sequence', '/settings/admin-master?tab=menu'],
  ['Delete Linkage Updation', null],
  ['Transaction Settings', null],
  ['Print Settings', '/settings/admin-master?tab=print-settings'],
  ['View Search Display Fields', null],
  ['Stock Settings', null],
  ['Master Settings', null],
  ['Filter Settings', null],
]

const gkey = (g) => (g || '').trim().toUpperCase()

/**
 * Global Settings (legacy FrmUtlGSettings): settings groups on the left, the group's SetCaption / SetValue on the right,
 * the selected setting's remarks underneath. Edit values and Save; Add creates a new setting (ADMIN); "Show All Group"
 * lists every group's settings with their group name. Rows flagged HideSetting are not listed, as in the legacy screen.
 */
export default function GlobalSettingsTab() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { user } = useAuth()
  const isAdmin = user?.user_code?.toUpperCase() === 'ADMIN'
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.listSettings })
  const [group, setGroup] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [edits, setEdits] = useState({}) // "GROUP::name" -> value
  const [sel, setSel] = useState(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const groups = useMemo(() => {
    const m = new Map()
    ;(data || []).forEach((s) => {
      const k = gkey(s.group === 'General' ? '' : s.group)
      if (!m.has(k)) m.set(k, s.group === 'General' ? '' : s.group)
    })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data])
  useEffect(() => {
    if (groups.length && group === null) setGroup(groups.find(([k]) => k)?.[0] ?? groups[0][0])
  }, [groups, group])

  const rows = (data || []).filter((s) => showAll || gkey(s.group === 'General' ? '' : s.group) === group)
  const keyOf = (s) => `${s.group}::${s.name}`
  const valueOf = (s) => (keyOf(s) in edits ? edits[keyOf(s)] : s.value)
  const dirty = Object.keys(edits).length > 0
  const current = (data || []).find((s) => keyOf(s) === sel)

  async function save() {
    const items = (data || []).filter((s) => keyOf(s) in edits).map((s) => ({ group: s.group === 'General' ? '' : s.group, name: s.name, value: edits[keyOf(s)] }))
    setSaving(true)
    try {
      await settingsApi.saveSettings(items)
      notifications.show({ message: 'Updated successfully.', color: 'teal' })
      setEdits({})
      qc.invalidateQueries({ queryKey: ['settings'] })
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Error during save', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  async function cancel() {
    if (dirty && !(await confirm({ title: 'Discard changes?', message: 'The values you edited will be reset.', confirmLabel: 'Discard' }))) return
    setEdits({})
  }

  if (isLoading) return <Skeleton height={360} radius="md" />

  return (
    <Stack>
      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        <Grid gutter={0}>
          <Grid.Col span={{ base: 12, sm: 4 }} style={{ borderRight: '1px solid var(--vt-line)' }}>
            <div style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, background: 'var(--vt-sandal)', color: 'var(--vt-readonly-ink)' }}>SetGroup</div>
            <ScrollArea h={380}>
              {groups.map(([k, label]) => (
                <div
                  key={k}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setGroup(k); setShowAll(false); setSel(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && setGroup(k)}
                  style={{ padding: '7px 12px', cursor: 'pointer', minHeight: 32, background: !showAll && group === k ? 'var(--vt-gold-chip)' : undefined, fontWeight: !showAll && group === k ? 700 : 400, borderBottom: '1px solid var(--vt-line)' }}
                >
                  {label || ' '}
                </div>
              ))}
            </ScrollArea>
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 8 }}>
            <Group gap={0} wrap="nowrap" style={{ background: 'var(--vt-sandal)', fontWeight: 700, fontSize: 13 }}>
              {showAll && <div style={{ width: 150, padding: '8px 12px', color: 'var(--vt-readonly-ink)' }}>SetGroup</div>}
              <div style={{ flex: 1, padding: '8px 12px', color: 'var(--vt-readonly-ink)' }}>SetCaption</div>
              <div style={{ flex: 1, padding: '8px 12px' }}>SetValue</div>
            </Group>
            <ScrollArea h={320}>
              {rows.map((s) => (
                <Group key={keyOf(s)} gap={0} wrap="nowrap" onClick={() => setSel(keyOf(s))} style={{ borderBottom: '1px solid var(--vt-line)', background: sel === keyOf(s) ? 'var(--vt-gold-chip)' : undefined }}>
                  {showAll && <div style={{ width: 150, padding: '4px 12px', fontSize: 13, color: 'var(--vt-readonly-ink)' }}>{s.group}</div>}
                  <div style={{ flex: 1, padding: '4px 12px', fontSize: 13, color: 'var(--vt-readonly-ink)' }}>{s.caption}</div>
                  <div style={{ flex: 1, padding: '2px 6px' }}>
                    <TextInput
                      size="xs"
                      aria-label={`${s.caption} value`}
                      readOnly={!isAdmin}
                      value={valueOf(s)}
                      onFocus={() => setSel(keyOf(s))}
                      onChange={(e) => { const v = e.currentTarget.value; setEdits((d) => (v === s.value ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== keyOf(s))) : { ...d, [keyOf(s)]: v })) }}
                    />
                  </div>
                </Group>
              ))}
              {rows.length === 0 && <Text size="sm" c="dimmed" p="md">No settings in this group.</Text>}
            </ScrollArea>
            <Group gap="xs" p="sm" wrap="nowrap" style={{ background: 'var(--vt-sandal)', borderTop: '1px solid var(--vt-line)', minHeight: 54 }}>
              <Info size={18} aria-hidden />
              <Text size="sm">{current?.remarks || 'Select a setting to see what it does.'}</Text>
            </Group>
          </Grid.Col>
        </Grid>
      </Card>

      <Group justify="space-between" wrap="wrap">
        <Menu position="top-start" withinPortal>
          <Menu.Target>
            <Button variant="default" leftSection={<Settings2 size={16} />} rightSection={<ChevronUp size={14} />}>Other Settings...</Button>
          </Menu.Target>
          <Menu.Dropdown mah={360} style={{ overflowY: 'auto' }}>
            {OTHER.filter(([n]) => isAdmin || n !== 'Login Settings').map(([name, to]) => (
              <Menu.Item key={name} disabled={!to} onClick={() => to && navigate(to)} title={to ? undefined : 'Not available in the web app yet'}>{name}</Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Group gap="sm">
          <Checkbox color="kumkum" label="Show All Group" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} />
          {dirty && (
            <>
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>Save</Button>
              <Button variant="default" onClick={cancel}>Cancel</Button>
            </>
          )}
          {isAdmin && <Button color="kumkum" variant="light" leftSection={<Plus size={16} />} onClick={() => setAdding(true)}>Add</Button>}
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>Close</Button>
        </Group>
      </Group>
      {!isAdmin && <Text size="xs" c="dimmed">Only ADMIN can change these settings.</Text>}

      {adding && <AddDialog groups={groups.map(([, l]) => l).filter(Boolean)} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['settings'] }) }} />}
      <WelcomeVideoCard />
    </Stack>
  )
}

function AddDialog({ groups, onClose, onSaved }) {
  const [f, setF] = useState({ group: '', name: '', caption: '', value: '', remarks: '', hide: false })
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      const r = await settingsApi.addSetting(f)
      notifications.show({ message: r.message, color: 'teal' })
      onSaved()
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Error during save', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal opened onClose={onClose} size="md" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Add Setting</Text>}>
      <Stack gap="sm">
        <Select label="Group" searchable data={groups} value={f.group || null} onChange={(v) => setF({ ...f, group: v || '' })} placeholder="Select or type a group" clearable />
        <TextInput className="vt-field-required" label="Fld Code" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
        <TextInput className="vt-field-required" label="Fld Caption" required value={f.caption} onChange={(e) => setF({ ...f, caption: e.currentTarget.value })} />
        <TextInput label="Value" value={f.value} onChange={(e) => setF({ ...f, value: e.currentTarget.value })} />
        <Textarea label="Remarks" autosize minRows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.currentTarget.value })} />
        <Checkbox color="kumkum" label="Hide this setting" checked={f.hide} onChange={(e) => setF({ ...f, hide: e.currentTarget.checked })} />
        <Group justify="flex-end">
          <Button color="kumkum" loading={saving} onClick={save}>Save</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
