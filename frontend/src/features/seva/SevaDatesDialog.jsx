import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Button, Chip, Group, Modal, ScrollArea, Select, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import dayjs from 'dayjs'
import * as panchangaApi from '../../api/endpoints/panchanga'
import { isoDate } from '../../utils/format'

import { PanchangaSymbol } from '../panchanga/symbols'

const SU_FIRST = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const DAY_FLAGS = [['mon', 'All Mondays', 1], ['tue', 'All Tuesdays', 2], ['wed', 'All Wednesdays', 3], ['thu', 'All Thursdays', 4], ['fri', 'All Fridays', 5], ['sat', 'All Saturdays', 6], ['sun', 'All Sundays', 0]]
const ASSORTED = 'Assorted Dates'
const fmt = (iso) => dayjs(iso).format('DD/MM/YYYY')
const fmtShort = (iso) => dayjs(iso).format('DD/MM/YY')

/**
 * Multiple Seva Dates Selection (legacy frmUtlGSevaDates), opened from the seva entry's date selection button.
 * Top: a year calendar, one card per month (today gold, Sundays maroon, Panchanga days carry their temple symbol);
 * click a day to add or remove it. Left: the chosen dates with remarks, Date Text, Clear All / Replace Rest. Middle: the
 * Panchanga events of the month you are on. Right: date range with weekday ticks, next month / year, days / weeks, and the
 * dates that carry a Panchanga detail. OK hands the dates and the Date Text back to the entry.
 */
