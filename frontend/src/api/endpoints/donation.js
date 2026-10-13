import { get, post, del } from '../api'

export const listDonations = (params) => get('/donations', { params })
export const getDonation = (id) => get(`/donations/${id}`)
export const createDonation = (body) => post('/donations', body)
export const cancelDonation = (id, reason) => post(`/donations/${id}/cancel`, { reason })
export const deleteDonation = (id) => del(`/donations/${id}`)
export const lookupDonor = (contactNo) => get('/donations/donor/lookup', { params: { contact_no: contactNo } })
export const donorHistory = (params) => get('/donations/donors', { params })
export const lastDonation = () => get('/donations/last')
