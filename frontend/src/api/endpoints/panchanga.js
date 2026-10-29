import { api, del, get, post, put } from '../api'

export const listPanchanga = (fromDate, toDate) => get('/panchanga', { params: { from_date: fromDate, to_date: toDate } })
export const listPanchangaEvents = () => get('/panchanga/events')
export const setPanchangaDay = (date, names) => put('/panchanga', { date, names })
export const setPanchangaBulk = (dates, name) => put('/panchanga/bulk', { dates, name })
export const deletePanchangaDay = (date) => del(`/panchanga/${date}`)

// Import from Excel (.xls) and the Rathothsava date
export const importTemplate = () => api.get('/panchanga/import/template', { responseType: 'blob' }).then((r) => r.data)
export const importPreview = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/panchanga/import/preview', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
export const importRows = (rows) => post('/panchanga/import', rows)
export const getRathothsava = () => get('/panchanga/rathothsava')
export const saveRathothsava = (body) => put('/panchanga/rathothsava', body)
