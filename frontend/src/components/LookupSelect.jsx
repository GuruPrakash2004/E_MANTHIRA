import { memo } from 'react'
import { Select } from '@mantine/core'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as metaApi from '../api/endpoints/meta'
import useSelectCommit from '../hooks/useSelectCommit'

/**
 * A name-based dropdown for any foreign-key field, sourced live from the
 * same UtlDocDsgrFlds combo metadata (table/display-column/filter) the
 * legacy Windows screens use — never a hard-coded list. Pass `docId` +
 * `field` (the FldCode, e.g. "SANNIDHIID") to resolve it that way, or
 * `ledgerPicker` for the generic MstLed picker used by voucher screens
 * whose Dr/Cr lines aren't tied to one specific document field.
 */
function LookupSelect({ docId, field, ledgerPicker, label, ariaLabel, required, value, onChange, disabled, error, ctx, onBlur, allowedValues }) {
  const { options, notFound, selectProps, onBlurCheck, failed, reload } = useSelectCommit({
    selectedValue: value,
    commit: (v) => onChange(Number(v)),
    // One request per pause in typing (the hook debounces), not one per keystroke.
    useOptions: (search) => {
      const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ledgerPicker ? ['lookup-ledgers', search] : ['lookup', docId, field, search, ctx || null],
        queryFn: () => (ledgerPicker ? metaApi.getLedgers(search) : metaApi.getLookup(docId, field, search, ctx)),
        enabled: ledgerPicker ? true : Boolean(docId && field),
        placeholderData: keepPreviousData,
        retry: 1,
        staleTime: 30_000, // short: a master saved elsewhere (e.g. a new Rashi) must show up quickly
      })
      // `allowedValues` = the ids this user chose to work with (e.g. their Sannidhis); the value already on the form always stays selectable
      const keep = (o) => !allowedValues?.length || allowedValues.includes(Number(o.value)) || String(o.value) === String(value)
      return { data, loading: isLoading, failed: isError, reload: refetch, options: (data || []).filter(keep).map((o) => ({ value: String(o.value), label: o.label == null ? '' : String(o.label) })) }
    },
  })

  return (
    <Select
      label={label}
      aria-label={ariaLabel}
      required={required}
      disabled={disabled}
      error={error || (notFound ? 'Not found' : undefined)}
      onBlur={(e) => {
        onBlurCheck(e)
        onBlur?.(e)
      }}
      searchable
      clearable
      clearButtonProps={{ 'aria-label': `Clear ${label || ariaLabel || 'selection'}` }}
      data={options}
      onDropdownOpen={() => failed && reload?.()}
      value={value !== '' && value != null ? String(value) : null}
      onChange={(v) => onChange(v === null ? '' : Number(v))}
      placeholder="Search..."
      comboboxProps={{ withinPortal: true }}
      {...selectProps}
    />
  )
}

export default memo(LookupSelect)
