import { useEffect, useRef } from 'react'
import { NumberInput, Select, TextInput, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import LookupSelect from './LookupSelect'
import { fieldDefault, fieldListOptions } from '../utils/docFieldConditions'

/**
 * Renders ONE UtlDocDsgrFlds field with the right widget for its
 * FldDataType/FldCmbTblName — the shared rendering core behind both
 * MasterPage's "extra designer fields" and the dynamic transaction-screen
 * engine (useDocFields + docFieldConditions). `required` is passed in by
 * the caller (already resolved via `isFieldMandatory`, which may be a
 * live condition, not just the static FldBlnMandatory flag).
 */
export default function DynamicField({ docId, field, value, onChange, required }) {
  const isRequired = required ?? field.FldBlnMandatory === 'Y'
  const readOnly = field.FldBlnReadOnly === 'Y'
  const maxLength = field.FldDataWidth || undefined

  // Seed the legacy Designer's static default (FldUseDefault/FldDefStdDefault)
  // once, the first time this field appears with no value yet — e.g. a new
  // designer-added field on a brand-new document. Never overwrites a value
  // already loaded from an existing record.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (value === undefined || value === null || value === '') {
      const def = fieldDefault(field)
      if (def !== undefined) onChange(def)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.FldCode])

  if (field.FldCmbTblName) {
    return (
      <LookupSelect docId={docId} field={field.FldCode} label={field.FldCaption} required={isRequired} disabled={readOnly} value={value ?? ''} onChange={onChange} />
    )
  }
  const listOptions = fieldListOptions(field)
  if (listOptions) {
    return (
      <Select
        label={field.FldCaption}
        required={isRequired}
        disabled={readOnly}
        data={listOptions}
        value={value || null}
        onChange={onChange}
      />
    )
  }
  if (field.FldDataType === 'Numeric') {
    return (
      <NumberInput
        label={field.FldCaption}
        required={isRequired}
        disabled={readOnly}
        decimalScale={field.FldNumDecimals || 0}
        value={value ?? ''}
        onChange={onChange}
      />
    )
  }
  if (field.FldDataType === 'Date') {
    return <DateInput label={field.FldCaption} required={isRequired} disabled={readOnly} value={value || null} onChange={onChange} />
  }
  if (field.FldTxtBlnMultiLine === 'Y') {
    return (
      <Textarea
        label={field.FldCaption}
        required={isRequired}
        disabled={readOnly}
        maxLength={maxLength}
        value={value || ''}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    )
  }
  return (
    <TextInput
      label={field.FldCaption}
      required={isRequired}
      disabled={readOnly}
      maxLength={maxLength}
      value={value || ''}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}
