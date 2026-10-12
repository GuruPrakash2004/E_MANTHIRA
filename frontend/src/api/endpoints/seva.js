import { get, post, del } from '../api'

export const listSevas = (params) => get('/sevas', { params })
export const getSeva = (id) => get(`/sevas/${id}`)
export const lookupDevotee = (mobile, name) => get('/sevas/devotee', { params: { mobile, name } })
export const createSeva = (body) => post('/sevas', body)
export const cancelSeva = (id, reason) => post(`/sevas/${id}/cancel`, { reason })
export const deleteSeva = (id) => del(`/sevas/${id}`)
