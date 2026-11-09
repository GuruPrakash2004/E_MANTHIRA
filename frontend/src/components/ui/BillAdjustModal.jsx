import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Group, Loader, Modal, NumberInput, Radio, Stack, Table, Text, TextInput } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as voucherApi from '../../api/endpoints/voucher'
import { useConfirm } from './ConfirmProvider'

/**
 * Bill wise Adjustment (legacy frmTrnVchPend, opened from a voucher line of a customer / supplier / journal party).
 * The party's pending bills are ticked off against the line's amount; what is left is "On-Account" (nothing stored) or a
 * "New-Reference". Amounts are signed like the legacy window: Dr positive, Cr negative, shown as "x.xx Dr / Cr".
 * Result (onApply): the line's `adjustments` - one {adj_acc_id, amount, side, adj_type 'A', new_ref_no} per bill, plus an 'N' row for a new reference.
 */
const r2 = (n) => Math.round(n * 100) / 100
const fmt = (n) => {
  const v = r2(n)
  return v === 0 ? '0.00' : `${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${v > 0 ? 'Dr' : 'Cr'}`
}
const sign = (n) => (n < 0 ? -1 : 1)
const day = (d) => (d ? dayjs(d).format('DD/MM/YYYY') : '')

export default function BillAdjustModal({ opened, onClose, onApply, partyName, balanceText, docId, voucherId, acLedId, side, amount, existing = [] }) {
  const confirm = useConfirm()
  const toAdjust = side === 'CR' ? -amount : amount // legacy: Dr - Cr
  const [adj, setAdj] = useState({}) // acc_id -> signed adjusted amount
  const [mode, setMode] = useState('') // '' | 'account' | 'newref'
  const [newRef, setNewRef] = useState('')
  const [error, setError] = useState('')

  const { data: bills, isLoading } = useQuery({
    queryKey: ['pending-bills', acLedId, side, docId, voucherId, opened],
    queryFn: () => voucherApi.getPendingBills({ ac_led_id: acLedId, side, doc_id: docId, voucher_id: voucherId || 0 }),
    enabled: Boolean(opened && acLedId),
    staleTime: 0,
    gcTime: 0,
  })

  // (re)load what was adjusted before (legacy LoadPendData): ticked bills with their amounts, and the new reference
  useEffect(() => {
    if (!opened || !bills) return
    const next = {}
    let ref = ''
    for (const a of existing) {
      if (a.adj_type === 'N') ref = a.new_ref_no || ''
      else if (bills.some((b) => b.acc_id === a.adj_acc_id)) next[a.adj_acc_id] = a.side === 'DR' ? a.amount : -a.amount
    }
    setAdj(next)
    setMode(ref ? 'newref' : '')
    setNewRef(ref)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, bills])

  const adjusted = useMemo(() => Object.values(adj).reduce((s, v) => s + v, 0), [adj])
  const remaining = r2(toAdjust + adjusted) // legacy calTotal: Party Amount + the adjusted (signed) amounts

  /** What one more bill takes of the remaining amount (legacy vsfDet_AfterEdit col 0 / btnAutoAdj). */
  function share(bal, rem) {
    if (rem === 0) return 0
    if (sign(bal) !== sign(rem)) return Math.abs(bal) < Math.abs(rem) ? bal : Math.abs(rem) * sign(bal)
    return Math.abs(bal) < Math.abs(rem) ? bal : rem
  }
  function toggle(b, on) {
    setAdj((cur) => {
      const next = { ...cur }
      if (!on) delete next[b.acc_id]
      else {
        const rem = r2(toAdjust + Object.entries(cur).filter(([k]) => Number(k) !== b.acc_id).reduce((s, [, v]) => s + v, 0))
        const v = r2(share(b.bal_amt, rem))
        if (v !== 0) next[b.acc_id] = v
      }
      return next
    })
  }
  function setAmount(b, mag) {
    const m = Math.min(Math.abs(Number(mag) || 0), Math.abs(b.bal_amt))
    setAdj((cur) => {
      const next = { ...cur }
      if (m > 0) next[b.acc_id] = r2(m * sign(b.bal_amt))
      else delete next[b.acc_id]
      return next
    })
  }
  function autoAdjust() {
    const next = {}
    let rem = toAdjust
    for (const b of bills || []) {
      const v = r2(share(b.bal_amt, rem))
      if (v !== 0) next[b.acc_id] = v
      rem = r2(toAdjust + Object.values(next).reduce((s, x) => s + x, 0))
      if (rem === 0) break
    }
    setAdj(next)
  }

  async function ok() {
    let useNew = mode === 'newref'
    if (!useNew && remaining !== 0) {
      // legacy: "<amount> is still un-Adjusted. Do you want to treat this as New-Reference Amt ?" (No = On-Account)
      useNew = await confirm({
        title: 'Un-adjusted amount',
        message: `${fmt(remaining)} is still un-Adjusted. Do you want to treat this as New-Reference Amt?`,
        confirmLabel: 'Yes, New-Reference',
        cancelLabel: 'No, On-Account',
        tone: 'info',
      })
      setMode(useNew ? 'newref' : 'account')
    }
    if (useNew && remaining !== 0 && !newRef.trim()) {
      setMode('newref')
      setError('Please enter New reference number.')
      return
    }
    const rows = (bills || [])
      .filter((b) => adj[b.acc_id])
      .map((b) => ({ adj_acc_id: b.acc_id, amount: Math.abs(adj[b.acc_id]), side: adj[b.acc_id] < 0 ? 'CR' : 'DR', adj_type: 'A', new_ref_no: '', doc_type: b.doc_type, trn_no: b.trn_no, trn_date: b.trn_date }))
    if (useNew && remaining !== 0) {
      rows.unshift({ adj_acc_id: 0, amount: Math.abs(remaining), side: remaining < 0 ? 'CR' : 'DR', adj_type: 'N', new_ref_no: newRef.trim(), doc_type: '', trn_no: newRef.trim(), trn_date: null })
    }
    onApply(rows)
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Bill wise Adjustment" size="min(1040px, 96vw)" centered closeOnClickOutside={false}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Text fw={700} c="blue.8" size="lg">Party: {partyName}</Text>
            <Text fw={700} c="blue.8">Balance : {balanceText || '0.00'}</Text>
          </div>
          <Group gap="md" align="flex-end" wrap="wrap">
            <Button variant="default" onClick={autoAdjust} disabled={!bills?.length}>Auto Adjustment</Button>
            <div>
              <Text size="xs" ta="center" c="dimmed">Party Amount</Text>
              <Text fw={800} size="lg" ta="center" className="vt-num" style={{ border: '1px solid var(--vt-line)', borderRadius: 6, padding: '4px 14px', minWidth: 150 }}>{fmt(toAdjust)}</Text>
            </div>
            <div>
              <Text size="xs" ta="center" c="dimmed">Remaining Amount</Text>
              <Text fw={800} size="lg" ta="center" className="vt-num" style={{ border: '1px solid var(--vt-line)', borderRadius: 6, padding: '4px 14px', minWidth: 150 }}>{fmt(remaining)}</Text>
            </div>
          </Group>
        </Group>

        <Table.ScrollContainer minWidth={760} mah={320}>
          <Table stickyHeader withRowBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Doc Type</Table.Th>
                <Table.Th>Doc. No</Table.Th>
                <Table.Th>Doc. Date</Table.Th>
                <Table.Th>Doc Reference</Table.Th>
                <Table.Th>Due Date</Table.Th>
                <Table.Th ta="right">Doc. Amount</Table.Th>
                <Table.Th ta="right">Bal. Amount</Table.Th>
                <Table.Th ta="right" w={150}>Adj. Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr><Table.Td colSpan={9}><Group justify="center" p="md"><Loader size="sm" /></Group></Table.Td></Table.Tr>
              )}
              {!isLoading && !bills?.length && (
                <Table.Tr><Table.Td colSpan={9}><Text ta="center" c="dimmed" p="md">No pending bills for this party.</Text></Table.Td></Table.Tr>
              )}
              {(bills || []).map((b) => (
                <Table.Tr key={b.acc_id}>
                  <Table.Td><Checkbox aria-label={`Adjust ${b.doc_type} ${b.trn_no}`} checked={Boolean(adj[b.acc_id])} onChange={(e) => toggle(b, e.currentTarget.checked)} /></Table.Td>
                  <Table.Td>{b.doc_type}</Table.Td>
                  <Table.Td>{b.trn_no}</Table.Td>
                  <Table.Td>{day(b.trn_date)}</Table.Td>
                  <Table.Td>{b.doc_ref}</Table.Td>
                  <Table.Td>{day(b.due_date)}</Table.Td>
                  <Table.Td ta="right" className="vt-num">{fmt(b.doc_amt)}</Table.Td>
                  <Table.Td ta="right" className="vt-num">{fmt(b.bal_amt)}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      aria-label={`Adjusted amount, ${b.doc_type} ${b.trn_no}`}
                      value={adj[b.acc_id] ? Math.abs(adj[b.acc_id]) : ''}
                      onChange={(v) => setAmount(b, v)}
                      decimalScale={2}
                      min={0}
                      max={Math.abs(b.bal_amt)}
                      hideControls
                      suffix={adj[b.acc_id] ? (adj[b.acc_id] > 0 ? ' Dr' : ' Cr') : ''}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Stack gap={6}>
            <Text size="sm" td="underline">Un-Adjusted Amount to be treated as</Text>
            <Radio.Group value={mode} onChange={(v) => { setMode(v); setError('') }}>
              <Group gap="lg">
                <Radio value="account" label="On-Account" />
                <Radio value="newref" label="New-Reference" />
                {mode === 'newref' && (
                  <TextInput aria-label="New reference number" placeholder="New reference no." value={newRef} onChange={(e) => setNewRef(e.currentTarget.value.replace(/'/g, ''))} error={error || undefined} w={200} data-autofocus />
                )}
              </Group>
            </Radio.Group>
          </Stack>
          <Group gap="sm">
            <Button variant="default" onClick={() => setAdj({})}>Clear Adjustment</Button>
            <Button color="red" variant="light" onClick={onClose}>Cancel</Button>
            <Button color="kumkum" onClick={ok}>OK</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}
