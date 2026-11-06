import { useMemo, useState } from 'react'
import { Select, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as voucherApi from '../../api/endpoints/voucher'

/**
 * Account Head picker of a voucher line (legacy frmTrnVch). The list is what the document allows for the line's Dr / Cr side
 * (ledger groups in UtlAccAmtTypeLedGrps and their children; ledgers, suppliers, customers), searched by name, with the
 * group shown under each name. Choosing an unapproved party is refused with the legacy message.
 * `onPick({ id, label, group })` is called only for a usable head.
 */
export default function AccountHeadSelect({ docId, side, value, onPick, onClear, disabled, ariaLabel, invalid }) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 250)
  const { data: current } = useQuery({ queryKey: ['account-head', value], queryFn: () => voucherApi.getAccountHead(value), enabled: Boolean(value), staleTime: 10_000 })
  // while the box still shows the chosen head's own name, list everything (like the legacy combo) instead of filtering on it
  const q = current?.label && search === current.label ? '' : debounced
  const { data } = useQuery({
    queryKey: ['account-heads', docId, side, q],
    queryFn: () => voucherApi.getAccountHeads(docId, side, q),
    enabled: !disabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const items = data?.items || []
  const byValue = useMemo(() => {
    const m = new Map(items.map((i) => [String(i.value), i]))
    if (value && current?.found && !m.has(String(value))) m.set(String(value), { value, label: current.label, group: current.group, approved: true })
    return m
  }, [items, value, current])
  const options = useMemo(() => [...byValue.values()].map((i) => ({ value: String(i.value), label: i.label })), [byValue])

  return (
    <Select
      aria-label={ariaLabel}
      searchable
      clearable
      disabled={disabled}
      error={invalid ? ' ' : undefined}
      data={options}
      value={value ? String(value) : null}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: o }) => o} // the server already filtered by the typed text
      nothingFoundMessage="No account head found"
      placeholder="Search account head"
      maxDropdownHeight={320}
      comboboxProps={{ width: 380, position: 'bottom-start' }}
      renderOption={({ option }) => (
        <div>
          <Text size="sm">{option.label}</Text>
          {byValue.get(option.value)?.group ? <Text size="xs" c="dimmed">{byValue.get(option.value).group}</Text> : null}
        </div>
      )}
      onChange={(v) => {
        if (!v) {
          onClear?.()
          return
        }
        const item = byValue.get(v)
        if (item && item.approved === false) {
          notifications.show({ message: `Selected Party [${item.label}] Not Approved....`, color: 'orange' })
          return
        }
        onPick({ id: Number(v), label: item?.label || '', group: item?.group || '' })
      }}
    />
  )
}
