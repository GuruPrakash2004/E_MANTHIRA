import { get, post, del } from '../api'

export const listHbe = (params) => get('/hall-booking-entry', { params })
export const getHbe = (id) => get(`/hall-booking-entry/${id}`)
export const createHbe = (body) => post('/hall-booking-entry', body)
export const deleteHbe = (id) => del(`/hall-booking-entry/${id}`)
