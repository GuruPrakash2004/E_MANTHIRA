import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useState } from 'react'
import { ActionIcon, Button, Card, Group, Modal, Skeleton, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { CalendarDays, ChevronLeft, ChevronRight, MoonStar } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as panchangaApi from '../../api/endpoints/panchanga'
import EmptyState from '../../components/ui/EmptyState'
import { oleColorToCss } from '../../utils/color'
import { SectionCard } from '../../components/ui/EntryParts'
import { PanchangaSymbol, symbolFor } from './symbols'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function PanchangaPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(dayjs().startOf('month'))
  const [editDay, setEditDay] = useState(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  const from = month.startOf('month')
  const to = month.endOf('month')
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['panchanga', from.format('YYYY-MM-DD')],
    queryFn: () => panchangaApi.listPanchanga(from.format('YYYY-MM-DD'), to.format('YYYY-MM-DD')),
  })
  const byDate = Object.fromEntries((data || []).map((d) => [d.date, d]))

  const todayIso = dayjs().format('YYYY-MM-DD')
  const events = (data || []).filter((d) => d.name).sort((a, b) => a.date.localeCompare(b.date))
  const nextEvent = events.find((e) => e.date >= todayIso)
  const isThisMonth = month.isSame(dayjs(), 'month')

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
    if (!editName.trim() && !(await confirm({ title: 'Clear this day?', message: 'The event name for this day will be removed.', confirmLabel: 'Clear' }))) return
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
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 40, width: 40 }} />
          <div>
            <Title order={2}>Panchanga</Title>
            <Text size="sm" c="dimmed">
              Temple calendar. Select a day to set or change its event.
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

      <div className="vt-pg-banner">
        <div className="vt-pg-banner-text">
          <div className="vt-pg-banner-month">{month.format('MMMM')}</div>
          <div className="vt-pg-banner-year">{month.format('YYYY')}</div>
        </div>
        <div className="vt-pg-banner-facts">
          <div>
            <div className="vt-pg-fact-n vt-num">{isLoading ? '-' : events.length}</div>
            <div className="vt-pg-fact-l">special {events.length === 1 ? 'day' : 'days'}</div>
          </div>
          <div className="vt-pg-banner-sep" aria-hidden />
          <div style={{ minWidth: 0 }}>
            <div className="vt-pg-fact-l">{isThisMonth ? 'Next up' : 'First of the month'}</div>
            <div className="vt-pg-fact-next">
              {isLoading ? '...' : (isThisMonth ? nextEvent : events[0])?.name || 'Nothing set'}
            </div>
          </div>
        </div>
        <div className="vt-pg-banner-sym" aria-hidden>
          <PanchangaSymbol name="Poornima" size={64} />
        </div>
      </div>

      <Card withBorder p="lg">
        <div className="vt-pg-week" aria-hidden>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={i === 0 ? 'vt-pg-wd vt-pg-wd-sun' : 'vt-pg-wd'}>
              <span className="vt-pg-wd-long">{w}</span>
              <span className="vt-pg-wd-short">{w[0]}</span>
            </div>
          ))}
        </div>
        <div className="vt-pg-grid" role="grid" aria-label={`Calendar for ${month.format('MMMM YYYY')}`}>
          {days.map((d) => {
            const iso = d.format('YYYY-MM-DD')
            const entry = byDate[iso]
            const inMonth = d.isSame(month, 'month')
            const color = oleColorToCss(entry?.color)
            const isToday = iso === todayIso
            const cls = ['vt-pg-cell', entry ? 'vt-pg-has' : '', isToday ? 'vt-pg-today' : '', inMonth ? '' : 'vt-pg-out', d.day() === 0 ? 'vt-pg-sun' : ''].join(' ')
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                className={cls}
                style={color ? { '--ev': color } : undefined}
                aria-label={`${d.format('dddd, D MMMM YYYY')}${entry ? `: ${entry.name}` : ''}${isToday ? ', today' : ''}`}
                onClick={() => openDay(d)}
              >
                <span className="vt-pg-day vt-num">{d.format('D')}</span>
                {entry && (
                  <>
                    <span className="vt-pg-name">{entry.name}</span>
                    <span className="vt-pg-sym">
                      <PanchangaSymbol name={entry.name} size={46} />
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      <SectionCard title="Special days this month" hint="The same days as a list. Select one to edit it.">
        {isLoading ? (
          <Stack gap="xs">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={52} radius="md" />
            ))}
          </Stack>
        ) : events.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No special days set" hint="Select any day in the calendar to name its event, such as Poornima or Rathothsava." />
        ) : (
          <Stack gap={6}>
            {events.map((e) => {
              const color = oleColorToCss(e.color)
              const sym = symbolFor(e.name)
              return (
                <UnstyledButton key={e.date} onClick={() => openDay(dayjs(e.date))} className="vt-pg-row" aria-label={`Edit ${e.name}, ${dayjs(e.date).format('D MMMM')}`}>
                  <span className="vt-pg-row-sym">
                    <PanchangaSymbol name={e.name} size={34} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={600} truncate>
                      {e.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {sym.label}
                    </Text>
                  </span>
                  {color && <span aria-hidden className="vt-pg-dot" style={{ background: color }} />}
                  <span className="vt-num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Text fw={600} size="sm">
                      {dayjs(e.date).format('DD/MM/YYYY')}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {dayjs(e.date).format('dddd')}
                    </Text>
                  </span>
                </UnstyledButton>
              )
            })}
          </Stack>
        )}
      </SectionCard>

      <Modal opened={Boolean(editDay)} onClose={() => setEditDay(null)} title={editDay ? dayjs(editDay).format('dddd, DD MMMM YYYY') : ''} radius="lg">
        <Stack>
          <Group gap="md" wrap="nowrap" align="flex-end">
            <div className="vt-pg-preview" aria-hidden>
              <PanchangaSymbol name={editName} size={44} />
            </div>
            <TextInput
              style={{ flex: 1 }}
              label="Event / Day Name"
              placeholder="e.g. Rathothsava, Amavasya, Poornima"
              leftSection={<MoonStar size={16} />}
              description={editName.trim() ? symbolFor(editName).label : 'The symbol follows the name you type'}
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
              data-autofocus
            />
          </Group>
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

      <style>{CSS}</style>
    </Stack>
  )
}

