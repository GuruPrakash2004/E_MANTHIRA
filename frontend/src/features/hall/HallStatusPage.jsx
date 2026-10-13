import { useMemo, useState } from 'react'
import { Button, Card, Group, SimpleGrid, Skeleton, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Building, CalendarCheck, CalendarDays, DoorOpen, FileDown, Search } from 'lucide-react'
import { useQueries, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { isoDate } from '../../utils/format'
import * as hallApi from '../../api/endpoints/hall'
import StatCard from '../../components/ui/StatCard'
import EmptyState from '../../components/ui/EmptyState'
import { downloadXls } from '../../utils/xls'
import { SectionCard } from '../../components/ui/EntryParts'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const BOOKED = 'var(--mantine-color-kumkum-7)'

/** Legacy Hall Status report (frmRptRoomStatus): grid of halls x days. Booked cells are maroon, today's column is gold. */
export default function HallStatusPage() {
  // Legacy: pick a From / To date range, press View. Default is the current month.
  const [draft, setDraft] = useState({ from: dayjs().startOf('month').toDate(), to: dayjs().endOf('month').toDate() })
  const [range, setRange] = useState({ from: dayjs().startOf('month'), to: dayjs().endOf('month') })
  const monthStart = range.from.format('YYYY-MM-DD')
  const rangeEnd = range.to.format('YYYY-MM-DD')
  function onView() {
    if (!draft.from || !draft.to) return
    if (dayjs(draft.to).isBefore(dayjs(draft.from), 'day')) return
    setRange({ from: dayjs(draft.from).startOf('day'), to: dayjs(draft.to).startOf('day') })
  }
  const today = dayjs().format('YYYY-MM-DD')

  const { data: halls, isLoading: hallsLoading } = useQuery({ queryKey: ['halls'], queryFn: hallApi.listHalls })

  const availabilityQueries = useQueries({
    queries: (halls || []).map((h) => ({
      queryKey: ['hall-availability', h.HALLID, monthStart, rangeEnd],
      queryFn: () => hallApi.getAvailability(h.HALLID, monthStart, 1, rangeEnd),
      enabled: Boolean(halls),
    })),
  })
  const loading = hallsLoading || availabilityQueries.some((q) => q.isLoading)

  const dayCount = Math.min(Math.max(range.to.diff(range.from, 'day') + 1, 1), 366)
  const days = Array.from({ length: dayCount }, (_, i) => range.from.add(i, 'day'))

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
  const todayInRange = !dayjs(today).isBefore(range.from, 'day') && !dayjs(today).isAfter(range.to, 'day')
  const fmt = (iso) => dayjs(iso).format('DD/MM/YYYY')
  function onExport() {
    const head = ['Date', ...rows.map((r) => r.hall.HALLNAME)]
    const lines = days.map((d) => [fmt(d.format('YYYY-MM-DD')), ...rows.map((r) => (r.byDay[d.format('YYYY-MM-DD')] ? `Booked ${r.byDay[d.format('YYYY-MM-DD')].PrintHBNO || ''}`.trim() : ''))])
    downloadXls(`hall-status-${monthStart}-to-${rangeEnd}.xls`, lines, head.map((label, i) => ({ label, value: (r) => r[i] })))
  }

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
        <Group gap="xs" align="flex-end" wrap="wrap">
          <DateInput label="From" valueFormat="DD/MM/YYYY" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} w={150} />
          <DateInput label="To" valueFormat="DD/MM/YYYY" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} w={150} minDate={draft.from || undefined} />
          <Button color="kumkum" leftSection={<Search size={16} />} onClick={onView}>
            View
          </Button>
          <Button variant="default" leftSection={<FileDown size={16} />} disabled={loading || hallCount === 0} onClick={onExport}>
            Export to Excel
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        <StatCard label="Halls" value={hallCount} icon={Building} footer="Configured halls and rooms" loading={hallsLoading} />
        <StatCard label="Booked hall-days" value={bookedDays} icon={CalendarCheck} tone="dark" footer={`${fmt(monthStart)} to ${fmt(rangeEnd)}`} loading={loading} />
        <StatCard label="Booked today" value={todayInRange ? bookedToday : '-'} icon={DoorOpen} footer={todayInRange ? `${Math.max(hallCount - bookedToday, 0)} free today` : 'Today is outside this range'} loading={loading} />
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
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--vt-surface)', border: '1px solid var(--vt-line)', display: 'inline-block' }} />
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
          <Table.ScrollContainer minWidth={520} mah={560}>
            <Table withColumnBorders stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ background: 'var(--vt-gold-chip)', width: 130 }}>Date</Table.Th>
                  {rows.map(({ hall }) => (
                    <Table.Th key={hall.HALLID} style={{ background: 'var(--vt-gold-chip)', textAlign: 'center' }}>
                      {hall.HALLNAME}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {days.map((d) => {
                  const iso = d.format('YYYY-MM-DD')
                  const isToday = iso === today
                  return (
                    <Table.Tr key={iso}>
                      <Table.Td className="vt-num" style={{ fontWeight: 600, background: isToday ? 'var(--vt-gold-chip)' : undefined }}>
                        {fmt(iso)} <Text span size="xs" c="dimmed">{d.format('ddd')}</Text>
                      </Table.Td>
                      {rows.map(({ hall, byDay }) => {
                        const booking = byDay[iso]
                        return booking ? (
                          <Tooltip key={hall.HALLID} label={`${booking.PrintHBNO || ''}${booking.NMEOFFUNC ? ` \u00b7 ${booking.NMEOFFUNC}` : ''}`} withArrow>
                            <Table.Td aria-label={`${hall.HALLNAME}, ${fmt(iso)}: booked ${booking.PrintHBNO || ''}`} style={{ textAlign: 'center', background: BOOKED, color: '#FBF6EC', fontWeight: 600 }}>
                              Booked
                            </Table.Td>
                          </Tooltip>
                        ) : (
                          <Table.Td key={hall.HALLID} style={{ background: isToday ? 'var(--vt-gold-chip)' : undefined }} />
                        )
                      })}
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <SectionCard title="Bookings in this range" hint="The same bookings as a list, with their dates.">
        {loading ? (
          <Skeleton height={60} radius="md" />
        ) : bookings.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No bookings in this range" hint="Bookings made in Hall Booking will show up here." />
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
