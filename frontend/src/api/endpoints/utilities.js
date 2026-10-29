import { api, del, download, get, post, put } from '../api'

// Authorise Documents (backend/app/api/v1/utilities.py)
export const authoriseSummary = () => get('/utilities/authorise/summary')
export const authorisePending = (docId, level) => get(`/utilities/authorise/${docId}/pending`, { params: { level } })
export const authoriseDocs = (docId, level, ids) => post(`/utilities/authorise/${docId}`, { level, ids })

// Screen Documents
export const screenDocScreens = () => get('/utilities/screen-docs/screens')
export const listScreenDocs = (screen) => get('/utilities/screen-docs', { params: { screen } })
export const addScreenDoc = ({ screen, group, remarks, file }) => {
  const form = new FormData()
  form.append('screen', screen)
  form.append('group', group)
  form.append('remarks', remarks || '')
  form.append('file', file)
  return api.post('/utilities/screen-docs', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
export const updateScreenDoc = (id, remarks) => put(`/utilities/screen-docs/${id}`, { remarks })
export const deleteScreenDoc = (id) => del(`/utilities/screen-docs/${id}`)
export const downloadScreenDoc = (id) => download(`/utilities/screen-docs/${id}/download`)

// Shared Documents (UtlSharedDocs)
export const listSharedDocs = () => get('/utilities/shared-docs')
export const addSharedDoc = ({ group, remarks, file }) => {
  const form = new FormData()
  form.append('group', group)
  form.append('remarks', remarks || '')
  form.append('file', file)
  return api.post('/utilities/shared-docs', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
export const updateSharedDoc = (id, group, remarks) => put(`/utilities/shared-docs/${id}`, { group, remarks })
export const deleteSharedDoc = (id) => del(`/utilities/shared-docs/${id}`)
export const downloadSharedDoc = (id) => download(`/utilities/shared-docs/${id}/download`)

// Reminder Alert (UtlNotify)
export const listNotifications = (box) => get('/utilities/notifications', { params: { box } })
export const searchNotifyUsers = (q) => get('/utilities/notifications/users', { params: { q } })
export const sendNotification = (body) => post('/utilities/notifications', body)
export const deleteNotification = (id) => del(`/utilities/notifications/${id}`)
export const deleteAllSentNotifications = () => del('/utilities/notifications/sent')

// ShortClose Documents
export const shortcloseDocuments = () => get('/utilities/shortclose/documents')
