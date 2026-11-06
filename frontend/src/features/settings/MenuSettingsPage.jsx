import { Badge, Card, Divider, Group, Skeleton, Stack, Switch, Text, Title } from '@mantine/core'
import { SlidersHorizontal } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'

export default function MenuSettingsPage() {
  const queryClient = useQueryClient()
  const { data: items, refetch } = useQuery({ queryKey: ['menu-settings'], queryFn: metaApi.getMenuSettings })

  // Groups come straight from the rows the backend serves (already ordered by MenuItemType), so no menu type can go missing.
  const grouped = (items || []).reduce((acc, m) => {
    let g = acc.find((x) => x.type === m.type)
    if (!g) acc.push((g = { type: m.type, items: [] }))
    g.items.push(m)
    return acc
  }, [])

  async function toggle(item, show) {
    try {
      await metaApi.setMenuVisibility(item.menu_item_id, show)
      queryClient.setQueryData(['menu-settings'], (old) => (old || []).map((m) => (m.menu_item_id === item.menu_item_id ? { ...m, show } : m)))
      queryClient.invalidateQueries({ queryKey: ['menu'] })
      notifications.show({ message: `${item.caption} ${show ? 'shown' : 'hidden'} in the menu`, color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not update', color: 'red' })
      refetch()
    }
  }

  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed">
        Show or hide any master, transaction, voucher or report for this temple. This is the same MenuShow flag the desktop app uses. Changes apply straight away.
      </Text>

      {!items && [0, 1].map((i) => <Skeleton key={i} height={160} radius="md" />)}

      <div style={{ display: 'grid', gap: 'var(--mantine-spacing-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        {grouped.map((g) => {
          const shown = g.items.filter((m) => m.show).length
          return (
            <Card key={g.type} withBorder p="lg">
              <Group justify="space-between" mb="sm" wrap="nowrap">
                <Group gap={8}>
                  <SlidersHorizontal size={18} color="var(--vt-accent)" aria-hidden />
                  <Title order={4}>{g.type}</Title>
                </Group>
                <Badge variant="light" color="gold" c="var(--vt-badge-ink)" tt="none">
                  {shown} of {g.items.length} shown
                </Badge>
              </Group>
              <Stack gap={0}>
                {g.items.map((item, i) => (
                  <div key={item.menu_item_id}>
                    {i > 0 && <Divider my={4} />}
                    <Group justify="space-between" wrap="nowrap" mih={44}>
                      <Text size="sm" id={`menu-${item.menu_item_id}`}>{item.caption}</Text>
                      <Switch aria-labelledby={`menu-${item.menu_item_id}`} checked={item.show} onChange={(e) => toggle(item, e.currentTarget.checked)} color="kumkum" />
                    </Group>
                  </div>
                ))}
              </Stack>
            </Card>
          )
        })}
      </div>
    </Stack>
  )
}
