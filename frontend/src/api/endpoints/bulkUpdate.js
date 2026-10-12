import { get, post, put } from '../api'

export const listDefinitions = () => get('/bulk-update/definitions')
export const getDefinition = (rowId) => get(`/bulk-update/${rowId}`)
export const searchRows = (rowId, filters) => post(`/bulk-update/${rowId}/rows/search`, { filters })
export const saveRows = (rowId, rows) => put(`/bulk-update/${rowId}/rows`, { rows })
