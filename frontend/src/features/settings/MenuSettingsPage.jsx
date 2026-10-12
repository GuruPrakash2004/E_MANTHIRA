import { Card, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core'
import { SlidersHorizontal } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'
const TYPE_ORDER = ['Transactions', 'Vouchers', 'Masters', 'Reports', 'Ac-Reports', 'Utilities']

export default function MenuSettingsPage() {
  const queryClient = useQueryClient()
  const { data: items, refetch } = useQuery({ queryKey: ['menu-settings'], queryFn: metaApi.getMenuSettings })

  const grouped = TYPE_ORDER.map((type) => ({ type, items: (items || []).filter((m) => m.type === type) })).filter((g) => g.items.length)

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
    <Stack>
      <Group gap="sm">
        <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
        <div>
          <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
            Customise Menu
          </Title>
          <Text size="sm" c="dimmed">
            Show or hide any master, transaction, voucher or report for this temple — same MenuShow flag the desktop app uses
          </Text>
        </div>
      </Group>

      {grouped.map((g) => (
        <Card key={g.type} withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
          <div
            aria-hidden
            style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
          />
          <Group gap={8} mb="sm" style={{ position: 'relative' }}>
            <SlidersHorizontal size={18} color="#7A1F1F" />
            <Title order={4} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              {g.type}
            </Title>
          </Group>
          <Stack gap={0} style={{ position: 'relative' }}>
            {g.items.map((item, i) => (
              <div key={item.menu_item_id}>
                {i > 0 && <Divider my={8} />}
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm">{item.caption}</Text>
                  <Switch checked={item.show} onChange={(e) => toggle(item, e.currentTarget.checked)} color="kumkum" />
                </Group>
              </div>
            ))}
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}
