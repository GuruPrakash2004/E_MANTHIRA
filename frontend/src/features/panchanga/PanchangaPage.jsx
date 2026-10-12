import { useState } from 'react'
import { ActionIcon, Button, Card, Grid, Group, Modal, Stack, Text, TextInput, Title } from '@mantine/core'
import { ChevronLeft, ChevronRight, MoonStar } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as panchangaApi from '../../api/endpoints/panchanga'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** OLE colour (0x00BBGGRR, as stored in MstEVENT.CLRCODE) -> CSS rgb(). */
function oleColorToCss(v) {
  if (v == null || v < 0) return null
  const r = v & 0xff
  const g = (v >> 8) & 0xff
  const b = (v >> 16) & 0xff
  return `rgb(${r}, ${g}, ${b})`
}

export default function PanchangaPage() {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(dayjs().startOf('month'))
  const [editDay, setEditDay] = useState(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  const from = month.startOf('month')
  const to = month.endOf('month')
  const { data, refetch } = useQuery({
    queryKey: ['panchanga', from.format('YYYY-MM-DD')],
    queryFn: () => panchangaApi.listPanchanga(from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD')),
  })
  const byDate = Object.fromEntries((data || []).map((d) => [d.date, d]))

  const gridStart = from.startOf('week')
  const gridEnd = to.endOf('week')
  const days = []
  for (let d = gridStart; d.isBefore(gridEnd) || d.isSame(gridEnd, 'day'); d = d.add(1, 'day')) {
    days.push(d)
  }

  function openDay(d) {
    const iso = d.format('YYYY-MM-DD')
    setEditDay(iso)
    setEditName(byDate[iso]?.name || '')
  }

  async function onSaveDay() {
    setSaving(true)
    try {
      if (editName.trim()) {
        await panchangaApi.setPanchangaDay(editDay, editName.trim())
      } else {
        await panchangaApi.deletePanchangaDay(editDay)
      }
      notifications.show({ message: 'Saved', color: 'teal' })
      setEditDay(null)
      queryClient.invalidateQueries({ queryKey: ['panchanga'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Panchanga
            </Title>
            <Text size="sm" c="dimmed">
              Temple calendar — click a day to set or change its event
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <ActionIcon variant="light" color="kumkum" onClick={() => setMonth((m) => m.subtract(1, 'month'))}>
            <ChevronLeft size={16} />
          </ActionIcon>
          <Text fw={600} w={140} ta="center">
            {month.format('MMMM YYYY')}
          </Text>
          <ActionIcon variant="light" color="kumkum" onClick={() => setMonth((m) => m.add(1, 'month'))}>
            <ChevronRight size={16} />
          </ActionIcon>
        </Group>
      </Group>

      <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
        />
        <Grid gutter={4} style={{ position: 'relative' }}>
          {WEEKDAYS.map((w) => (
            <Grid.Col span={12 / 7} key={w}>
              <Text ta="center" size="xs" fw={700} c="dimmed">
                {w}
              </Text>
            </Grid.Col>
          ))}
          {days.map((d) => {
            const iso = d.format('YYYY-MM-DD')
            const entry = byDate[iso]
            const inMonth = d.isSame(month, 'month')
            const color = oleColorToCss(entry?.color)
            return (
              <Grid.Col span={12 / 7} key={iso}>
                <Card
                  withBorder
                  radius="md"
                  p="xs"
                  onClick={() => openDay(d)}
                  style={{
                    cursor: 'pointer',
                    minHeight: 64,
                    opacity: inMonth ? 1 : 0.35,
                    background: entry ? color || 'rgba(122,31,31,0.08)' : undefined,
                  }}
                >
                  <Text size="xs" fw={600}>
                    {d.format('D')}
                  </Text>
                  {entry && (
                    <Text size="xs" c={color ? 'white' : 'kumkum'} fw={600} lineClamp={2}>
                      {entry.name}
                    </Text>
                  )}
                </Card>
              </Grid.Col>
            )
          })}
        </Grid>
      </Card>

      <Modal opened={Boolean(editDay)} onClose={() => setEditDay(null)} title={editDay ? dayjs(editDay).format('DD MMMM YYYY') : ''} radius="lg">
        <Stack>
          <TextInput
            label="Event / Day Name"
            placeholder="e.g. Rathothsava, Amavasya, Poornima"
            leftSection={<MoonStar size={16} />}
            value={editName}
            onChange={(e) => setEditName(e.currentTarget.value)}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setEditDay(null)}>
              Cancel
            </Button>
            <Button color="kumkum" loading={saving} onClick={onSaveDay}>
              {editName.trim() ? 'Save' : 'Clear'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
