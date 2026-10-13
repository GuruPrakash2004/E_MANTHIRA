import { useMemo, useState } from 'react'
import { Autocomplete, Checkbox, NumberInput, Select, Textarea, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as mastersApi from '../../api/endpoints/masters'

/**
 * One built-in master field described by GET /masters/{doc}/layout (see backend app/meta/master_layouts.py):
 * text / textarea / numeric / flag (Y/N) / list / lookup. Red caption = mandatory, blue = read-only (legacy convention).
 * `onChange(value, option)` — for a lookup the chosen option is passed too, so dependent fields can be filled.
 */
export default function CoreField({ docId, field, value, onChange, locked }) {
  const cls = `${field.required ? 'vt-fld-required' : ''} ${field.readonly ? 'vt-fld-readonly' : ''}`.trim() || undefined
  const readOnly = locked || field.readonly
  const label = field.caption || undefined
  const aria = field.caption || undefined

  const [typed, setTyped] = useState('')
  const [search] = useDebouncedValue(typed, 250)
  const isLookup = field.type === 'lookup' || field.type === 'combo'
  const { data: found = [], isLoading } = useQuery({
    queryKey: ['master-core-lookup', docId, field.code, search],
    queryFn: () => mastersApi.coreLookup(docId, field.code, search),
    enabled: isLookup,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  // keep the saved value selectable even when the typed search filtered it out of the list
  const options = useMemo(() => found.map((o) => ({ value: String(o.value), label: o.label })), [found])

  if (field.type === 'flag') {
    return <Checkbox className={cls} color="kumkum" label={label} disabled={readOnly} checked={(value || 'N').toUpperCase() === 'Y'} onChange={(e) => onChange(e.currentTarget.checked ? 'Y' : 'N')} />
  }
  if (field.type === 'textarea') {
    return <Textarea className={cls} label={label} aria-label={aria} required={field.required} readOnly={readOnly} autosize minRows={2} maxLength={field.width || undefined} value={value || ''} onChange={(e) => onChange(e.currentTarget.value)} />
  }
  if (field.type === 'numeric') {
    return <NumberInput className={cls} label={label} aria-label={aria} required={field.required} readOnly={readOnly} value={value ?? ''} onChange={onChange} />
  }
  if (field.type === 'list') {
    return <Select className={cls} label={label} aria-label={aria} required={field.required} disabled={readOnly} data={field.options || []} value={value || null} onChange={(v) => onChange(v || '')} clearable />
  }
  if (field.type === 'combo') {
    // free text, with the values already in the master suggested (e.g. Country on State City Country)
    return <Autocomplete className={cls} label={label} aria-label={aria} required={field.required} disabled={readOnly} data={options.map((o) => o.label)} value={value || ''} onChange={(v) => onChange(v)} />
  }
  if (isLookup) {
    return (
      <Select
        className={cls}
        label={label}
        aria-label={aria}
        required={field.required}
        disabled={readOnly}
        searchable
        clearable
        data={options}
        value={value !== '' && value != null ? String(value) : null}
        onChange={(v) => {
          const opt = found.find((o) => String(o.value) === v)
          const isNumericKey = found.length > 0 && typeof found[0].value === 'number'
          onChange(v === null ? (isNumericKey ? 0 : '') : opt ? opt.value : v, opt)
        }}
        onSearchChange={setTyped}
        nothingFoundMessage={isLoading ? 'Loading...' : 'No matches'}
        placeholder="Search..."
        comboboxProps={{ withinPortal: true }}
      />
    )
  }
  return <TextInput className={cls} label={label} aria-label={aria} required={field.required} readOnly={readOnly} maxLength={field.width || undefined} value={value || ''} onChange={(e) => onChange(e.currentTarget.value)} />
}
