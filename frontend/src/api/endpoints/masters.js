import { get, post, put, del } from '../api'

export const listMaster = (docId, params) => get(`/masters/${docId}`, { params })
export const getMasterRow = (docId, rowId) => get(`/masters/${docId}/${rowId}`)
export const createMasterRow = (docId, values) => post(`/masters/${docId}`, values)
export const updateMasterRow = (docId, rowId, values) => put(`/masters/${docId}/${rowId}`, values)
export const deleteMasterRow = (docId, rowId) => del(`/masters/${docId}/${rowId}`)
