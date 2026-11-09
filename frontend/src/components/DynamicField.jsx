import { useEffect, useRef } from 'react'
import { Autocomplete, NumberInput, Select, TextInput, Textarea, Tooltip } from '@mantine/core'
import { DateInput } from './ui/AppDates'
import { useQuery } from '@tanstack/react-query'
import LookupSelect from './LookupSelect'
import AddressLines from './ui/AddressLines'
import * as metaApi from '../api/endpoints/meta'
import { applyTextRules, dateBounds, fieldDefault, fieldListOptions, inputAlignment, numberBounds } from '../utils/docFieldConditions'

/**
 * Renders ONE UtlDocDsgrFlds field with the right widget for its FldDataType/FldCmbTblName — the shared rendering
 * core behind MasterPage's designer fields and the dynamic transaction-screen engine (DocFieldsForm). Honours the
 * Designer's presentation rules too: text case / string type / disallowed characters, alignment, tooltip,
 * "no negative" and number / date ranges, and "refill" (type a new value or pick one used before).
 * `required` is passed in by the caller (already resolved via `isFieldMandatory`, which may be a live condition).
 */
function FieldWidget({ docId, field, value, onChange, required, locked = false, error, ctx, onBlur, noSeed = false, compact = false, allowedValues, noAddressLines = false, singleAddress = false }) {
  // compact = a grid cell: no caption above, the caption becomes the accessible name
  const label = compact ? undefined : field.FldCaption
  const aria = compact ? field.FldCaption : undefined
  const size = compact ? 'xs' : undefined
  const isRequired = required ?? field.FldBlnMandatory === 'Y'
  const readOnly = field.FldBlnReadOnly === 'Y' || locked
  const maxLength = field.FldDataWidth || undefined
  const align = inputAlignment(field)
  // Designer row colour (a VB BGR colour; negative values are system colours = the default) and bold
  const fg = Number(field.FldRowClrForeColour)
  const rowColor = field.FldBlnRowClr === 'Y' && Number.isFinite(fg) && fg >= 0 ? `rgb(${fg & 255}, ${(fg >> 8) & 255}, ${(fg >> 16) & 255})` : undefined
  const bold = field.FldBlnFontBold === 'Y' || field.FldRowClrFontBold === 'Y'
  const inputStyle = { ...(align ? { textAlign: align } : {}), ...(rowColor ? { color: rowColor } : {}), ...(bold ? { fontWeight: 700 } : {}) }
  const alignStyles = Object.keys(inputStyle).length ? { input: inputStyle } : undefined
  const isCombo = field.FldBlnComboData === 'Y' && field.FldCmbTblName
  const refill = field.FldBlnRefill === 'Y' && !isCombo && field.FldDataType !== 'Numeric' && field.FldDataType !== 'Date'

  // "Refill": values already used in this field before (distinct), offered as suggestions next to any fixed list.
  const { data: refillValues } = useQuery({
    queryKey: ['refill', docId, field.FldCode],
    queryFn: () => metaApi.getRefill(docId, field.FldCode),
    enabled: Boolean(refill && docId),
    staleTime: 60_000,
  })

  // Seed the legacy Designer's static default (FldUseDefault/FldDefStdDefault) once, the first time this field
  // appears with no value yet. Never overwrites a value already loaded from an existing record.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || noSeed) return
    seeded.current = true
    if (value === undefined || value === null || value === '') {
      const def = fieldDefault(field)
      if (def !== undefined) onChange(def)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.FldCode])

  const common = { label, 'aria-label': aria, size, required: isRequired, disabled: readOnly, error, onBlur }

  function body() {
    if (isCombo) {
      return <LookupSelect docId={docId} field={field.FldCode} label={label} ariaLabel={aria} required={isRequired} disabled={readOnly} value={value ?? ''} onChange={onChange} error={error} ctx={ctx} onBlur={onBlur} allowedValues={allowedValues} />
    }
    // singleAddress (the Donation screen): one box instead of stacked lines. It grows with the text, so an address that has several
    // lines from the old EXE stays fully visible; it is still stored as one value.
    if (!compact && singleAddress && !noAddressLines && /^ADDRESS?$/i.test(field.FldCode) && field.FldDataType !== 'Numeric' && field.FldDataType !== 'Date') {
      return <Textarea {...common} autosize minRows={1} maxRows={3} maxLength={maxLength} placeholder="Address" value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />
    }
    // An address column (Seva ADDRES, Donation / Hall / Asset ADDRESS): stacked address lines, stored as one multi-line value.
    if (!compact && !noAddressLines && /^ADDRESS?$/i.test(field.FldCode) && field.FldDataType !== 'Numeric' && field.FldDataType !== 'Date') {
      return <AddressLines label={label} value={value} onChange={(v) => onChange(v)} readOnly={readOnly} required={isRequired} error={error} maxLength={maxLength} onBlur={onBlur} />
    }
    const listOptions = fieldListOptions(field)
    if (refill) {
      const data = [...new Set([...(listOptions || []), ...(refillValues || [])])]
      return <Autocomplete {...common} data={data} maxLength={maxLength} value={value || ''} onChange={(v) => onChange(applyTextRules(field, v))} styles={alignStyles} />
    }
    if (listOptions) {
      return <Select {...common} data={listOptions} value={value || null} onChange={(v) => onChange(v || '')} />
    }
    if (field.FldDataType === 'Numeric') {
      const b = numberBounds(field)
      if (!Number(field.FldNumDecimals)) {
        // whole numbers (mobile no., counts): digits only, kept as text so leading zeros survive
        return (
          <TextInput
            {...common}
            inputMode="numeric"
            maxLength={maxLength}
            value={value ?? ''}
            onChange={(e) => onChange(e.currentTarget.value.replace(/\D/g, ''))}
            styles={alignStyles}
          />
        )
      }
      return (
        <NumberInput
          {...common}
          decimalScale={field.FldNumDecimals || 0}
          hideControls
          min={b.min}
          max={b.max}
          allowNegative={b.allowNegative}
          value={value ?? ''}
          onChange={onChange}
          styles={alignStyles}
        />
      )
    }
    if (field.FldDataType === 'Date') {
      const d = dateBounds(field)
      return (
        <DateInput
          {...common}
          valueFormat="DD-MMM-YYYY"
          clearable={!isRequired}
          minDate={d.minDate}
          maxDate={d.maxDate}
          value={value ? new Date(value) : null}
          onChange={onChange}
        />
      )
    }
    if (field.FldTxtBlnMultiLine === 'Y') {
      return <Textarea {...common} maxLength={maxLength} value={value || ''} onChange={(e) => onChange(applyTextRules(field, e.currentTarget.value))} styles={alignStyles} />
    }
    return <TextInput {...common} maxLength={maxLength} value={value || ''} onChange={(e) => onChange(applyTextRules(field, e.currentTarget.value))} styles={alignStyles} />
  }

  const widget = body()
  return field.FldToolTip ? (
    <Tooltip label={field.FldToolTip} multiline w={260} withArrow openDelay={300}>
      <div>{widget}</div>
    </Tooltip>
  ) : (
    widget
  )
}

/**
 * Legacy colour convention (from the vTemple7 screens): a red caption marks a mandatory field, blue marks a
 * read-only one. Both come from UtlDocDsgrFlds (FldBlnMandatory / conditions, FldBlnReadOnly), never hard-coded.
 */
export default function DynamicField(props) {
  const { field, required, locked } = props
  const isRequired = required ?? field.FldBlnMandatory === 'Y'
  const intrinsicReadOnly = field.FldBlnReadOnly === 'Y'
  const bold = field.FldBlnFontBold === 'Y' || field.FldRowClrFontBold === 'Y'
  return (
    <div
      style={bold ? { display: 'contents', fontWeight: 700 } : { display: 'contents' }}
      className={`${isRequired ? 'vt-fld-required' : ''} ${intrinsicReadOnly ? 'vt-fld-readonly' : ''}`}
      data-locked={locked || undefined}
    >
      <FieldWidget {...props} />
    </div>
  )
}