export default function SevaDatesDialog({ opened, onClose, dates, dateText, onApply }) {
  const today = dayjs().startOf('day')
  const [list, setList] = useState([])
  const [text, setText] = useState('')
  const [year, setYear] = useState(today.year())
  const [sel, setSel] = useState(null)
  const [monthOf, setMonthOf] = useState(today.format('YYYY-MM'))
  const [from, setFrom] = useState(today.toDate())
  const [to, setTo] = useState(today.endOf('month').toDate())
  const [flags, setFlags] = useState({ days: false, mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false })
  const [nos, setNos] = useState('')
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    if (!opened) return
    // starts empty: only the dates picked in this dialog are listed (OK replaces the entry's dates with them)
    setList([])
    setText('')
    setYear(today.year())
    setSel(null)
    setMonthOf(today.format('YYYY-MM'))
    setFrom(today.toDate())
    setTo(today.endOf('month').toDate())
    setFlags({ days: false, mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false })
    setNos('')
    setDetail(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened])

  // Panchanga of the whole year on the calendar, straight from MstPanch (+ the event colours of MstEvent)
  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ['panchanga', 'year', year],
    queryFn: () => panchangaApi.listPanchanga(`${year}-01-01`, `${year}-12-31`),
    enabled: opened,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  const eventOf = useMemo(() => Object.fromEntries(events.filter((e) => e.name).map((e) => [e.date, e])), [events])
  const monthEvents = events.filter((e) => e.name && e.date.startsWith(monthOf))

  // the year grid starts at the current month in the current year, January otherwise
  const months = useMemo(() => {
    const start = year === today.year() ? today.month() : 0
    return Array.from({ length: 12 - start }, (_, i) => dayjs(new Date(year, start + i, 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  const have = new Set(list.map((d) => d.perform_date))
  const sorted = (rows) => rows // the legacy list keeps the order dates were added in

  function addMany(isoList, newText) {
    const fresh = isoList.filter((iso, i) => !have.has(iso) && isoList.indexOf(iso) === i)
    if (fresh.length < isoList.length) notifications.show({ message: 'Dates already in the list were skipped', color: 'yellow' })
    setList((l) => [...l, ...fresh.map((iso) => ({ perform_date: iso, remarks: '' }))])
    if (newText !== undefined) setText(newText)
    return fresh.length
  }
  function replaceAll(isoList, newText) {
    setList(isoList.map((iso) => ({ perform_date: iso, remarks: '' })))
    setText(newText)
    setSel(null)
  }
  const lastIso = () => list[list.length - 1]?.perform_date

  // click a day to add it, click again to take it out (the EXE added on double-click)
  function toggleDay(iso) {
    if (have.has(iso)) {
      setList((l) => l.filter((d) => d.perform_date !== iso))
      setText(ASSORTED)
      setSel(null)
    } else {
      addMany([iso], ASSORTED)
    }
  }
  function onApplyRange() {
    if (dayjs(to).isBefore(dayjs(from), 'day')) return notifications.show({ message: 'Invalid date Range!', color: 'red' })
    const f = dayjs(from).startOf('day')
    const t = dayjs(to).startOf('day')
    let label = `${f.format('DD/MM/YY')} - ${t.format('DD/MM/YY')}`
    for (const [k, , dow] of [['days', '', -1], ...DAY_FLAGS]) {
      if (flags[k]) label += ` [All ${k === 'days' ? 'Days' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}]`
    }
    const out = []
    for (let d = f; !d.isAfter(t, 'day') && out.length < 1000; d = d.add(1, 'day')) {
      if (flags.days || DAY_FLAGS.some(([k, , dow]) => flags[k] && d.day() === dow)) out.push(d.format('YYYY-MM-DD'))
    }
    replaceAll(out, label)
  }
  function toggleFlag(k, v) {
    setFlags((cur) => (k === 'days' ? (v ? { days: true, mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false } : { ...cur, days: false }) : { ...cur, [k]: v, days: v ? false : cur.days }))
  }
  function addNext(unit) {
    const last = lastIso()
    if (!last) return notifications.show({ message: 'Please select at least One Date...', color: 'yellow' })
    addMany([dayjs(last).add(1, unit).format('YYYY-MM-DD')])
  }
  function addDays() {
    const n = Number(nos)
    if (!(n > 0)) return notifications.show({ message: 'Please enter the number of days to add!', color: 'yellow' })
    const start = lastIso() || today.format('YYYY-MM-DD')
    const out = Array.from({ length: n }, (_, i) => dayjs(start).add(i, 'day').format('YYYY-MM-DD'))
    replaceAll(out, `${fmtShort(start)} - ${fmtShort(out[out.length - 1])}`)
  }
  function addWeeks() {
    const n = Number(nos)
    if (!(n > 0)) return notifications.show({ message: 'Please enter the number of Weeks to add!', color: 'yellow' })
    const start = lastIso()
    if (!start) return notifications.show({ message: 'Please select at least one date to Start....', color: 'red' })
    const out = Array.from({ length: n }, (_, i) => dayjs(start).add(i * 7, 'day').format('YYYY-MM-DD'))
    replaceAll(out, `${fmtShort(start)} to ${fmtShort(out[out.length - 1])} - ${dayjs(out[out.length - 1]).format('ddd')}`)
  }

  // "Select Dates Having Details": the Panchanga names inside From - To, and every date with that name
  const { data: rangeEvents = [] } = useQuery({
    queryKey: ['panchanga', 'range', isoDate(from), isoDate(to)],
    queryFn: () => panchangaApi.listPanchanga(isoDate(from), isoDate(to)),
    enabled: opened && Boolean(from && to) && !dayjs(to).isBefore(dayjs(from), 'day'),
    staleTime: 60_000,
  })
  const names = [...new Set(rangeEvents.filter((e) => e.name).map((e) => e.name))]
  async function selectDetailFromToday() {
    if (!detail) return notifications.show({ message: 'Please select the detals from the drop down given...', color: 'yellow' })
    const rows = await panchangaApi.listPanchanga(today.format('YYYY-MM-DD'), today.add(5, 'year').format('YYYY-MM-DD'))
    addMany(rows.filter((r) => r.name === detail).map((r) => r.date), ASSORTED)
  }
  function addDaysWithDetail() {
    if (!detail) return notifications.show({ message: 'Please enter the detail text!', color: 'yellow' })
    const rows = rangeEvents.filter((r) => r.name === detail).map((r) => r.date)
    const fresh = rows.filter((iso) => !have.has(iso))
    if (fresh.length) addMany(fresh, detail)
  }

  function replaceRest() {
    if (sel === null) return
    const value = list[sel]?.remarks || ''
    setList((l) => l.map((d, i) => (i >= sel ? { ...d, remarks: value } : d)))
  }
  function ok() {
    if (list.length === 0) return notifications.show({ message: 'Please add at least one date!!', color: 'red' })
    for (let i = 0; i < list.length; i++) {
      if (!list[i].perform_date) continue
      if (dayjs(list[i].perform_date).isBefore(today, 'day')) return notifications.show({ message: `Date cannot be Less than ${today.format('DD/MM/YYYY')}`, color: 'red' })
      if (list.findIndex((d) => d.perform_date === list[i].perform_date) !== i) return notifications.show({ message: `Duplicate date ${fmt(list[i].perform_date)}`, color: 'red' })
    }
    const finalText = text === ASSORTED ? list.map((d) => `${fmt(d.perform_date)};`).join('').slice(0, 250) : text
    onApply({ dates: [...list].sort((a, b) => a.perform_date.localeCompare(b.perform_date)), daysText: finalText })
    onClose()
  }

  const todayIso = today.format('YYYY-MM-DD')

  // a day on the calendar: Panchanga days carry their temple symbol instead of a colour
  function dayCell(iso, m) {
    const ev = eventOf[iso]
    const chosen = have.has(iso)
    const isToday = iso === todayIso
    const past = dayjs(iso).isBefore(today, 'day')
    const sun = dayjs(iso).day() === 0
    return (
      <button
        key={iso}
        type="button"
        className={`vt-sd-day${chosen ? ' on' : ''}${isToday ? ' today' : ''}${sun ? ' sun' : ''}${past ? ' past' : ''}`}
        title={ev ? `${dayjs(iso).format('DD MMM YYYY')}: ${ev.name}` : dayjs(iso).format('DD MMM YYYY')}
        aria-label={`${dayjs(iso).format('dddd, D MMMM YYYY')}${ev ? `, ${ev.name}` : ''}${chosen ? ', selected' : ''}`}
        aria-pressed={chosen}
        onMouseEnter={() => setMonthOf(m.format('YYYY-MM'))}
        onClick={() => { setMonthOf(m.format('YYYY-MM')); toggleDay(iso) }}
      >
        <span className="vt-num">{dayjs(iso).date()}</span>
        {ev && <span className="vt-sd-sym"><PanchangaSymbol name={ev.names?.[0] || ev.name} size={15} /></span>}
      </button>
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} size="min(1240px, 98vw)" radius="lg" padding={0} withCloseButton={false} centered
      // a fixed-height column: header and the OK / Close bar stay put, only the middle scrolls
      styles={{
        content: { maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        body: { background: 'var(--vt-surface)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
      }}>
      <div className="vt-sd">
        <header className="vt-sd-head">
          <div>
            <Text className="vt-sd-title">Multiple Seva Dates Selection</Text>
            <Text size="xs" c="#E9D2B8">Click a day to add or remove it. Days with a symbol are Panchanga days.</Text>
          </div>
          <Group gap={6} wrap="nowrap">
            <Button size="compact-sm" variant="default" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>{'<<'}</Button>
            <TextInput aria-label="Year" w={78} value={year} onChange={(e) => { const v = Number(e.currentTarget.value); if (v > 1900 && v < 2200) setYear(v) }} styles={{ input: { textAlign: 'center', fontWeight: 700 } }} />
            <Button size="compact-sm" variant="default" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>{'>>'}</Button>
            <ActionIcon variant="subtle" color="gold" size="lg" aria-label="Close" onClick={onClose}><X size={20} color="#F4E1A6" /></ActionIcon>
          </Group>
        </header>

        <div className="vt-sd-body">
          <ScrollArea h={290} type="auto" className="vt-sd-cal">
            <div className="vt-sd-months">
              {months.map((m) => {
                const lead = m.day()
                const dim = m.daysInMonth()
                return (
                  <section key={m.format('YYYY-MM')} className={`vt-sd-month${monthOf === m.format('YYYY-MM') ? ' cur' : ''}`} aria-label={m.format('MMMM YYYY')}>
                    <div className="vt-sd-mtitle">{m.format('MMMM')} <span>{m.format('YYYY')}</span></div>
                    <div className="vt-sd-grid">
                      {SU_FIRST.map((w) => <span key={w} className="vt-sd-wd">{w}</span>)}
                      {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
                      {Array.from({ length: dim }, (_, i) => dayCell(m.date(i + 1).format('YYYY-MM-DD'), m))}
                    </div>
                  </section>
                )
              })}
            </div>
          </ScrollArea>

          <div className="vt-sd-panels">
            {/* chosen dates */}
            <section className="vt-sd-card">
              <Group justify="space-between" mb={6}>
                <Text className="vt-sd-h">Selected dates <span>({list.length})</span></Text>
                <Group gap={6}>
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => { setList([]); setText(''); setSel(null) }}>Clear All</Button>
                  <Button size="compact-xs" variant="subtle" color="kumkum" disabled={sel === null} onClick={replaceRest}>Replace Rest</Button>
                </Group>
              </Group>
              <TextInput size="xs" label="Date Text" description="Printed on the receipt" value={text} maxLength={250} onChange={(e) => setText(e.currentTarget.value)} mb={6} />
              <ScrollArea h={170} type="auto">
                {list.length === 0 ? <Text size="sm" c="dimmed" p="xs">No dates yet. Click a day on the calendar or use the tools.</Text> : (
                  <Stack gap={4}>
                    {list.map((d, i) => (
                      <div key={i} className={`vt-sd-row${sel === i ? ' sel' : ''}`} onClick={() => setSel(i)}>
                        <DateInput size="xs" aria-label={`Date ${i + 1}`} valueFormat="DD/MM/YYYY" w={118} value={d.perform_date ? dayjs(d.perform_date).toDate() : null} onChange={(v) => { if (v) { setList((l) => l.map((x, xi) => (xi === i ? { ...x, perform_date: isoDate(v) } : x))); setText(ASSORTED) } }} />
                        <span className="vt-sd-rowsym">{eventOf[d.perform_date] ? <PanchangaSymbol name={eventOf[d.perform_date].names?.[0] || eventOf[d.perform_date].name} size={20} /> : null}</span>
                        <TextInput size="xs" aria-label={`Remarks ${i + 1}`} placeholder="Remarks" style={{ flex: 1 }} value={d.remarks} onFocus={() => setSel(i)} onChange={(e) => { const v = e.currentTarget.value; setList((l) => l.map((x, xi) => (xi === i ? { ...x, remarks: v } : x))) }} />
                        <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Remove date ${i + 1}`} onClick={(e) => { e.stopPropagation(); setList((l) => l.filter((_, xi) => xi !== i)); setText(ASSORTED); setSel(null) }}><X size={14} /></ActionIcon>
                      </div>
                    ))}
                  </Stack>
                )}
              </ScrollArea>
            </section>

            {/* panchanga of the month */}
            <section className="vt-sd-card">
              <Group justify="space-between" mb={6}>
                <Text className="vt-sd-h">Panchanga <span>{dayjs(`${monthOf}-01`).format('MMMM YYYY')}</span></Text>
                <Button size="compact-xs" variant="light" color="kumkum" leftSection={<Plus size={12} />} onClick={() => { window.open('/panchanga', '_blank'); notifications.show({ message: 'Add the Panchanga day in the new tab, then come back: the calendar refreshes by itself.', color: 'teal' }); setTimeout(refetchEvents, 1000) }}>Panchanga</Button>
              </Group>
              <ScrollArea h={222} type="auto">
                {monthEvents.length === 0 ? <Text size="sm" c="dimmed" p="xs">No Panchanga days this month.</Text> : (
                  <Stack gap={4}>
                    {monthEvents.map((e) => (
                      <button type="button" key={e.date} className={`vt-sd-ev${have.has(e.date) ? ' on' : ''}`} onClick={() => toggleDay(e.date, true)} title="Click to add or remove this date">
                        <PanchangaSymbol name={e.names?.[0] || e.name} size={30} />
                        <span className="vt-sd-evt"><b>{e.name}</b><em>{dayjs(e.date).format('ddd, DD MMM YYYY')}</em></span>
                      </button>
                    ))}
                  </Stack>
                )}
              </ScrollArea>
            </section>

            {/* tools */}
            <section className="vt-sd-card">
              <Text className="vt-sd-h" mb={6}>Add dates</Text>
              <Group align="flex-end" gap={6} wrap="nowrap">
                <DateInput size="xs" label="From" valueFormat="DD/MM/YYYY" value={from} onChange={(v) => v && setFrom(v)} w={118} />
                <DateInput size="xs" label="To" valueFormat="DD/MM/YYYY" value={to} onChange={(v) => v && setTo(v)} w={118} />
                <Button size="xs" color="kumkum" onClick={onApplyRange}>Apply</Button>
              </Group>
              <Group gap={4} mt={8} wrap="wrap">
                <Chip.Group multiple value={['days', ...DAY_FLAGS.map(([k]) => k)].filter((k) => flags[k])} onChange={(vals) => { const next = new Set(vals); const had = new Set(['days', ...DAY_FLAGS.map(([k]) => k)].filter((k) => flags[k])); const added = [...next].find((k) => !had.has(k)); const removed = [...had].find((k) => !next.has(k)); if (added) toggleFlag(added, true); else if (removed) toggleFlag(removed, false) }}>
                  <Chip value="days" size="xs" color="kumkum" variant="light">All Days</Chip>
                  {DAY_FLAGS.map(([k, label]) => <Chip key={k} value={k} size="xs" color="kumkum" variant="light">{label.replace('All ', '')}</Chip>)}
                </Chip.Group>
              </Group>
              <div className="vt-sd-sep" />
              <Group gap={6} wrap="wrap">
                <Button size="compact-xs" variant="default" onClick={() => addNext('month')}>Add Next Month Date</Button>
                <Button size="compact-xs" variant="default" onClick={() => addNext('year')}>Add Next Year Date</Button>
              </Group>
              <Group gap={6} mt={6} align="flex-end" wrap="nowrap">
                <TextInput size="xs" label="No Of Days" w={72} value={nos} onChange={(e) => setNos(e.currentTarget.value.replace(/\D/g, ''))} />
                <Button size="compact-xs" variant="default" onClick={addDays}>{nos ? `Add ${nos} Day(s)` : 'Add Days'}</Button>
                <Button size="compact-xs" variant="default" onClick={addWeeks}>{nos ? `Add ${nos} Week(s)` : 'Add Weeks'}</Button>
              </Group>
              <div className="vt-sd-sep" />
              <Select size="xs" label="Dates having details" aria-label="Panchanga detail" searchable clearable data={names} value={detail} onChange={setDetail} placeholder="Within From - To" />
              <Group gap={6} mt={6}>
                <Button size="compact-xs" variant="default" onClick={selectDetailFromToday}>Select Dates Having Details</Button>
                <Button size="compact-xs" variant="default" onClick={addDaysWithDetail}>Add Days (with above Dtl)</Button>
              </Group>
            </section>
          </div>
        </div>

        <footer className="vt-sd-foot">
          <Text size="xs" c="dimmed">{list.length} date{list.length === 1 ? '' : 's'} selected</Text>
          <Group>
            <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>Close</Button>
            <Button color="kumkum" leftSection={<Check size={16} />} onClick={ok}>OK</Button>
          </Group>
        </footer>
      </div>
      <style>{CSS}</style>
    </Modal>
  )
}

const CSS = `
.vt-sd { display:flex; flex-direction:column; flex:1; min-height:0; }
.vt-sd-head { flex:0 0 auto; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 18px; background:linear-gradient(160deg,var(--vt-g1),var(--vt-g3)); color:#FBF6EC; border-radius:var(--mantine-radius-lg) var(--mantine-radius-lg) 0 0; flex-wrap:wrap; }
.vt-sd-title { font-family:Marcellus,Georgia,serif; font-size:20px; color:#F4E1A6; }
.vt-sd-body { flex:1 1 auto; min-height:0; overflow-y:auto; padding:14px 18px 10px; display:flex; flex-direction:column; gap:12px; }
.vt-sd-cal { border:1px solid var(--vt-line); border-radius:12px; background:var(--vt-sandal); }
.vt-sd-months { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; padding:10px; }
.vt-sd-month { background:var(--vt-surface); border:1px solid var(--vt-line); border-radius:12px; padding:8px 8px 10px; transition:box-shadow .15s ease,border-color .15s ease; }
.vt-sd-month.cur { border-color:var(--vt-accent); box-shadow:0 0 0 1px var(--vt-accent) inset; }
.vt-sd-mtitle { font-family:Marcellus,Georgia,serif; font-size:15px; color:var(--vt-accent); text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }
.vt-sd-mtitle span { color:var(--mantine-color-dimmed); font-size:12px; }
.vt-sd-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
.vt-sd-wd { text-align:center; font-size:10px; color:var(--mantine-color-dimmed); padding:2px 0; }
.vt-sd-day { position:relative; height:34px; border:1px solid transparent; border-radius:8px; background:transparent; color:inherit; font-size:12.5px; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1; gap:1px; padding:0; }
.vt-sd-day:hover { background:var(--vt-gold-chip); border-color:var(--vt-line); }
.vt-sd-day.sun { color:var(--mantine-color-kumkum-7); font-weight:700; }
.vt-sd-day.past { opacity:.45; }
.vt-sd-day.today { border-color:var(--mantine-color-gold-5); background:var(--mantine-color-gold-1); font-weight:700; color:#2B0909; }
.vt-sd-day.on { background:var(--mantine-color-kumkum-7); color:#FBF6EC; border-color:var(--mantine-color-kumkum-7); font-weight:700; opacity:1; }
.vt-sd-sym { display:block; margin-top:-2px; }
.vt-sd-panels { display:grid; grid-template-columns:minmax(280px,1.15fr) minmax(230px,.85fr) minmax(300px,1fr); gap:12px; }
.vt-sd-card { border:1px solid var(--vt-line); border-radius:12px; padding:10px 12px; background:var(--vt-surface); min-width:0; }
.vt-sd-h { font-family:Marcellus,Georgia,serif; font-size:15px; font-weight:700; }
.vt-sd-h span { font-family:inherit; font-weight:400; font-size:12px; color:var(--mantine-color-dimmed); }
.vt-sd-row { display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:8px; border:1px solid transparent; }
.vt-sd-row.sel { background:var(--vt-gold-chip); border-color:var(--vt-line); }
.vt-sd-rowsym { width:22px; display:grid; place-items:center; }
.vt-sd-ev { display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:6px 8px; border:1px solid var(--vt-line); border-radius:10px; background:transparent; cursor:pointer; color:inherit; }
.vt-sd-ev:hover { background:var(--vt-gold-chip); }
.vt-sd-ev.on { background:var(--vt-gold-chip); border-color:var(--vt-accent); }
.vt-sd-evt { display:flex; flex-direction:column; min-width:0; }
.vt-sd-evt b { font-size:13px; }
.vt-sd-evt em { font-size:11px; font-style:normal; color:var(--mantine-color-dimmed); }
.vt-sd-sep { height:1px; background:var(--vt-line); margin:10px 0; }
.vt-sd-foot { flex:0 0 auto; display:flex; justify-content:space-between; align-items:center; padding:10px 18px 12px; border-top:1px solid var(--vt-line); background:var(--vt-surface); border-radius:0 0 var(--mantine-radius-lg) var(--mantine-radius-lg); }
@media (max-width: 1000px) { .vt-sd-panels { grid-template-columns:1fr; } }
`
