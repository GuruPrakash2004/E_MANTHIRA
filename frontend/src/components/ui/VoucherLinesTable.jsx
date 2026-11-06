import { useEffect, useId } from 'react'
import { ActionIcon, NumberInput, Select, Table, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import { formatINR } from '../../utils/format'
import AccountHeadSelect from './AccountHeadSelect'
import { useConfirm } from './ConfirmProvider'

/**
 * The Dr / Cr account-head grid of every voucher (legacy frmTrnVch vsfDet), shared by Payment, Receipt, Journal, Credit /
 * Debit Note, Contra and Purchase Voucher. Legacy behaviour kept:
 *  - each line has a type (Dr / Cr); the first line starts as the document's DefFirstRowAmtType; changing the type clears the
 *    opposite amount; the head list depends on the type
 *  - choosing a head with no amount yet fills the balancing difference (|sum Dr - sum Cr|) into the line's own column
 *  - the Balance column (document switch BalanceColReq) shows each head's running balance as "x.xx Dr / Cr"
 */
export const opposite = (side) => (side === 'CR' ? 'DR' : 'CR')
export const blankLine = (side = 'DR') => ({ ac_led_id: '', dr_amt: 0, cr_amt: 0, side })
export const newVoucherLines = (first = 'DR') => [blankLine(first), blankLine(opposite(first))]
export const sideOf = (l) => l.side || (Number(l.dr_amt) ? 'DR' : Number(l.cr_amt) ? 'CR' : 'DR')
/** Lines loaded from a saved voucher: the side is whichever column holds the amount. */
export const linesFromSaved = (rows) => rows.map((l) => ({ ac_led_id: String(l.ac_led_id), dr_amt: l.dr_amt, cr_amt: l.cr_amt, side: Number(l.dr_amt) ? 'DR' : 'CR' }))
const own = (side) => (side === 'CR' ? 'cr_amt' : 'dr_amt')
const r2 = (n) => Math.round(n * 100) / 100
const differenceOf = (lines) => r2(lines.reduce((s, l) => s + (Number(l.dr_amt) || 0) - (Number(l.cr_amt) || 0), 0)) // > 0: debit is ahead

/** The side that is short (where the next amount belongs) once the lines are unbalanced. */
export const nextLineSide = (lines, first = 'DR') => {
  const d = differenceOf(lines)
  return d > 0 ? 'CR' : d < 0 ? 'DR' : lines.length ? opposite(sideOf(lines[lines.length - 1])) : first
}

/**
 * Auto-tally: after the user edits line `edited`, bring Debit and Credit level by moving the difference onto lines the tally
 * itself filled (`auto`), never onto an amount the user typed:
 *  1. a tally line on the short side takes the difference (3000 Cr typed over a 2000 Dr tally line -> Dr 3000)
 *  2. else a tally line on the side that is ahead gives some back (Cr lowered to 1500 -> Dr tally 3000 becomes 1500)
 *  3. else the first empty line on the short side is filled with the difference.
 */
export function tallyLines(lines, edited) {
  const diff = differenceOf(lines)
  if (diff === 0) return lines
  const short = diff > 0 ? 'CR' : 'DR'
  const gap = Math.abs(diff)
  const set = (i, patch) => lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
  const amount = (l) => Number(l[own(sideOf(l))]) || 0
  let i = lines.findIndex((l, idx) => idx !== edited && l.auto && sideOf(l) === short)
  if (i >= 0) return set(i, { [own(short)]: r2(amount(lines[i]) + gap), auto: true })
  i = lines.findIndex((l, idx) => idx !== edited && l.auto && sideOf(l) !== short && amount(l) > 0)
  if (i >= 0) return set(i, { [own(sideOf(lines[i]))]: r2(Math.max(0, amount(lines[i]) - gap)), auto: true })
  i = lines.findIndex((l, idx) => idx !== edited && sideOf(l) === short && amount(l) === 0)
  if (i >= 0) return set(i, { [own(short)]: gap, auto: true })
  return lines
}

/** "Add line": the new line takes the short side and, while unbalanced, the missing amount (as a tally line). */
export function appendLine(lines, first = 'DR') {
  const side = nextLineSide(lines, first)
  const gap = Math.abs(differenceOf(lines))
  return [...lines, { ...blankLine(side), ...(gap > 0 ? { [own(side)]: gap, auto: true } : {}) }]
}

const sum = (lines, key) => lines.reduce((s, l) => s + (Number(l[key]) || 0), 0)

function BalanceCell({ id }) {
  const { data } = useQuery({ queryKey: ['account-head', id], queryFn: () => voucherApi.getAccountHead(id), enabled: Boolean(id), staleTime: 10_000 })
  if (!id || !data?.found) return null
  return (
    <Text size="sm" c="dimmed" ta="right" className="vt-num">
      {data.balance_side ? `${formatINR(data.balance)} ${data.balance_side}` : formatINR(0)}
    </Text>
  )
}

export default function VoucherLinesTable({ docId, lines, setLines, readOnly, balanceCol, firstType = 'DR', totalsLabel = 'Total Dr / Total Cr', attempted }) {
  const confirm = useConfirm()
  const uid = useId()
  const showBalance = Boolean(balanceCol) && !readOnly
  const update = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  // a fresh voucher: the first line takes the document's default type once the document rules have loaded
  useEffect(() => {
    if (readOnly) return
    setLines((ls) =>
      ls.every((l) => !l.ac_led_id && !Number(l.dr_amt) && !Number(l.cr_amt)) ? ls.map((l, i) => ({ ...l, side: i % 2 === 0 ? firstType : opposite(firstType) })) : ls
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstType])

  const pick = (i, head) => {
    setLines((ls) => {
      const l = ls[i]
      const side = sideOf(l)
      const own = side === 'CR' ? 'cr_amt' : 'dr_amt'
      const diff = Math.round(Math.abs(sum(ls, 'dr_amt') - sum(ls, 'cr_amt')) * 100) / 100
      const next = { ...l, ac_led_id: String(head.id), side }
      if (!(Number(l[own]) > 0) && diff > 0) {
        next[own] = diff // legacy: a head with no amount yet gets the balancing difference
        next.auto = true
      }
      return ls.map((x, idx) => (idx === i ? next : x))
    })
    setTimeout(() => document.getElementById(`${uid}-amt-${i}`)?.focus?.(), 60)
  }

  const setSide = (i, side) => setLines((ls) => tallyLines(ls.map((l, idx) => (idx === i ? { ...l, side, auto: false, [side === 'CR' ? 'dr_amt' : 'cr_amt']: 0 } : l)), i))
  const setAmount = (i, side, v) =>
    setLines((ls) =>
      tallyLines(
        ls.map((l, idx) => {
          if (idx !== i) return l
          const amount = v === '' || v == null ? 0 : v
          // both columns are open: typing an amount in a column makes the line that side and clears the other amount
          return amount > 0
            ? { ...l, side, auto: false, [side === 'CR' ? 'cr_amt' : 'dr_amt']: amount, [side === 'CR' ? 'dr_amt' : 'cr_amt']: 0 }
            : { ...l, [side === 'CR' ? 'cr_amt' : 'dr_amt']: 0, auto: false }
        }),
        i
      )
    )
  const totalDr = sum(lines, 'dr_amt')
  const totalCr = sum(lines, 'cr_amt')

  return (
    <Table.ScrollContainer minWidth={showBalance ? 760 : 620}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={92}>Dr / Cr</Table.Th>
            <Table.Th>Account Head</Table.Th>
            <Table.Th w={150}>Debit</Table.Th>
            <Table.Th w={150}>Credit</Table.Th>
            {showBalance && <Table.Th w={150}>Balance</Table.Th>}
            <Table.Th w={48} aria-label="Remove" />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lines.map((l, i) => {
            const side = sideOf(l)
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  <Select
                    aria-label={`Dr or Cr, line ${i + 1}`}
                    data={[{ value: 'DR', label: 'Dr' }, { value: 'CR', label: 'Cr' }]}
                    allowDeselect={false}
                    disabled={readOnly}
                    value={side}
                    onChange={(v) => v && setSide(i, v)}
                  />
                </Table.Td>
                <Table.Td miw={280}>
                  <AccountHeadSelect
                    docId={docId}
                    side={side}
                    ariaLabel={`Account head, line ${i + 1}`}
                    disabled={readOnly}
                    value={l.ac_led_id}
                    invalid={attempted && !l.ac_led_id}
                    onPick={(h) => pick(i, h)}
                    onClear={() => update(i, { ac_led_id: '' })}
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    id={side === 'DR' ? `${uid}-amt-${i}` : undefined}
                    aria-label={`Debit, line ${i + 1}`}
                    disabled={readOnly}
                    value={l.dr_amt}
                    onChange={(v) => setAmount(i, 'DR', v)}
                    decimalScale={2}
                    min={0}
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    id={side === 'CR' ? `${uid}-amt-${i}` : undefined}
                    aria-label={`Credit, line ${i + 1}`}
                    disabled={readOnly}
                    value={l.cr_amt}
                    onChange={(v) => setAmount(i, 'CR', v)}
                    decimalScale={2}
                    min={0}
                  />
                </Table.Td>
                {showBalance && <Table.Td><BalanceCell id={l.ac_led_id} /></Table.Td>}
                <Table.Td>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    size={36}
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length <= 2 || readOnly}
                    onClick={async () => {
                      if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) {
                        setLines((ls) => ls.filter((_, ri) => ri !== i))
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr>
            <Table.Th colSpan={2}>{totalsLabel}</Table.Th>
            <Table.Th className="vt-num">{formatINR(totalDr)}</Table.Th>
            <Table.Th className="vt-num">{formatINR(totalCr)}</Table.Th>
            {showBalance && <Table.Th />}
            <Table.Th />
          </Table.Tr>
        </Table.Tfoot>
      </Table>
    </Table.ScrollContainer>
  )
}