const CSS = `
.vt-pg-banner { position: relative; overflow: hidden; display: flex; align-items: center; gap: 28px; padding: 22px 28px; border-radius: var(--mantine-radius-lg);
  background: linear-gradient(120deg, #6B1A1A 0%, #3A0E0E 70%, #2B0909 100%); border: 1px solid rgba(244,225,166,.3); color: #FBF6EC; }
.vt-pg-banner::before { content: ''; position: absolute; inset: 0; background: url(${KOLAM_PATTERN}) center/150px 150px; opacity: .07; pointer-events: none; }
.vt-pg-banner > * { position: relative; }
.vt-pg-banner-month { font-family: Marcellus, Georgia, serif; font-size: clamp(30px, 4vw, 44px); line-height: 1; color: #F4E1A6; }
.vt-pg-banner-year { margin-top: 4px; letter-spacing: .3em; font-size: 13px; color: #E9D2B8; }
.vt-pg-banner-facts { display: flex; align-items: center; gap: 20px; flex: 1; min-width: 0; }
.vt-pg-banner-sep { width: 1px; align-self: stretch; background: rgba(244,225,166,.3); }
.vt-pg-fact-n { font-family: Marcellus, Georgia, serif; font-size: 34px; line-height: 1; color: #F4E1A6; }
.vt-pg-fact-l { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #E9D2B8; margin-top: 2px; }
.vt-pg-fact-next { font-family: Marcellus, Georgia, serif; font-size: 20px; color: #FBF6EC; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-pg-banner-sym { flex: 0 0 auto; filter: drop-shadow(0 0 18px rgba(244,225,166,.45)); }
@media (max-width: 700px) { .vt-pg-banner { flex-wrap: wrap; gap: 14px; padding: 18px; } .vt-pg-banner-sym { display: none; } .vt-pg-banner-facts { flex-basis: 100%; } }

.vt-pg-week, .vt-pg-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.vt-pg-week { margin-bottom: 6px; }
.vt-pg-wd { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--mantine-color-dimmed); padding: 4px 0; }
.vt-pg-wd-sun { color: var(--mantine-color-kumkum-7); }
.vt-pg-wd-short { display: none; }

.vt-pg-cell { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 100px; padding: 8px 10px; text-align: left; font: inherit; color: inherit;
  background: #fff; border: 1px solid var(--vt-line); border-radius: 14px; cursor: pointer; overflow: hidden; transition: transform .15s, box-shadow .15s, border-color .15s; }
.vt-pg-cell:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(122,31,31,.14); border-color: var(--mantine-color-gold-5); }
.vt-pg-cell:focus-visible { outline: 2px solid var(--mantine-color-kumkum-6); outline-offset: 2px; }
.vt-pg-out { opacity: .38; }
.vt-pg-day { display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 4px; border-radius: 13px; font-size: 14px; font-weight: 600; }
.vt-pg-sun .vt-pg-day { color: var(--mantine-color-kumkum-7); }
.vt-pg-today { border-color: var(--mantine-color-kumkum-6); box-shadow: 0 0 0 2px rgba(122,31,31,.18); }
.vt-pg-today .vt-pg-day { background: var(--mantine-color-kumkum-7); color: #fff; }
.vt-pg-has { background: linear-gradient(160deg, #FFFDF6 0%, #FBF0D2 100%); border-color: var(--mantine-color-gold-3); }
.vt-pg-has::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: var(--ev, var(--mantine-color-gold-5)); }
.vt-pg-name { font-size: 12.5px; font-weight: 600; line-height: 1.25; color: var(--mantine-color-kumkum-8); max-width: calc(100% - 34px); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.vt-pg-sym { position: absolute; right: 6px; bottom: 6px; filter: drop-shadow(0 2px 4px rgba(122,31,31,.2)); }

@media (max-width: 700px) {
  .vt-pg-week, .vt-pg-grid { gap: 3px; }
  .vt-pg-wd-long { display: none; } .vt-pg-wd-short { display: inline; }
  .vt-pg-cell { min-height: 62px; padding: 5px 4px; align-items: center; border-radius: 10px; }
  .vt-pg-name { display: none; }
  .vt-pg-sym { position: static; margin-top: 2px; } .vt-pg-sym svg { width: 26px; height: 26px; }
  .vt-pg-day { min-width: 22px; height: 22px; font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) { .vt-pg-cell { transition: none; } .vt-pg-cell:hover { transform: none; } }

.vt-pg-row { display: flex; align-items: center; gap: 14px; width: 100%; padding: 8px 12px; border: 1px solid var(--vt-line); border-radius: 12px; background: #fff; min-height: 56px; transition: border-color .15s, background .15s; }
.vt-pg-row:hover { background: var(--mantine-color-gold-0); border-color: var(--mantine-color-gold-4); }
.vt-pg-row:focus-visible { outline: 2px solid var(--mantine-color-kumkum-6); outline-offset: 2px; }
.vt-pg-row-sym { flex: 0 0 auto; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: var(--mantine-color-gold-0); }
.vt-pg-dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; box-shadow: 0 0 0 2px #fff, 0 0 0 3px var(--vt-line); }
.vt-pg-preview { flex: 0 0 auto; width: 60px; height: 60px; display: grid; place-items: center; border-radius: 16px; background: linear-gradient(160deg, #FFFDF6, #FBF0D2); border: 1px solid var(--mantine-color-gold-3); }
`
