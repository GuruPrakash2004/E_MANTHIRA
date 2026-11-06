import { notifications } from '@mantine/notifications'
import * as alertifyApi from '../../api/endpoints/alertify'
import { dueDates, resolveTemplate } from '../../utils/alertifyPills'

/**
 * Turn a draft from the Alertify popup into real alerts: fill the <<pills>> with this bill's values, work out the due dates, send.
 *   draft   { title, description, days, dir, time }          (pills still as <<Caption>>)
 *   values  { Caption: text }                                  what each pill stands for
 *   anchors ['YYYY-MM-DD', ...]                                seva dates / event date / receipt date
 * Never throws: the bill is already saved, so a failure is a warning with the reason.
 */
export async function sendAlert({ draft, values, anchors }) {
  const title = resolveTemplate(draft.title, values)
  const description = resolveTemplate(draft.description, values)
  const due = dueDates(anchors, draft.days, draft.dir, draft.time)
  if (!title) return notifications.show({ title: 'Alertify', message: 'The alert has no title, so nothing was created', color: 'yellow' })
  if (!due.length) return notifications.show({ title: 'Alertify', message: 'There is no date to set the alert on', color: 'yellow' })
  try {
    const r = await alertifyApi.createAlerts({ title, description, remind_days: draft.dir === 'on' ? 0 : Number(draft.days) || 0, items: due.map((d) => ({ due_date: d.date, time: d.time })) })
    const n = r.created.length
    const skip = r.skipped.length
    notifications.show({
      title: 'Alertify',
      message: n ? `${n} alert${n > 1 ? 's' : ''} created${skip ? ` (${skip} skipped: already there)` : ''}` : (skip ? 'Those alerts already exist, so nothing new was created' : 'No alert was created. Reload the page and try again'),
      color: n ? 'teal' : 'yellow',
    })
    return r
  } catch (e) {
    notifications.show({ title: 'Alertify: alert not created', message: e?.response?.data?.detail || e?.message || 'Could not reach Alertify', color: 'orange', autoClose: 9000 })
    return null
  }
}

const KEY = (docId, user) => `alertify:${docId}:${user || ''}`
export function loadDraft(docId, user) {
  try { return JSON.parse(localStorage.getItem(KEY(docId, user)) || 'null') } catch { return null }
}
export function saveDraft(docId, user, d) {
  try { localStorage.setItem(KEY(docId, user), JSON.stringify(d)) } catch { /* private window: the popup still works */ }
}
