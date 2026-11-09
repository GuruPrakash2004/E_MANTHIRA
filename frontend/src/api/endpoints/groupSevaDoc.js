import { get, post, put, del } from '../api'

export const listGroups = (params) => get('/group-sevas', { params })
export const getGroup = (id) => get(`/group-sevas/${id}`)
export const createGroup = (body) => post('/group-sevas', body)
export const updateGroup = (id, body) => put(`/group-sevas/${id}`, body)
export const deleteGroup = (id) => del(`/group-sevas/${id}`)
