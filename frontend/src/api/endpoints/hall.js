import { del, get, post } from '../api'

export const listHalls = () => get('/halls')
export const getAvailability = (hallId, fromDate, months = 6, toDate) =>
  get(`/halls/${hallId}/availability`, { params: { from_date: fromDate, months, to_date: toDate } })
export const listBookings = (params) => get('/halls/bookings', { params })
export const getBooking = (id) => get(`/halls/bookings/${id}`)
export const createBooking = (body) => post('/halls/bookings', body)
export const addPayment = (id, body) => post(`/halls/bookings/${id}/payments`, body)
export const cancelBooking = (id, reason) => post(`/halls/bookings/${id}/cancel`, { reason })
export const deleteReceipt = (id, receiptId) => del(`/halls/bookings/${id}/receipts/${receiptId}`)
export const bookingOptions = () => get('/halls/booking-options')
