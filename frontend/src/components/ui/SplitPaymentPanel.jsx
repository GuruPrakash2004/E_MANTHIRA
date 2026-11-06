import { useEffect } from 'react'
import { useMemo, useState } from 'react'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData } from '@tanstack/react-query'
import { ActionIcon, Badge, Button, Card, Group, NumberInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { DateInput } from './AppDates'
import { useQuery } from '@tanstack/react-query'
import { Plus, SplitSquareHorizontal, Trash2 } from 'lucide-react'
import * as splitApi from '../../api/endpoints/splitPayment'
import * as metaApi from '../../api/endpoints/meta'
import { formatINR, isoDate } from '../../utils/format'

/**
 * "Split bill": one Seva / Donation receipt paid in parts by different modes (e.g. 2000 = 1200 CASH + 800 UPI).
 * The parts are stored in the new WebSplitPayment table; the bill header keeps the main (largest) mode so the legacy EXE
 * and the printed receipt still see one ordinary payment, and the receipt voucher gets one debit line per part.
 * Modes come from the document's own Designer list; the cash / bank account of each mode defaults to the one this temple
 * usually uses for it. Nothing shows where the table does not exist.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const sumOf = (parts) => round2(parts.reduce((s, p) => s + (Number(p.amount) || 0), 0))
const blankPart = (mode = '', amount = 0, led = null) => ({ mode, amount, led_id: led?.led_id || '', led_label: led?.label || '', ref_no: '', chq_date: null, bank_name: '' })

/** Payment modes whose Reference No the Designer makes mandatory (REFNO: mandatory when `#<mode field>#` = e.g. UPI). */
export function refRequiredModes(fields, modeCode) {
  const f = (fields || []).find((x) => x.FldCode === 'REFNO')
  if (!f || !f.FldMndtryCompareVal || !f.FldMndtryWithVal) return []
  const ref = String(f.FldMndtryCompareVal).replace(/#/g, '')
  return ref === modeCode || (ref === 'PAYMNETMODE' && modeCode === 'PAYMNTMODE') ? [String(f.FldMndtryWithVal).trim().toUpperCase()] : []
}

/** The message to stop a save with, or null when the split is complete (or switched off). */
export function splitError(enabled, parts, total, refModes = []) {
  if (!enabled) return null
  if (parts.length < 2) return 'Split payment needs at least two parts'
  const bad = parts.findIndex((p) => !p.mode || !p.led_id || !(Number(p.amount) > 0))
  if (bad >= 0) return `Split part ${bad + 1}: choose a mode, a Cash or Bank Account and an amount greater than 0`
  const noRef = parts.findIndex((p) => refModes.includes(String(p.mode).toUpperCase()) && !String(p.ref_no || '').trim())
  if (noRef >= 0) return `Split part ${noRef + 1} (${parts[noRef].mode}): Reference No is required`
  const paid = sumOf(parts)
  if (Math.abs(paid - round2(total)) > 0.005) return `The split amounts (${formatINR(paid)}) must add up to the bill total (${formatINR(round2(total))})`
  return null
}

/** What the API takes. */
export const splitPayload = (parts) =>
  parts.map((p) => ({ mode: p.mode, amount: round2(p.amount), led_id: Number(p.led_id), ref_no: p.ref_no || '', chq_date: p.chq_date ? isoDate(p.chq_date) : null, bank_name: p.bank_name || '' }))

/** Saved parts (as the API returns them) back into editable ones. */
export const splitFromSaved = (rows) => (rows || []).map((r) => ({ mode: r.mode, amount: r.amount, led_id: r.led_id, led_label: r.led_label || '', ref_no: r.ref_no || '', chq_date: r.chq_date ? new Date(r.chq_date) : null, bank_name: r.bank_name || '' }))

/** The document's own "Cash or Bank Account" list (Designer field LEDID), searched by name; the chosen account always shows its name. */
function CashBankSelect({ docId, label, ariaLabel, value, valueLabel, onPick, disabled }) {
  const [search, setSearch] = useState('')
  const [q] = useDebouncedValue(search, 250)
  const { data = [] } = useQuery({ queryKey: ['split-ledgers', docId, q], queryFn: () => metaApi.getLookup(docId, 'LEDID', q), placeholderData: keepPreviousData, staleTime: 30_000, enabled: !disabled })
  const options = useMemo(() => {
    const list = data.map((o) => ({ value: String(o.value), label: String(o.label ?? '') }))
    if (value && !list.some((o) => o.value === String(value))) list.unshift({ value: String(value), label: valueLabel || `Account ${value}` })
    return list
  }, [data, value, valueLabel])
  return (
    <Select
      label={label}
      aria-label={ariaLabel}
      searchable
      clearable
      disabled={disabled}
      data={options}
      value={value ? String(value) : null}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: o }) => o}
      placeholder="Search account"
      nothingFoundMessage="No account found"
      comboboxProps={{ width: 360, position: 'bottom-start' }}
      onChange={(v) => (v ? onPick(Number(v), options.find((o) => o.value === v)?.label || '') : onPick('', ''))}
    />
  )
}

