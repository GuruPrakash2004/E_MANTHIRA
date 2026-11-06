import { useMemo, useRef, useState } from 'react'
import { Badge, Button, Group, Modal, NumberInput, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { Search } from 'lucide-react'
import AlertifyLogo from './AlertifyLogo'
import PillEditor from './PillEditor'
import { loadDraft, saveDraft } from './sendAlert'
import { dueDates, pillsIn, resolveTemplate, to12h } from '../../utils/alertifyPills'
import './alertify.css'

const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * The Alertify popup: a title and a description made of text and field pills, "notify me (days)" before / on / after the bill's
 * date, the time, and a live "Due on" preview. Save hands the draft (pills still as <<Caption>>) to onSubmit.
 *   fields  [{ caption, value }]   the bill's fields (from the Designer)       totals [{ caption, value }]   Doc No, amounts, dates
 *   anchors ['YYYY-MM-DD']         the dates the alert is counted from          billTime  'HH:MM' | null  the bill's own timing
 */
export default function AlertifyModal({ opened, onClose, docId, user, label, fields, totals, anchors, billTime, defaultTime, defaultDir = 'before', saved, onSubmit }) {
  const start = useMemo(() => loadDraft(docId, user), [docId, user]) // eslint-disable-line react-hooks/exhaustive-deps
  const titleRef = useRef(null)
  const descRef = useRef(null)
  const active = useRef('title')
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [days, setDays] = useState(start?.days ?? 1)
  const [dir, setDir] = useState(start?.dir ?? defaultDir)
  const [time, setTime] = useState(billTime || start?.time || defaultTime || '11:00')
  const [, bump] = useState(0)
  const [busy, setBusy] = useState(false)

  const all = useMemo(() => [...fields.map((p) => ({ ...p, kind: 'fields' })), ...totals.map((p) => ({ ...p, kind: 'totals' }))], [fields, totals])
  const shown = all.filter((p) => (tab === 'all' || p.kind === tab) && p.caption.toLowerCase().includes(q.trim().toLowerCase()))
  const values = useMemo(() => Object.fromEntries(all.map((p) => [p.caption, p.value])), [all])

  const title = titleRef.current?.getValue() ?? start?.title ?? ''
  const preview = dueDates(anchors, days, dir, time)
  const unknown = pillsIn(`${title} ${descRef.current?.getValue() ?? ''}`).filter((c) => !(c in values))
  let problem = ''
  if (!resolveTemplate(title, values)) problem = 'Give the alert a title'
  else if (!preview.length) problem = dir === 'on' ? 'There is no date to set the alert on' : 'Enter the number of days'

  const insert = (caption) => (active.current === 'title' ? titleRef : descRef).current?.insert(caption)

  async function submit() {
    const draft = { title: titleRef.current.getValue().trim(), description: descRef.current.getValue().trim(), days: Number(days) || 0, dir, time }
    setBusy(true)
    saveDraft(docId, user, draft)
    try {
      await onSubmit(draft)
    } finally {
      setBusy(false)
    }
  }

  const count = (k) => all.filter((p) => k === 'all' || p.kind === k).length
  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" classNames={{ content: 'al-modal', header: 'al-modal' }} title={<AlertifyLogo size={30} />} centered>
      <Stack gap="sm" className="al-modal" style={{ color: 'var(--al-ink)' }}>
        <Text size="sm" c="var(--al-sub)">Make a reminder from this {label}. Click a field to add it; it is filled in with this bill's real value.</Text>

        <div>
          <Text size="xs" fw={700} c="var(--al-sub)" mb={4}>TITLE</Text>
          <PillEditor ref={titleRef} single initial={start?.title ?? `${label} <<Doc No>>`} ariaLabel="Alert title" placeholder="Alert title" onFocus={() => { active.current = 'title' }} onChange={() => bump((n) => n + 1)} />
        </div>
        <div>
          <Text size="xs" fw={700} c="var(--al-sub)" mb={4}>DESCRIPTION</Text>
          <PillEditor ref={descRef} initial={start?.description ?? ''} ariaLabel="Alert description" placeholder="Description (optional)" minHeight={84} onFocus={() => { active.current = 'desc' }} onChange={() => bump((n) => n + 1)} />
        </div>
        {unknown.length > 0 && <Text size="xs" c="orange">Not a field on this bill: {unknown.join(', ')} (it will be left blank)</Text>}

        <Group justify="space-between" gap="xs">
          <SegmentedControl size="xs" value={tab} onChange={setTab} data={[{ value: 'all', label: `All (${count('all')})` }, { value: 'fields', label: `Fields (${count('fields')})` }, { value: 'totals', label: `Totals (${count('totals')})` }]} />
          <TextInput size="xs" leftSection={<Search size={13} />} placeholder="Search fields" aria-label="Search fields" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={170} />
        </Group>
        <Group gap={6} style={{ maxHeight: 120, overflowY: 'auto' }} role="list">
          {shown.map((p) => (
            <button key={p.kind + p.caption} type="button" role="listitem" className="al-chip" data-empty={!String(p.value ?? '').trim()} title={String(p.value ?? '') || 'No value yet'} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.caption)}>
              {p.caption}
            </button>
          ))}
          {!shown.length && <Text size="sm" c="var(--al-sub)">No field matches</Text>}
        </Group>

        <Group align="flex-end" gap="sm" wrap="wrap">
          <SegmentedControl size="xs" value={dir} onChange={setDir} data={[{ value: 'before', label: 'Before' }, { value: 'on', label: 'On the day' }, { value: 'after', label: 'After' }]} aria-label="Before, on or after" />
          {dir !== 'on' && <NumberInput label="Notify me (days)" size="xs" min={1} max={365} allowDecimal={false} value={days} onChange={setDays} w={130} hideControls />}
          <TimeInput label="At time" size="xs" value={time} onChange={(e) => setTime(e.currentTarget.value)} w={120} />
        </Group>

        <div className="al-due" aria-live="polite">
          <Text size="xs" fw={700} c="var(--al-sub)">DUE ON</Text>
          {preview.length ? preview.map((d) => (
            <Text key={d.date} size="sm" >
              {fmtDate(d.date)}, {to12h(d.time)} {d.past && <Badge size="xs" color="gray" variant="light">past date</Badge>}
            </Text>
          )) : <Text size="sm" c="var(--al-sub)">{dir === 'on' ? 'No date on this bill yet' : 'Enter the days to see the dates'}</Text>}
        </div>
        <Text size="xs" c="var(--al-sub)">{saved ? 'The alert is created when you press Save Alert.' : 'The bill is not saved yet: the alert is created right after you save it, so Doc No is the real number.'}</Text>

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button style={{ background: 'linear-gradient(135deg,#8B5CF6,#5B3FD8)' }} loading={busy} disabled={Boolean(problem)} title={problem || undefined} onClick={submit}>Save Alert</Button>
        </Group>
        {problem && <Text size="xs" c="red" ta="right">{problem}</Text>}
      </Stack>
    </Modal>
  )
}
