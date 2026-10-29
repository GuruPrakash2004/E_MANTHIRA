import { useMemo, useRef, useState } from 'react'
import { ActionIcon, Card, Group, Select, Skeleton, Stack, Text, Tooltip } from '@mantine/core'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useQueries, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as hallApi from '../../api/endpoints/hall'

export const BOOKED = 'var(--mantine-color-kumkum-7)'
export const PARTIAL = 'var(--mantine-color-kumkum-2)'
const MONTHS = 6 // the slider covers this month and the five after it
const ALL = 'all'

/**
 * Hall calendar for the Hall Booking screen: a slider over the next six months from today, one full-size month at a time
 * (arrows, dots, swipe or the left / right keys). A booked day is
 * flagged (maroon) and its tooltip lists the booking(s); every other day from today on is available. Pick one hall or
 * "All halls" (a day is dark maroon when every hall is booked, light maroon when only some are). Same data as the Hall Status
 * report (`GET /halls/{id}/availability`), so it always matches it.
 */
export default function HallCalendarBox() {
  const [hallSel, setHallSel] = useState(ALL)
  const [idx, setIdx] = useState(0) // which month the slider shows
  const touch = useRef(null)
  const today = dayjs().startOf('day')
  const from = today.format('YYYY-MM-DD')
  const to = today.add(MONTHS - 1, 'month').endOf('month').format('YYYY-MM-DD')

  const { data: halls, isLoading: hallsLoading } = useQuery({ queryKey: ['halls'], queryFn: hallApi.listHalls })
  const availability = useQueries({
    queries: (halls || []).map((h) => ({
      queryKey: ['hall-availability', h.HALLID, from, to],
      queryFn: () => hallApi.getAvailability(h.HALLID, from, 1, to),
      enabled: Boolean(halls),
      staleTime: 30_000,
    })),
  })
  const loading = hallsLoading || availability.some((q) => q.isLoading)
  const stamp = availability.map((q) => q.dataUpdatedAt).join(',')

  // iso day -> [{ hall, no, func }] for the halls in view
  const byDay = useMemo(() => {
    const out = {}
    ;(halls || []).forEach((h, i) => {
      if (hallSel !== ALL && String(h.HALLID) !== hallSel) return
      for (const row of availability[i]?.data || []) {
        const iso = dayjs(row.STAYDATE).format('YYYY-MM-DD')
        ;(out[iso] ||= []).push({ hall: h.HALLNAME, no: row.PrintHBNO, func: row.NMEOFFUNC })
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halls, hallSel, stamp])

  const hallsInView = hallSel === ALL ? (halls || []).length : 1
  const months = Array.from({ length: MONTHS }, (_, i) => today.add(i, 'month').startOf('month'))
  const bookedCount = Object.keys(byDay).filter((d) => d >= from).length
  const go = (n) => setIdx((i) => Math.min(MONTHS - 1, Math.max(0, i + n)))

  return (
    <Card withBorder p="sm" className="vt-hall-cal" aria-label="Hall calendar">
      <Group justify="space-between" align="center" wrap="nowrap" mb={6}>
        <Group gap={6} wrap="nowrap">
          <CalendarCheck size={18} aria-hidden />
          <Text fw={700} size="sm" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Hall calendar</Text>
        </Group>
        <Select
          aria-label="Hall"
          size="xs"
          w={170}
          allowDeselect={false}
          data={[{ value: ALL, label: 'All halls' }, ...(halls || []).map((h) => ({ value: String(h.HALLID), label: h.HALLNAME }))]}
          value={hallSel}
          onChange={(v) => setHallSel(v || ALL)}
        />
      </Group>
      <Group gap="sm" mb={6} wrap="wrap">
        <Legend color={BOOKED} label={hallSel === ALL && hallsInView > 1 ? 'All halls booked' : 'Booked'} />
        <Legend color={PARTIAL} label="Some halls booked, others free" hide={hallSel !== ALL || hallsInView < 2} />
        <Legend color="var(--vt-surface)" border="1px solid var(--vt-line)" label="Available" />
        <Legend color="var(--mantine-color-gold-1)" border="1px solid var(--mantine-color-gold-5)" label="Today" />
        <Text size="xs" c="dimmed" ml="auto">{loading ? '' : `${bookedCount} booked day${bookedCount === 1 ? '' : 's'}`}</Text>
      </Group>

      {loading ? (
        <Skeleton height={300} radius="md" />
      ) : (
        <div
          role="group"
          aria-roledescription="carousel"
          aria-label="Months"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) } }}
          onTouchStart={(e) => { touch.current = e.touches[0].clientX }}
          onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1) }}
          style={{ outline: 'none' }}
        >
          <Group justify="space-between" align="center" mb={6} wrap="nowrap">
            <ActionIcon variant="light" color="kumkum" aria-label="Previous month" disabled={idx === 0} onClick={() => go(-1)}><ChevronLeft size={18} /></ActionIcon>
            <Text fw={700} tt="uppercase" size="sm" style={{ letterSpacing: 0.6, color: 'var(--vt-accent)' }} aria-live="polite">{months[idx].format('MMMM YYYY')}</Text>
            <ActionIcon variant="light" color="kumkum" aria-label="Next month" disabled={idx === MONTHS - 1} onClick={() => go(1)}><ChevronRight size={18} /></ActionIcon>
          </Group>
          {/* the six months sit side by side and slide */}
          <div style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', width: `${MONTHS * 100}%`, transform: `translateX(-${(idx * 100) / MONTHS}%)`, transition: 'transform 280ms ease' }}>
              {months.map((m, i) => (
                <div key={m.format('YYYY-MM')} style={{ width: `${100 / MONTHS}%`, padding: '0 2px' }} aria-hidden={i !== idx}>
                  <Month month={m} today={today} byDay={byDay} hallsInView={hallsInView} hideTitle />
                </div>
              ))}
            </div>
          </div>
          <Group justify="center" gap={8} mt={10}>
            {months.map((m, i) => (
              <button
                key={m.format('YYYY-MM')}
                type="button"
                aria-label={`Show ${m.format('MMMM YYYY')}`}
                aria-current={i === idx}
                onClick={() => setIdx(i)}
                style={{ width: i === idx ? 22 : 8, height: 8, borderRadius: 999, border: 0, padding: 0, cursor: 'pointer', background: i === idx ? 'var(--vt-accent)' : 'var(--vt-line)', transition: 'width 200ms ease' }}
              />
            ))}
          </Group>
        </div>
      )}
    </Card>
  )
}

