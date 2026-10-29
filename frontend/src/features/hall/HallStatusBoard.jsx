import { useMemo, useState } from 'react'
import { Button, Card, Group, Select, SimpleGrid, Skeleton, Stack, Table, Text, Title } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { Building, CalendarCheck, CalendarDays, DoorOpen, FileDown, Search } from 'lucide-react'
import { useQueries, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { isoDate } from '../../utils/format'
import * as hallApi from '../../api/endpoints/hall'
import StatCard from '../../components/ui/StatCard'
import EmptyState from '../../components/ui/EmptyState'
import { downloadXls } from '../../utils/xls'
import { SectionCard } from '../../components/ui/EntryParts'
import { BOOKED, Legend, Month, PARTIAL } from './HallCalendarBox'

/**
 * Legacy Hall Status report (frmRptRoomStatus): grid of halls x days. Booked cells are maroon, today's column is gold.
 * Shared by the Hall Status screen and the collapsible panel on Hall Booking. `headerLeft` is drawn at the left of the
 * date controls; `compact` drops the summary cards and the bookings list and shortens the grid.
 */
export default function HallStatusBoard({ headerLeft = null, compact = false }) {
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
  const [hallSel, setHallSel] = useState('all')
  // calendar view: day -> bookings of the halls in view, and one grid per month of the range
  const calByDay = useMemo(() => {
    const out = {}
    rows.forEach(({ hall, byDay }) => {
      if (hallSel !== 'all' && String(hall.HALLID) !== hallSel) return
      Object.entries(byDay).forEach(([iso, b]) => (out[iso] ||= []).push({ hall: hall.HALLNAME, no: b.PrintHBNO, func: b.NMEOFFUNC }))
    })
    return out
  }, [rows, hallSel])
  const hallsInView = hallSel === 'all' ? hallCount : 1
  const calMonths = []
  for (let m = range.from.startOf('month'); !m.isAfter(range.to, 'month') && calMonths.length < 24; m = m.add(1, 'month')) calMonths.push(m)
  const todayInRange = !dayjs(today).isBefore(range.from, 'day') && !dayjs(today).isAfter(range.to, 'day')
  const fmt = (iso) => dayjs(iso).format('DD-MMM-YYYY')
  function onExport() {
    const head = ['Date', ...rows.map((r) => r.hall.HALLNAME)]
    const lines = days.map((d) => [fmt(d.format('YYYY-MM-DD')), ...rows.map((r) => (r.byDay[d.format('YYYY-MM-DD')] ? `Booked ${r.byDay[d.format('YYYY-MM-DD')].PrintHBNO || ''}`.trim() : ''))])
    downloadXls(`hall-status-${monthStart}-to-${rangeEnd}.xls`, lines, head.map((label, i) => ({ label, value: (r) => r[i] })))
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        {headerLeft || <span />}
        <Group gap="xs" align="flex-end" wrap="wrap">
          <DateInput label="From" valueFormat="DD-MMM-YYYY" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} w={150} />
          <DateInput label="To" valueFormat="DD-MMM-YYYY" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} w={150} minDate={draft.from || undefined} />
          <Button color="kumkum" leftSection={<Search size={16} />} onClick={onView}>
            View
          </Button>
          <Button variant="default" leftSection={<FileDown size={16} />} disabled={loading || hallCount === 0} onClick={onExport}>
            Export to Excel
          </Button>
        </Group>
      </Group>

      {!compact && (
      <SimpleGrid cols={{ base: 1, xs: 3 }}>
        <StatCard label="Halls" value={hallCount} icon={Building} footer="Configured halls and rooms" loading={hallsLoading} />
        <StatCard label="Booked hall-days" value={bookedDays} icon={CalendarCheck} tone="dark" footer={`${fmt(monthStart)} to ${fmt(rangeEnd)}`} loading={loading} />
        <StatCard label="Booked today" value={todayInRange ? bookedToday : '-'} icon={DoorOpen} footer={todayInRange ? `${Math.max(hallCount - bookedToday, 0)} free today` : 'Today is outside this range'} loading={loading} />
      </SimpleGrid>
      )}

      <Card withBorder p="lg">
        <Group justify="space-between" align="center" mb="sm" wrap="wrap" gap="xs">
          <Title order={4}>Occupancy</Title>
          <Group gap="md" wrap="wrap">
            <Select
              aria-label="Hall"
              size="xs"
              w={190}
              allowDeselect={false}
              data={[{ value: 'all', label: 'All halls' }, ...(halls || []).map((h) => ({ value: String(h.HALLID), label: h.HALLNAME }))]}
              value={hallSel}
              onChange={(v) => setHallSel(v || 'all')}
            />
            <Legend color={BOOKED} label={hallSel === 'all' && hallsInView > 1 ? 'All halls booked' : 'Booked'} />
            <Legend color={PARTIAL} label="Some halls booked, others free" hide={hallSel !== 'all' || hallsInView < 2} />
            <Legend color="var(--vt-surface)" border="1px solid var(--vt-line)" label="Available" />
            <Legend color="var(--mantine-color-gold-1)" border="1px solid var(--mantine-color-gold-5)" label="Today" />
          </Group>
        </Group>

        {loading ? (
          <Skeleton height={260} radius="md" />
        ) : hallCount === 0 ? (
          <EmptyState icon={Building} title="No halls configured" hint="Add halls in the Hall master and they will appear here." />
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: compact ? 2 : 3 }} spacing="lg">
            {calMonths.map((m) => (
              <Month key={m.format('YYYY-MM')} month={m} today={dayjs().startOf('day')} byDay={calByDay} hallsInView={hallsInView} rangeFrom={range.from} rangeTo={range.to} dimPast={false} />
            ))}
          </SimpleGrid>
        )}
      </Card>

      {!compact && (
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
      )}
    </Stack>
  )
}
