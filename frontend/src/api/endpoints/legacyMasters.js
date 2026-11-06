import { del, get, post, put } from '../api'

// Holiday Master, Accounting Ledger Master (opening balances), Sannidhi vs Seva overview (backend/app/api/v1/legacy_masters.py)
export const listHolidays = (params) => get('/holidays', { params })
export const addHoliday = (body) => post('/holidays', body)
export const updateHoliday = (body) => put('/holidays', body)
export const deleteHoliday = (date) => del('/holidays', { params: { date } })

export const listAccLedgers = (search) => get('/acc-ledgers', { params: search ? { search } : undefined })
export const getOpening = (ledId) => get(`/acc-ledgers/${ledId}/opening`)
export const addOpening = (ledId, body) => post(`/acc-ledgers/${ledId}/opening`, body)
export const updateOpening = (ledId, opId, body) => put(`/acc-ledgers/${ledId}/opening/${opId}`, body)
export const deleteOpening = (ledId, opId) => del(`/acc-ledgers/${ledId}/opening/${opId}`)

export const sannidhiSevas = () => get('/sannidhi-sevas')
