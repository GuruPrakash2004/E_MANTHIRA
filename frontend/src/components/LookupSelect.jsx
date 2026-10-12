import { useState } from 'react'
import { Select } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../api/endpoints/meta'

/**
 * A name-based dropdown for any foreign-key field, sourced live from the
 * same UtlDocDsgrFlds combo metadata (table/display-column/filter) the
 * legacy Windows screens use — never a hard-coded list. Pass `docId` +
 * `field` (the FldCode, e.g. "SANNIDHIID") to resolve it that way, or
 * `ledgerPicker` for the generic MstLed picker used by voucher screens
 * whose Dr/Cr lines aren't tied to one specific document field.
 */
export default function LookupSelect({ docId, field, ledgerPicker, label, required, value, onChange, disabled }) {
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ledgerPicker ? ['lookup-ledgers', search] : ['lookup', docId, field, search],
    queryFn: () => (ledgerPicker ? metaApi.getLedgers(search) : metaApi.getLookup(docId, field, search)),
    enabled: ledgerPicker ? true : Boolean(docId && field),
  })

  const options = (data || []).map((o) => ({ value: String(o.value), label: o.label }))

  return (
    <Select
      label={label}
      required={required}
      disabled={disabled}
      searchable
      clearable
      data={options}
      value={value !== '' && value != null ? String(value) : null}
      onChange={(v) => onChange(v === null ? '' : Number(v))}
      onSearchChange={setSearch}
      nothingFoundMessage={isLoading ? 'Loading...' : 'No matches'}
      placeholder="Search..."
      comboboxProps={{ withinPortal: true }}
    />
  )
}