export function Legend({ color, border, label, hide }) {
  if (hide) return null
  return (
    <Group gap={5} wrap="nowrap">
      <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: color, border, display: 'inline-block' }} />
      <Text size="xs">{label}</Text>
    </Group>
  )
}

export function Month({ month, today, byDay, hallsInView, rangeFrom, rangeTo, dimPast = true, compact = false, hideTitle = false }) {
  const lead = month.day() // Sunday first
  const days = month.daysInMonth()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => month.add(i, 'day'))]
  return (
    <div>
      {!hideTitle && <Text size="xs" fw={700} tt="uppercase" mb={4} style={{ letterSpacing: 0.6, color: 'var(--vt-accent)' }}>{month.format('MMMM YYYY')}</Text>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: compact ? 2 : 3 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <Text key={i} size="10px" c="dimmed" ta="center">{w}</Text>
        ))}
        {cells.map((d, i) => (d ? <Day key={i} d={d} today={today} bookings={byDay[d.format('YYYY-MM-DD')]} hallsInView={hallsInView} dimPast={dimPast} compact={compact} outside={(rangeFrom && d.isBefore(rangeFrom, 'day')) || (rangeTo && d.isAfter(rangeTo, 'day'))} /> : <span key={i} />))}
      </div>
    </div>
  )
}

function Day({ d, today, bookings, hallsInView, outside, dimPast, compact }) {
  const h = compact ? 22 : 32
  const fs = compact ? 11 : 12
  if (outside) return <div style={{ height: h, display: 'grid', placeItems: 'center', fontSize: fs, opacity: 0.25 }} aria-hidden>{d.date()}</div>
  const past = dimPast && d.isBefore(today, 'day')
  const isToday = d.isSame(today, 'day')
  const booked = bookings && bookings.length > 0
  const full = booked && bookings.length >= hallsInView
  const base = {
    height: h,
    borderRadius: compact ? 5 : 6,
    display: 'grid',
    placeItems: 'center',
    fontSize: fs,
    position: 'relative',
    opacity: past ? 0.4 : 1,
    border: '1px solid var(--vt-line)',
    background: isToday ? 'var(--mantine-color-gold-1)' : 'var(--vt-surface)',
    color: 'inherit',
  }
  if (!booked) return <div style={base} aria-label={`${d.format('DD-MMM-YYYY')} available`}>{d.date()}</div>
  const style = full
    ? { ...base, background: BOOKED, color: '#FBF6EC', fontWeight: 700, border: `1px solid ${BOOKED}` }
    : { ...base, background: PARTIAL, color: 'var(--mantine-color-kumkum-9)', fontWeight: 700, border: `1px solid ${PARTIAL}` }
  const label = (
    <Stack gap={2}>
      <Text size="xs" fw={700}>{d.format('DD-MMM-YYYY ddd')}</Text>
      {bookings.map((b, i) => (
        <Text key={i} size="xs">{`${b.hall}: ${b.no || ''}${b.func ? ` · ${b.func}` : ''}`}</Text>
      ))}
    </Stack>
  )
  return (
    <Tooltip label={label} withArrow multiline maw={260}>
      <div style={style} aria-label={`${d.format('DD-MMM-YYYY')} booked`}>
        {d.date()}
      </div>
    </Tooltip>
  )
}
