import { api, del, download, get } from '../api'

export const listAttachments = (docId, rowId) => get(`/masters/${docId}/${rowId}/attachments`)

export const uploadAttachment = (docId, rowId, file, description) => {
  const form = new FormData()
  form.append('file', file)
  form.append('description', description || '')
  return api.post(`/masters/${docId}/${rowId}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}

/** Fetches the file as a Blob (auth header attached like print previews) and triggers a browser save. */
export async function downloadAttachment(docId, rowId, fileName) {
  const blob = await download(`/masters/${docId}/${rowId}/attachments/${encodeURIComponent(fileName)}`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.replace(/^\d+_/, '')
  a.click()
  URL.revokeObjectURL(url)
}

export const deleteAttachment = (docId, rowId, fileName) => del(`/masters/${docId}/${rowId}/attachments/${encodeURIComponent(fileName)}`)
