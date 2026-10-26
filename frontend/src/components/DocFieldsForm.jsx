import { useEffect, useRef } from 'react'
import { Grid, Text } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import DynamicField from './DynamicField'
import useDocFields from '../hooks/useDocFields'
import * as metaApi from '../api/endpoints/meta'
import { fieldDefault, fieldListOptions, isFieldHidden, isFieldMandatory, isReadOnlyByCondition, referencedCodes } from '../utils/docFieldConditions'
import { withComputed } from '../utils/docCompute'

/**
 * Renders a document's entry fields straight from its UtlDocDsgrFlds rows: which fields exist, their order,
 * captions, widgets, lists, defaults, hide / read-only / mandatory rules (live, against the current values) and
 * dependent lookups / pick-ups. Nothing about any field is written in the screen itself (CLAUDE.md rule 5) — a
 * field missing from the temple's Designer simply does not appear.
 *
 * `values` is keyed by FldCode. `setValue(code, value)` updates one key. `resetKey` re-applies the Designer
 * defaults (bump it after Save / New). `skip` lists codes the screen draws itself (e.g. a detail grid).
 */
export function visibleFields(fields, section, values, skip = []) {
  return fields
    .filter((f) => (f.FldSection || 'Header') === section && !skip.includes(f.FldCode) && !isFieldHidden(f, values))
    .sort((a, b) => (Number(a.FldOrderBy) || 0) - (Number(b.FldOrderBy) || 0))
}

// Moves each group's visible members next to each other (at the place of the first one) so they share a row.
function groupRows(list, rowGroups) {
  let out = list
  for (const codes of rowGroups) {
    const members = codes.map((c) => out.find((f) => f.FldCode === c)).filter(Boolean)
    if (members.length < 2) continue
    const at = out.indexOf(members[0])
    out = out.filter((f) => !members.includes(f))
    out.splice(at, 0, ...members)
  }
  return out
}

export default function DocFieldsForm({
  docId,
  section = 'Header',
  values,
  setValue,
  setValues,
  resetKey = 0,
  errors = {},
  skip = [],
  readOnly = false,
  onBlurField,
  computed,
  rowGroups = [],
  fieldFilters = {},
}) {
  const { fields, isLoading } = useDocFields(docId)
  const queryClient = useQueryClient()
  const latest = useRef(values)
  latest.current = values

  // Apply the Designer's static defaults (FldUseDefault / FldDefStdDefault) once per (re)start of an entry.
  useEffect(() => {
    if (!fields.length) return
    let cancelled = false
    ;(async () => {
      const defaults = {}
      for (const f of fields) {
        if ((f.FldSection || 'Header') !== section) continue
        const def = fieldDefault(f)
        if (def === undefined) continue
        const cur = latest.current?.[f.FldCode]
        if (cur !== undefined && cur !== null && cur !== '') continue
        if (f.FldBlnComboData === 'Y' && f.FldCmbTblName) {
          // a lookup default is stored as its display text ("Shri Nimishamba Sannidhi"): resolve it to the id
          try {
            const opts = await queryClient.fetchQuery({
              queryKey: ['lookup', docId, f.FldCode, '', null],
              queryFn: () => metaApi.getLookup(docId, f.FldCode, ''),
              staleTime: 5 * 60_000,
            })
            const hit = opts.find((o) => String(o.label).trim().toLowerCase() === def.toLowerCase())
            if (hit) defaults[f.FldCode] = Number(hit.value)
          } catch {
            /* default stays blank */
          }
        } else {
          const list = fieldListOptions(f)
          // "Cash" in the default vs "CASH" in its own list: keep the list's spelling
          defaults[f.FldCode] = (list && list.find((o) => o.toLowerCase() === def.toLowerCase())) || def
        }
      }
      if (cancelled || !Object.keys(defaults).length) return
      if (setValues) setValues((v) => ({ ...defaults, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x != null)) }))
      else Object.entries(defaults).forEach(([k, val]) => setValue(k, val))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, fields, resetKey, section])

  // A changed field may drive others: clear dependent lookups, then run any pick-up that follows this field.
  async function onChange(code, value) {
    setValue(code, value)
    const next = { ...latest.current, [code]: value }
    for (const f of fields) {
      if (f.FldCode === code) continue
      const dependsCombo = referencedCodes(f.FldCmbAddnlCond).includes(code)
      const after = referencedCodes(f.FldPickUPAfterFld || f.FldPickUP)
      const pickup = f.FldPickUP && after.includes(code)
      if (dependsCombo) setValue(f.FldCode, '')
      if (pickup && value !== '' && value != null) {
        try {
          const r = await metaApi.getPickup(docId, f.FldCode, next)
          if (r?.value != null) setValue(f.FldCode, r.value)
        } catch {
          /* leave the field as it is */
        }
      }
    }
  }

  if (isLoading) return null
  // formula results (totals, words, user code ...) shown in their read-only fields; the screen computes them
  const shown = computed ? withComputed(fields, values, computed) : values
  const list = groupRows(visibleFields(fields, section, shown, skip), rowGroups)
  if (!list.length) return null
  // fields the screen wants side by side (e.g. Gothra / Nakshatra / Rashi): each takes an equal share of one row
  const shareOf = (code) => {
    const g = rowGroups.find((codes) => codes.includes(code))
    const n = g ? g.filter((c) => list.some((f) => f.FldCode === c)).length : 0
    return n > 1 ? Math.floor(12 / n) : 0
  }

  return (
    <Grid>
      {list.map((f) => {
        const ctx = referencedCodes(f.FldCmbAddnlCond).reduce((acc, c) => ({ ...acc, [c]: shown[c] ?? '' }), null)
        const wide = f.FldTxtBlnMultiLine === 'Y' || Number(f.FldDataWidth) >= 400
        return (
          <Grid.Col key={f.FldCode} span={shareOf(f.FldCode) ? { base: 12, sm: shareOf(f.FldCode) } : { base: 12, sm: wide ? 12 : 6, xl: wide ? 12 : 4 }}>
            <DynamicField
              docId={docId}
              field={f}
              value={shown[f.FldCode]}
              onChange={(v) => onChange(f.FldCode, v)}
              required={isFieldMandatory(f, shown)}
              locked={readOnly || isReadOnlyByCondition(f, shown)}
              noSeed
              error={errors[f.FldCode]}
              ctx={ctx}
              allowedValues={fieldFilters[f.FldCode]}
              onBlur={onBlurField ? () => onBlurField(f.FldCode) : undefined}
            />
          </Grid.Col>
        )
      })}
    </Grid>
  )
}

/** `{ FldCode: message }` for every visible mandatory field that is still empty (all sections). */
export function docFieldErrors(fields, values, skip = []) {
  const errors = {}
  for (const f of fields) {
    if (skip.includes(f.FldCode) || isFieldHidden(f, values) || !isFieldMandatory(f, values)) continue
    const v = values[f.FldCode]
    if (v === undefined || v === null || String(v).trim() === '' || (f.FldBlnComboData === 'Y' && Number(v) === 0)) {
      errors[f.FldCode] = `${f.FldCaption || f.FldCode} is required`
    }
  }
  return errors
}

/** Caption for messages — the Designer's, never a hard-coded one. */
export function captionOf(fields, code) {
  return fields.find((f) => f.FldCode === code)?.FldCaption || code
}

export function NoFieldsNotice({ name }) {
  return (
    <Text size="sm" c="dimmed">
      {name} has no fields configured in the Doc Designer.
    </Text>
  )
}
