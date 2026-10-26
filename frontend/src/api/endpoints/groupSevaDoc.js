import { get, post } from '../api'

export const listGroups = (params) => get('/group-sevas', { params })
export const getGroup = (id) => get(`/group-sevas/${id}`)
export const createGroup = (body) => post('/group-sevas', body)
