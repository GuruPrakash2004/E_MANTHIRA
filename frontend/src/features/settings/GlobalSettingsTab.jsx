import { useEffect, useState } from 'react'
import { Accordion, Badge, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import * as settingsApi from '../../api/endpoints/settings'

/**
 * Grouped grid of UtlGSettings (doc 07 §5.9) — Set Group / Setting caption /
 * Value / Remarks, saved on blur. ADMIN sees every row including
 * HideSetting='Y' ones (the backend already filters non-admins out).
 */
export default function GlobalSettingsTab() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.listSettings })
  const [values, setValues] = useState({})

  useEffect(() => {
    if (data) {
      setValues(Object.fromEntries(data.map((s) => [`${s.group}::${s.name}`, s.value])))
    }
  }, [data])

  const groups = {}
  for (const s of data || []) {
    if (!groups[s.group]) groups[s.group] = []
    groups[s.group].push(s)
  }

  async function onBlurSave(setting) {
    const key = `${setting.group}::${setting.name}`
    const newValue = values[key] ?? ''
    if (newValue === setting.value) return
    try {
      await settingsApi.setSetting(setting.group, setting.name, newValue)
      notifications.show({ message: `${setting.caption} updated`, color: 'teal' })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not save setting', color: 'red' })
    }
  }

  if (isLoading) return <Text c="dimmed">Loading settings…</Text>

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Grouped configuration values (UtlGSettings) — same values the legacy app's Global Settings screen edits.
      </Text>
      <Accordion multiple defaultValue={Object.keys(groups).slice(0, 1)}>
        {Object.entries(groups).map(([group, settings]) => (
          <Accordion.Item key={group} value={group}>
            <Accordion.Control>
              <Group gap="xs">
                <Text fw={600}>{group}</Text>
                <Badge size="xs" variant="light" color="gray">
                  {settings.length}
                </Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                {settings.map((s) => {
                  const key = `${s.group}::${s.name}`
                  return (
                    <Tooltip key={key} label={s.remarks} disabled={!s.remarks} multiline w={320} withArrow openDelay={400}>
                      <TextInput
                        label={s.caption}
                        description={s.hidden ? 'Hidden from non-admin users' : undefined}
                        required={s.mandatory}
                        value={values[key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.currentTarget.value }))}
                        onBlur={() => onBlurSave(s)}
                      />
                    </Tooltip>
                  )
                })}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  )
}
