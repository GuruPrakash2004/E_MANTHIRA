import { useMemo, useState } from 'react'
import { ActionIcon, Button, Card, Group, SimpleGrid, Skeleton, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { Building, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, DoorOpen } from 'lucide-react'
import { useQueries, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as hallApi from '../../api/endpoints/hall'
import StatCard from '../../components/ui/StatCard'
import EmptyState from '../../components/ui/EmptyState'
import { SectionCard } from '../../components/ui/EntryParts'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const BOOKED = 'var(--mantine-color-kumkum-7)'

/** Legacy Hall Status report (frmRptRoomStatus): grid of halls x days. Booked cells are maroon, today's column is gold. */
export default function HallStatusPage() {
  const [month, setMonth] = useState(dayjs().startOf('month'))
  const monthStart = month.format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')

  const { data: halls, isLoading: hallsLoading } = useQuery({ queryKey: ['halls'], queryFn: hallApi.listHalls })

  const availabilityQueries = useQueries({
    queries: (halls || []).map((h) => ({
      queryKey: ['hall-availability', h.HALLID, monthStart],
      queryFn: () => hallApi.getAvailability(h.HALLID, monthStart, 1),
      enabled: Boolean(halls),
    })),
  })
  const loading = hallsLoading || availabilityQueries.some((q) => q.isLoading)

  const daysInMonth = month.daysInMonth()
  const days = Array.from({ length: daysInMonth }, (_, i) => month.add(i, 'day'))

  // Per hall: day -> booking row; plus a flat list of bookings (consecutive days of one booking merged).
  const { rows, bookings, bookedDays, bookedToday } = useMemo(() => {
    const out = []
    const list = []
    let total = 0
    let nowCount = 0
    ;(halls || []).forEach((h, hi) => {
      const byDay = {}
      const merged = new Map()
      for (const row of availabilityQueries[hi]?.data || []) {
        const iso = dayjs(row.STAYDATE).format('YYYY-MM-DD')
        byDay[iso] = row
        total += 1
        if (iso === today) nowCount += 1
        const key = row.PrintHBNO || iso
        const m = merged.get(key) || { hall: h.HALLNAME, no: row.PrintHBNO, func: row.NMEOFFUNC, from: iso, to: iso, count: 0 }
        if (iso < m.from) m.from = iso
        if (iso > m.to) m.to = iso
        m.count += 1
        merged.set(key, m)
      }
      out.push({ hall: h, byDay })
      list.push(...merged.values())
    })
    list.sort((a, b) => a.from.localeCompare(b.from))
    return { rows: out, bookings: list, bookedDays: total, bookedToday: nowCount }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halls, availabilityQueries.map((q) => q.dataUpdatedAt).join(',')])

  const hallCount = (halls || []).length
  const isThisMonth = month.isSame(dayjs(), 'month')
  const fmt = (iso) => dayjs(iso).format('DD/MM/YYYY')

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Hall Status</Title>
            <Text size="sm" c="dimmed">
              Which halls are booked on which days
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <ActionIcon variant="light" color="kumkum" size={40} aria-label="Previous month" onClick={() => setMonth((m) => m.subtract(1, 'month'))}>
            <ChevronLeft size={18} />
          </ActionIcon>
          <Text fw={700} w={150} ta="center" aria-live="polite" style={{ fontFamily: 'Marcellus, Georgia, serif', fontSize: 20 }}>
            {month.format('MMMM YYYY')}
          </Text>
          <ActionIcon variant="light" color="kumkum" size={40} aria-label="Next month" onClick={() => setMonth((m) => m.add(1, 'month'))}>
            <ChevronRight size={18} />
          </ActionIcon>
          <Button variant="default" size="sm" disabled={isThisMonth} onClick={() => setMonth(dayjs().startOf('month'))}>
            This month
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        <StatCard label="Halls" value={hallCount} icon={Building} footer="Configured halls and rooms" loading={hallsLoading} />
        <StatCard label="Booked hall-days" value={bookedDays} icon={CalendarCheck} tone="dark" footer={`In ${month.format('MMMM')}`} loading={loading} />
        <StatCard label="Booked today" value={isThisMonth ? bookedToday : '-'} icon={DoorOpen} footer={isThisMonth ? `${Math.max(hallCount - bookedToday, 0)} free today` : 'Shown for the current month'} loading={loading} />
      </SimpleGrid>

      <Card withBorder p="lg">
        <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap="xs">
          <Title order={4}>Occupancy</Title>
          <Group gap="md">
            <Group gap={6}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: BOOKED, display: 'inline-block' }} />
              <Text size="xs">Booked</Text>
            </Group>
            <Group gap={6}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: '#fff', border: '1px solid var(--vt-line)', display: 'inline-block' }} />
              <Text size="xs">Free</Text>
            </Group>
            <Group gap={6}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--mantine-color-gold-1)', border: '1px solid var(--mantine-color-gold-5)', display: 'inline-block' }} />
              <Text size="xs">Today</Text>
            </Group>
          </Group>
        </Group>

        {loading ? (
          <Stack gap="xs">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={40} radius="md" />
            ))}
          </Stack>
        ) : hallCount === 0 ? (
          <EmptyState icon={Building} title="No halls configured" hint="Add halls in the Hall master and they will appear here." />
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table withColumnBorders style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--mantine-color-gold-0)', minWidth: 150 }}>Hall</Table.Th>
                  {days.map((d) => {
                    const isToday = d.format('YYYY-MM-DD') === today
                    const weekend = d.day() === 0 || d.day() === 6
                    return (
                      <Table.Th
                        key={d.format('D')}
                        style={{
                          textAlign: 'center',
                          minWidth: 32,
                          padding: '4px 2px',
                          background: isToday ? 'var(--mantine-color-gold-3)' : undefined,
                          color: weekend && !isToday ? 'var(--mantine-color-kumkum-7)' : undefined,
                        }}
                      >
                        <div className="vt-num">{d.format('D')}</div>
                        <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.75 }}>{d.format('dd')}</div>
                      </Table.Th>
                    )
                  })}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map(({ hall, byDay }) => (
                  <Table.Tr key={hall.HALLID}>
                    <Table.Td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>{hall.HALLNAME}</Table.Td>
                    {days.map((d) => {
                      const iso = d.format('YYYY-MM-DD')
                      const booking = byDay[iso]
                      const isToday = iso === today
                      const cell = (
                        <Table.Td
                          key={iso}
                          aria-label={booking ? `${hall.HALLNAME}, ${fmt(iso)}: booked ${booking.PrintHBNO || ''}` : undefined}
                          style={{
                            textAlign: 'center',
                            padding: 0,
                            height: 36,
                            background: booking ? BOOKED : isToday ? 'var(--mantine-color-gold-0)' : undefined,
                            color: booking ? '#FBF6EC' : undefined,
                          }}
                        >
                          {booking ? '●' : ''}
                        </Table.Td>
                      )
                      return booking ? (
                        <Tooltip key={iso} label={`${booking.PrintHBNO || ''}${booking.NMEOFFUNC ? ` · ${booking.NMEOFFUNC}` : ''}`} withArrow>
                          {cell}
                        </Tooltip>
                      ) : (
                        cell
                      )
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <SectionCard title="Bookings this month" hint="The same bookings as a list, with their dates.">
        {loading ? (
          <Skeleton height={60} radius="md" />
        ) : bookings.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No bookings this month" hint="Bookings made in Hall Booking will show up here." />
        ) : (
          <Table.ScrollContainer minWidth={520}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Booking</Table.Th>
                  <Table.Th>Hall</Table.Th>
                  <Table.Th>Function</Table.Th>
                  <Table.Th>Dates</Table.Th>
                  <Table.Th ta="right">Days</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {bookings.map((b) => (
                  <Table.Tr key={`${b.hall}-${b.no}-${b.from}`}>
                    <Table.Td className="vt-num" fw={600}>
                      {b.no || '-'}
                    </Table.Td>
                    <Table.Td>{b.hall}</Table.Td>
                    <Table.Td>{b.func || '-'}</Table.Td>
                    <Table.Td className="vt-num">{b.from === b.to ? fmt(b.from) : `${fmt(b.from)} to ${fmt(b.to)}`}</Table.Td>
                    <Table.Td className="vt-num" ta="right">
                      {b.count}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </SectionCard>
    </Stack>
  )
}
