import { useState } from 'react'
import { ActionIcon, Card, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useQueries, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as hallApi from '../../api/endpoints/hall'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

/** Legacy Hall Status report (frmRptRoomStatus) — grid of halls x days, red = booked. */
export default function HallStatusPage() {
  const [month, setMonth] = useState(dayjs().startOf('month'))
  const monthStart = month.format('YYYY-MM-DD')

  const { data: halls } = useQuery({ queryKey: ['halls'], queryFn: hallApi.listHalls })

  const availabilityQueries = useQueries({
    queries: (halls || []).map((h) => ({
      queryKey: ['hall-availability', h.HALLID, monthStart],
      queryFn: () => hallApi.getAvailability(h.HALLID, monthStart, 1),
      enabled: Boolean(halls),
    })),
  })

  const daysInMonth = month.daysInMonth()
  const days = Array.from({ length: daysInMonth }, (_, i) => month.add(i, 'day'))

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Hall Status
            </Title>
            <Text size="sm" c="dimmed">
              Occupancy grid — red cells are booked, hover for details
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

      <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'auto' }}>
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
        />
        <Table striped withTableBorder style={{ position: 'relative', minWidth: 900 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ position: 'sticky', left: 0, background: 'white', zIndex: 1 }}>Hall</Table.Th>
              {days.map((d) => (
                <Table.Th key={d.format('D')} style={{ textAlign: 'center', minWidth: 32, padding: 4 }}>
                  {d.format('D')}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(halls || []).map((h, hi) => {
              const bookedByDay = {}
              for (const row of availabilityQueries[hi]?.data || []) {
                bookedByDay[dayjs(row.STAYDATE).format('YYYY-MM-DD')] = row
              }
              return (
                <Table.Tr key={h.HALLID}>
                  <Table.Td style={{ position: 'sticky', left: 0, background: 'white', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {h.HALLNAME}
                  </Table.Td>
                  {days.map((d) => {
                    const iso = d.format('YYYY-MM-DD')
                    const booking = bookedByDay[iso]
                    const cell = (
                      <Table.Td
                        key={iso}
                        style={{
                          textAlign: 'center',
                          background: booking ? '#C0392B' : undefined,
                          color: booking ? 'white' : undefined,
                          cursor: booking ? 'default' : undefined,
                          padding: 4,
                        }}
                      >
                        {booking ? '●' : ''}
                      </Table.Td>
                    )
                    return booking ? (
                      <Tooltip key={iso} label={`${booking.PrintHBNO} — ${booking.NMEOFFUNC || ''}`} withArrow>
                        {cell}
                      </Tooltip>
                    ) : (
                      cell
                    )
                  })}
                </Table.Tr>
              )
            })}
            {(halls || []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={daysInMonth + 1}>
                  <Text c="dimmed" ta="center" py="md">
                    No halls configured.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
