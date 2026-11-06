import { useMemo, useRef, useState } from 'react'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as metaApi from '../../api/endpoints/meta'
import useAlertifyConfig from '../../hooks/useAlertify'
import { isFieldHidden } from '../../utils/docFieldConditions'
import { parseTiming } from '../../utils/alertifyPills'
import AlertifyModal from './AlertifyModal'
import { sendAlert } from './sendAlert'

const shownText = (v) => {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date) return dayjs(v).format('DD/MM/YYYY')
  return String(v)
}

/**
 * Everything a bill screen needs for Alertify, in one place.
 *   const al = useBillAlertify({ docId, label, user, fields, values, totals, anchors, billTime, defaultDir, valid, hint, savedNo })
 *   <DocNavBar alertify={al.nav} ... />   {al.modal}   and after the bill saves:   al.afterSave({ 'Doc No': no })
 * fields = the Designer fields (useDocFields), values = the screen's values by FldCode, totals = [{ caption, value }] (Doc No, amounts...),
 * anchors = ['YYYY-MM-DD'] the dates the alert counts from, valid = the bill's details are filled, savedNo = the number of the saved bill being viewed.
 * Saving a draft on a bill that is not saved yet keeps it and creates the alerts right after the bill saves.
 */
export default function useBillAlertify({ docId, label, user, fields, values, totals = [], anchors, billTime = null, timingCaption = null, defaultDir = 'before', valid, hint, savedNo = '' }) {
  const cfg = useAlertifyConfig()
  const [open, setOpen] = useState(false)
  const pending = useRef(null)

  const visible = useMemo(() => fields.filter((f) => f.FldCaption && !isFieldHidden(f, values)), [fields, values])
  const raw = useMemo(() => {
    const o = {}
    for (const f of visible) {
      const v = values[f.FldCode]
      if (v !== null && v !== undefined && v !== '' && !(v instanceof Date)) o[f.FldCode] = v
    }
    return o
  }, [visible, values])
  // lookups (Sannidhi, Seva, Gothra...) are held as ids; the pill must carry the name
  const { data: names } = useQuery({
    queryKey: ['alertify-display', docId, JSON.stringify(raw)],
    queryFn: () => metaApi.displayDocValues(docId, raw),
    enabled: open && Object.keys(raw).length > 0,
    staleTime: 60_000,
  })
  const fieldPills = useMemo(
    () => visible.map((f) => ({ caption: f.FldCaption.trim(), value: values[f.FldCode] instanceof Date ? shownText(values[f.FldCode]) : (names?.[f.FldCode] ?? shownText(values[f.FldCode])) })),
    [visible, values, names]
  )
  const totalPills = useMemo(() => [{ caption: 'Doc No', value: savedNo }, ...totals].filter((p, i, a) => a.findIndex((x) => x.caption === p.caption) === i), [totals, savedNo])

  // the bill's own timing (e.g. the Seva Timing field, "6:30 AM") sets the alert time when it can be read
  const timingPill = timingCaption ? fieldPills.find((p) => timingCaption.test(p.caption)) : null
  const autoTime = parseTiming(timingPill?.value) || billTime

  const snapshot = () => Object.fromEntries([...fieldPills, ...totalPills].map((p) => [p.caption, p.value]))

  async function onSubmit(draft) {
    if (savedNo) {
      await sendAlert({ draft, values: snapshot(), anchors })
    } else {
      pending.current = { draft, values: snapshot(), anchors: [...anchors] }
      notifications.show({ title: 'Alertify', message: 'The alert will be created as soon as you save this bill', color: 'violet' })
    }
    setOpen(false)
  }

  return {
    nav: {
      enabled: cfg.enabled && cfg.ready,
      ready: Boolean(valid),
      hint,
      onClick: () => (valid ? setOpen(true) : notifications.show({ title: 'Alertify', message: hint || 'Fill the bill details first', color: 'yellow' })),
    },
    modal: open ? (
      <AlertifyModal opened onClose={() => setOpen(false)} docId={docId} user={user} label={label} fields={fieldPills} totals={totalPills} anchors={anchors} billTime={autoTime} defaultTime={cfg.defaultTime} defaultDir={defaultDir} saved={Boolean(savedNo)} onSubmit={onSubmit} />
    ) : null,
    hasPending: () => Boolean(pending.current),
    /** The bill just saved: create the alerts that were waiting for it (extra pill values, e.g. the real Doc No, are filled in). */
    async afterSave(extra = {}) {
      const p = pending.current
      pending.current = null
      if (p) await sendAlert({ draft: p.draft, values: { ...p.values, ...extra }, anchors: p.anchors })
    },
    discard: () => { pending.current = null },
  }
}
