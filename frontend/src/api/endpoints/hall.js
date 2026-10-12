import { get, post } from '../api'

export const listHalls = () => get('/halls')
export const getAvailability = (hallId, fromDate, months = 6) =>
  get(`/halls/${hallId}/availability`, { params: { from_date: fromDate, months } })
export const listBookings = (params) => get('/halls/bookings', { params })
export const getBooking = (id) => get(`/halls/bookings/${id}`)
export const createBooking = (body) => post('/halls/bookings', body)
export const addPayment = (id, body) => post(`/halls/bookings/${id}/payments`, body)
export const cancelBooking = (id, reason) => post(`/halls/bookings/${id}/cancel`, { reason })