export default function SplitPaymentPanel({ docType, docId, enabled, setEnabled, parts, setParts, total, readOnly, onMain, refModes = [] }) {
  const { data: meta } = useQuery({ queryKey: ['split-meta', docType], queryFn: () => splitApi.getSplitMeta(docType), staleTime: 5 * 60_000 })

  // the bill header follows the main part (the largest amount): let the screen mirror it into its own payment fields
  useEffect(() => {
    if (!enabled || !parts.length || !onMain) return
    const main = parts.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a), parts[0])
    if (main.mode && main.led_id) onMain(main)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, JSON.stringify(parts.map((p) => [p.mode, p.amount, p.led_id, p.ref_no]))])

  const othersTotal = (ps, except) => round2(ps.reduce((s2, p, k) => (k === 0 || k === except ? s2 : s2 + (Number(p.amount) || 0)), 0))
  const balanced = (ps) => {
    const cash = Math.max(0, round2(total - othersTotal(ps, -1)))
    return Number(ps[0]?.amount) === cash ? ps : ps.map((p, k) => (k === 0 ? { ...p, amount: cash } : p))
  }
  useEffect(() => {
    if (!enabled || readOnly || !parts.length) return
    const next = balanced(parts)
    if (next !== parts) setParts(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, readOnly, round2(total), JSON.stringify(parts.map((p) => p.amount))])
  if (!meta?.available) return null
  const modes = meta.modes || []
  const paid = sumOf(parts)
  const gap = round2(total - paid)
  const set = (i, patch) => setParts((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)))

  const start = (on) => {
    setEnabled(on)
    if (on && parts.length < 2) {
      const [m1, m2] = [modes.find((m) => m.toUpperCase() === 'CASH') || modes[0], modes.find((m) => m.toUpperCase() === 'UPI') || modes[1] || modes[0]]
      setParts([blankPart(m1, round2(total), meta.defaults?.[m1]), blankPart(m2, 0, meta.defaults?.[m2])])
    }
  }
  const setMode = (i, mode) => set(i, { mode, led_id: meta.defaults?.[mode]?.led_id || parts[i].led_id, led_label: meta.defaults?.[mode]?.label || parts[i].led_label })
  // The first part (cash) is the balancing part: it is never typed, it always takes whatever the other parts leave of the bill
  // (down to 0, never below). The other parts can be typed, but never beyond what is left of the bill for them.
  const capFor = (i) => Math.max(0, round2(total - othersTotal(parts, i)))
  const setAmount = (i, v) => {
    if (i === 0) return
    setParts((ps) => {
      const cap = Math.max(0, round2(total - othersTotal(ps, i)))
      const amount = Math.min(cap, Math.max(0, Number(v === '' || v == null ? 0 : v) || 0))
      return balanced(ps.map((p, k) => (k === i ? { ...p, amount } : p)))
    })
  }
  const addPart = () => setParts((ps) => [...ps, blankPart(modes[0], 0, meta.defaults?.[modes[0]])])
  const fillRest = (i) => setAmount(i, capFor(i))

  return (
    <Card withBorder p="md" mt="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="xs">
          <SplitSquareHorizontal size={18} />
          <Text fw={600}>Split payment</Text>
          <Text size="xs" c="dimmed">One bill, paid in parts by different modes</Text>
        </Group>
        <Switch checked={enabled} onChange={(e) => start(e.currentTarget.checked)} disabled={readOnly} aria-label="Pay this bill in parts" label="Pay in parts" color="kumkum" />
      </Group>

      {enabled && (
        <Stack gap="sm" mt="md">
          {parts.map((p, i) => (
            <Stack key={i} gap={6}>
            <Group align="flex-end" gap="sm" wrap="wrap">
              <Select label={i === 0 ? 'Mode' : undefined} aria-label={`Mode, part ${i + 1}`} data={modes} value={p.mode || null} onChange={(v) => v && setMode(i, v)} disabled={readOnly} allowDeselect={false} w={130} />
              <NumberInput label={i === 0 ? 'Amount' : undefined} aria-label={`Amount, part ${i + 1}`} value={p.amount} onChange={(v) => setAmount(i, v)} disabled={readOnly} readOnly={i === 0} title={i === 0 ? 'The cash part takes the balance automatically' : undefined} decimalScale={2} min={0} max={i === 0 ? undefined : capFor(i)} clampBehavior="strict" w={140} styles={i === 0 ? { input: { fontWeight: 700, background: 'var(--vt-gold-chip)', cursor: 'not-allowed' } } : undefined} />
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <CashBankSelect docId={docId} label={i === 0 ? 'Cash or Bank Account' : undefined} ariaLabel={`Cash or bank account, part ${i + 1}`} value={p.led_id} valueLabel={p.led_label} onPick={(id, label) => set(i, { led_id: id, led_label: label })} disabled={readOnly} />
              </div>
              <TextInput label={i === 0 ? 'Reference / Cheque no' : undefined} withAsterisk={refModes.includes(String(p.mode).toUpperCase())} aria-label={`Reference, part ${i + 1}`} value={p.ref_no} onChange={(e) => set(i, { ref_no: e.currentTarget.value })} disabled={readOnly} w={170} maxLength={60} />
              {!readOnly && (
                <Group gap={4} wrap="nowrap">
                  {i > 0 && capFor(i) > (Number(p.amount) || 0) && (
                    <Button size="compact-sm" variant="subtle" onClick={() => fillRest(i)}>
                      Fill balance
                    </Button>
                  )}
                  <ActionIcon variant="subtle" color="red" size={36} aria-label={`Remove part ${i + 1}`} disabled={parts.length <= 2} onClick={() => setParts((ps) => ps.filter((_, k) => k !== i))}>
                    <Trash2 size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
            {/* a cheque part's date and bank sit on their own line, so the columns of every part stay aligned */}
            {String(p.mode).toUpperCase() === 'CHEQUE' && (
              <Group gap="sm" wrap="wrap" pl={{ base: 0, sm: 142 }}>
                <DateInput aria-label={`Cheque date, part ${i + 1}`} label="Cheque date" valueFormat="DD-MMM-YYYY" value={p.chq_date} onChange={(v) => set(i, { chq_date: v })} disabled={readOnly} w={160} clearable />
                <TextInput aria-label={`Bank, part ${i + 1}`} label="Bank" value={p.bank_name} onChange={(e) => set(i, { bank_name: e.currentTarget.value })} disabled={readOnly} w={220} maxLength={60} />
              </Group>
            )}
            </Stack>
          ))}
          <Group justify="space-between" wrap="wrap">
            {!readOnly ? (
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addPart}>
                Add part
              </Button>
            ) : (
              <span />
            )}
            <Group gap="xs">
              <Text size="sm">
                Allocated {formatINR(paid)} of {formatINR(round2(total))}
              </Text>
              <Badge color={gap === 0 ? 'green' : 'orange'} variant="light">
                {gap === 0 ? 'Balanced' : gap > 0 ? `${formatINR(gap)} left` : `${formatINR(-gap)} over`}
              </Badge>
            </Group>
          </Group>
        </Stack>
      )}
    </Card>
  )
}
