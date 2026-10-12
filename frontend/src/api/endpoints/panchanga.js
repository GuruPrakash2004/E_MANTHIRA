import { del, get, put } from '../api'

export const listPanchanga = (fromDate, toDate) => get('/panchanga', { params: { from_date: fromDate, to_date: toDate } })
export const setPanchangaDay = (date, name) => put('/panchanga', { date, name })
export const deletePanchangaDay = (date) => del(`/panchanga/${date}`)
