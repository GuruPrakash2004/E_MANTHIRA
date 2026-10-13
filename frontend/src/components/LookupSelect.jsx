import { memo, useMemo, useState } from 'react'
import { Select } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as metaApi from '../api/endpoints/meta'

/**
 * A name-based dropdown for any foreign-key field, sourced live from the
 * same UtlDocDsgrFlds combo metadata (table/display-column/filter) the
 * legacy Windows screens use — never a hard-coded list. Pass `docId` +
 * `field` (the FldCode, e.g. "SANNIDHIID") to resolve it that way, or
 * `ledgerPicker` for the generic MstLed picker used by voucher screens
 * whose Dr/Cr lines aren't tied to one specific document field.
 */
function LookupSelect({ docId, field, ledgerPicker, label, ariaLabel, required, value, onChange, disabled, error }) {
  const [typed, setTyped] = useState('')
  // One request per pause in typing, not one per keystroke.
  const [search] = useDebouncedValue(typed, 250)

  const { data, isLoading } = useQuery({
    queryKey: ledgerPicker ? ['lookup-ledgers', search] : ['lookup', docId, field, search],
    queryFn: () => (ledgerPicker ? metaApi.getLedgers(search) : metaApi.getLookup(docId, field, search)),
    enabled: ledgerPicker ? true : Boolean(docId && field),
    placeholderData: keepPreviousData,
    staleTime: search ? 30_000 : 5 * 60_000, // the unfiltered list rarely changes
  })

  const options = useMemo(() => (data || []).map((o) => ({ value: String(o.value), label: o.label })), [data])

  return (
    <Select
      label={label}
      aria-label={ariaLabel}
      required={required}
      disabled={disabled}
      error={error}
      searchable
      clearable
      clearButtonProps={{ 'aria-label': `Clear ${label || ariaLabel || 'selection'}` }}
      data={options}
      value={value !== '' && value != null ? String(value) : null}
      onChange={(v) => onChange(v === null ? '' : Number(v))}
      onSearchChange={setTyped}
      nothingFoundMessage={isLoading ? 'Loading...' : 'No matches'}
      placeholder="Search..."
      comboboxProps={{ withinPortal: true }}
    />
  )
}

export default memo(LookupSelect)
