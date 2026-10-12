import { del, get } from '../api'

export const getAuditFilters = () => get('/audit-log/filters')
export const listAuditLog = (params) => get('/audit-log', { params })
export const purgeAuditLog = (before) => del('/audit-log', { params: { before } })
