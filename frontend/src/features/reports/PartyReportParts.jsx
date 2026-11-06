import { useMemo, useState } from 'react'
import { ActionIcon, Button, Card, Group, MultiSelect, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import * as api from '../../api/endpoints/partyReports'
import NotAvailableHere from '../../components/ui/NotAvailableHere'
import UtilityBanner from '../../components/ui/UtilityBanner'

/**
 * Shared pieces of the receivable / payable report screens. Everything shown comes from the server: the page title is the
 * menu row's caption, the two kinds are labelled with the party masters' own names (what the Doc Designer calls them), party
 * and group lists are the masters' rows, headings are the real column names. Nothing is typed in here.
 */

/** Loads the options of both kinds (they carry the party-master captions) and keeps the chosen kind. */
export function useKinds(report, initialKind) {
  const [kind, setKind] = useState(initialKind || 'receivable')
  const rec = useQuery({ queryKey: ['party-options', 'receivable', report], queryFn: () => api.partyOptions('receivable', report) })
  const pay = useQuery({ queryKey: ['party-options', 'payable', report], queryFn: () => api.partyOptions('payable', report) })
  const opts = kind === 'receivable' ? rec.data : pay.data
  const kinds = [
    { value: 'receivable', label: rec.data?.party_caption || '...' },
    { value: 'payable', label: pay.data?.party_caption || '...' },
  ]
  return { kind, setKind, opts, kinds, loading: rec.isLoading || pay.isLoading }
}

export function KindToggle({ kind, setKind, kinds, onChange }) {
  return <SegmentedControl value={kind} onChange={(v) => { setKind(v); onChange?.() }} data={kinds} color="kumkum" />
}

/** Party + group pickers for one kind; `value` = { party_ids, group_ids }. */
export function PartyFilters({ kind, opts, value, onChange, partyLabel }) {
  const [q, setQ] = useState('')
  const [dq] = useDebouncedValue(q, 250)
  const [picked, setPicked] = useState({}) // id -> option, so a pick stays labelled when the search changes
  const { data: found = [] } = useQuery({ queryKey: ['party-list', kind, dq], queryFn: () => api.partyList(kind, dq) })
  const options = useMemo(() => {
    const m = new Map(Object.entries(picked))
    found.forEach((p) => m.set(String(p.id), { value: String(p.id), label: `${p.code} - ${p.name}` }))
    return [...m.values()]
  }, [found, picked])
  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      <MultiSelect
        label={partyLabel || opts?.party_caption}
        w={340}
        searchable
        clearable
        placeholder="All"
        data={options}
        value={value.party_ids.map(String)}
        onChange={(vals) => {
          setPicked((p) => ({ ...p, ...Object.fromEntries(vals.map((v) => [v, options.find((o) => o.value === v)]).filter(([, o]) => o)) }))
          onChange({ ...value, party_ids: vals.map(Number) })
        }}
        searchValue={q}
        onSearchChange={setQ}
        filter={({ options: o }) => o}
        nothingFoundMessage="Not found"
      />
      {(opts?.groups || []).length > 0 && (
        <MultiSelect
          label="Group"
          w={240}
          searchable
          clearable
          placeholder="All"
          data={opts.groups.map((g) => ({ value: String(g.id), label: g.name }))}
          value={value.group_ids.map(String)}
          onChange={(vals) => onChange({ ...value, group_ids: vals.map(Number) })}
        />
      )}
    </Group>
  )
}

/** Page frame: banner + the "not available" notice when the database lacks what the report reads. */
export function ReportFrame({ opts, loading, banner, emblem, children, result }) {
  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner title={opts?.title || ' '} subtitle={banner.subtitle || ' '} heading={banner.heading || opts?.title || ' '} sub={opts?.title || ' '} facts={banner.facts || []} emblem={emblem} />
      {loading ? <Skeleton height={160} radius="md" /> : opts && !opts.available ? <NotAvailableHere feature={opts.title} missing={opts.missing} /> : (
        <>
          {children}
          {result && !result.available && <NotAvailableHere feature={opts?.title} missing={result.missing} />}
        </>
      )}
    </Stack>
  )
}

export const FilterCard = ({ children }) => <Card withBorder p="lg"><Stack gap="sm">{children}</Stack></Card>

/** Editable ageing ranges: rows of From / To (the last row may leave To empty = open-ended). */
export function BucketEditor({ value, onChange, setting }) {
  const set = (i, patch) => onChange(value.map((b, k) => (k === i ? { ...b, ...patch } : b)))
  return (
    <Stack gap={6}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase">Ageing ranges (days past due)</Text>
      {value.length === 0 && setting && <Text size="xs" c="dimmed">No ranges are set up yet. Add them here, or save the setting <b>{setting.name}</b> (group {setting.group}) in Global Settings, written like <span style={{ fontFamily: 'monospace' }}>{setting.format}</span>.</Text>}
      {value.map((b, i) => (
        <Group key={i} gap="xs" wrap="nowrap">
          <input aria-label={`Range ${i + 1} from`} type="number" value={b.from ?? ''} onChange={(e) => set(i, { from: e.target.value === '' ? '' : Number(e.target.value) })} style={numBox} />
          <Text size="sm">to</Text>
          <input aria-label={`Range ${i + 1} to`} type="number" placeholder="open" value={b.to ?? ''} onChange={(e) => set(i, { to: e.target.value === '' ? null : Number(e.target.value) })} style={numBox} />
          <ActionIcon variant="subtle" color="red" aria-label="Remove range" onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 size={15} /></ActionIcon>
        </Group>
      ))}
      <Group><Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={() => onChange([...value, { from: value.length ? (Number(value[value.length - 1].to ?? value[value.length - 1].from) || 0) + 1 : 0, to: null }])}>Add range</Button></Group>
    </Stack>
  )
}
const numBox = { width: 90, height: 32, padding: '0 8px', borderRadius: 6, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', color: 'inherit' }

export const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--vt-accent)', borderBottom: '1px solid var(--vt-line)', position: 'sticky', top: 0, background: 'var(--vt-sandal)' }
export const td = { padding: '6px 10px', borderBottom: '1px solid var(--vt-line)' }
export const right = { textAlign: 'right' }
export const GridBox = ({ children }) => <div style={{ overflow: 'auto', maxHeight: '65vh', border: '1px solid var(--vt-line)', borderRadius: 8 }}><table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>{children}</table></div>
