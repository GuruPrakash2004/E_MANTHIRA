import { useEffect, useMemo, useRef, useState } from 'react'
import { Grid, Text } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import DynamicField from './DynamicField'
import useDocFields from '../hooks/useDocFields'
import * as metaApi from '../api/endpoints/meta'
import { fieldDefault, fieldListOptions, isFieldHidden, isFieldMandatory, isReadOnlyByCondition, referencedCodes, comboDependencies } from '../utils/docFieldConditions'
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
  inlineLabels,
}) {
  const { fields, isLoading } = useDocFields(docId)
  const queryClient = useQueryClient()
  const latest = useRef(values)
  latest.current = values

  // Nakshatra -> Rashi: each Nakshatra field is paired with its Rashi field (the "Sec..." pair together, otherwise in order).
  // The nakshatra master stores one or two rashis; one fills the Rashi in, two limit the Rashi list to those two.
  const nakPairs = useMemo(() => {
    const tbl = (f) => String(f.FldCmbTblName || '').trim().toUpperCase()
    const naks = fields.filter((f) => f.FldBlnComboData === 'Y' && tbl(f) === 'MSTNAKSHATRA')
    const rashis = fields.filter((f) => f.FldBlnComboData === 'Y' && tbl(f) === 'MSTRASHI')
    const sec = (f) => /^SEC/i.test(f.FldCode)
    return naks
      .map((n, i) => ({ nak: n.FldCode, rashi: (rashis.find((r) => sec(r) === sec(n)) || rashis[i])?.FldCode }))
      .filter((p) => p.rashi)
  }, [fields])
  const [rashiAllowed, setRashiAllowed] = useState({})
  const rashiIds = (nakId) =>
    queryClient.fetchQuery({ queryKey: ['nak-rashis', Number(nakId)], queryFn: () => metaApi.getNakshatraRashis(Number(nakId)), staleTime: 10 * 60_000 }).then((r) => (r || []).map((x) => Number(x.value)))
  const nakKey = nakPairs.map((p) => `${p.nak}:${values?.[p.nak] ?? ''}`).join('|')
  useEffect(() => {
    let off = false
    ;(async () => {
      const next = {}
      for (const p of nakPairs) {
        const v = Number(values?.[p.nak])
        if (!v) continue
        try {
          const ids = await rashiIds(v)
          if (ids.length) next[p.rashi] = ids
        } catch {
          /* no link: the Rashi list stays unrestricted */
        }
      }
      if (!off) setRashiAllowed(next)
    })()
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nakKey])

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
              staleTime: 30_000,
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
      const dependsCombo = comboDependencies(f).includes(code) // changing the Sannidhi clears the Seva (legacy), a Nakshatra clears the Rashi ...
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
    const pair = nakPairs.find((p) => p.nak === code)
    if (pair && Number(value) > 0) {
      try {
        const ids = await rashiIds(value)
        if (ids.length === 1) setValue(pair.rashi, ids[0]) // a single rashi fills itself in
        else if (ids.length > 1 && !ids.includes(Number(latest.current?.[pair.rashi]))) setValue(pair.rashi, '') // two: the person picks one
      } catch {
        /* leave the Rashi as it is */
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

  // Header = the main block. Footer / Total / Detail are "additional information": one column, caption left, value right.
  // Footer / Total / Detail blocks default to caption-left rows; a block that shares a card with the Header fields keeps the normal grid (inlineLabels={false})
  const inline = inlineLabels ?? section !== 'Header'
  return (
    <Grid className={inline ? 'vt-inline-fields' : undefined}>
      {list.map((f) => {
        const ctx = comboDependencies(f).reduce((acc, c) => ({ ...acc, [c]: shown[c] ?? '' }), null)
        const wide = f.FldTxtBlnMultiLine === 'Y' || Number(f.FldDataWidth) >= 400
        return (
          <Grid.Col key={f.FldCode} span={inline ? 12 : shareOf(f.FldCode) ? { base: 12, sm: shareOf(f.FldCode) } : { base: 12, sm: wide ? 12 : 6, xl: wide ? 12 : 4 }}>
            <DynamicField
              docId={docId}
              field={f}
              value={shown[f.FldCode]}
              onChange={(v) => onChange(f.FldCode, v)}
              required={isFieldMandatory(f, shown)}
              locked={readOnly || isReadOnlyByCondition(f, shown)}
              noSeed
              noAddressLines={fields.some((x) => /^ADD[2-4]$/i.test(x.FldCode))} // the designer already splits the address into lines
              error={errors[f.FldCode]}
              ctx={ctx}
              allowedValues={rashiAllowed[f.FldCode] || fieldFilters[f.FldCode]}
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
