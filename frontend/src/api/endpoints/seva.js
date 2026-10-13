import { get, post, del } from '../api'

export const listSevas = (params) => get('/sevas', { params })
export const getSeva = (id) => get(`/sevas/${id}`)
export const lookupDevotee = (mobile, name) => get('/sevas/devotee', { params: { mobile, name } })
export const createSeva = (body) => post('/sevas', body)
export const cancelSeva = (id, reason) => post(`/sevas/${id}/cancel`, { reason })
export const deleteSeva = (id) => del(`/sevas/${id}`)
export const regularDevotees = (params) => get('/sevas/regular-devotees', { params })
export const lastSeva = () => get('/sevas/last')
export const groupSevaGroups = () => get('/sevas/group-seva/groups')
export const groupSevaMembers = (grpId, sevaId) => get(`/sevas/group-seva/${grpId}/members`, { params: { seva_id: sevaId } })
export const groupSevaGenerate = (body) => post('/sevas/group-seva/generate', body)
