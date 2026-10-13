import { get, post, del } from '../api'

export const listPaymentVouchers = (params) => get('/vouchers/payments', { params })
export const createPaymentVoucher = (body) => post('/vouchers/payments', body)
export const cancelPaymentVoucher = (id, reason) => post(`/vouchers/payments/${id}/cancel`, { reason })
export const deletePaymentVoucher = (id) => del(`/vouchers/payments/${id}`)

export const listReceiptVouchers = (params) => get('/vouchers/receipts', { params })
export const createReceiptVoucher = (body) => post('/vouchers/receipts', body)
export const cancelReceiptVoucher = (id, reason) => post(`/vouchers/receipts/${id}/cancel`, { reason })
export const deleteReceiptVoucher = (id) => del(`/vouchers/receipts/${id}`)

export const listJournalVouchers = (params) => get('/vouchers/journals', { params })
export const createJournalVoucher = (body) => post('/vouchers/journals', body)
export const cancelJournalVoucher = (id, reason) => post(`/vouchers/journals/${id}/cancel`, { reason })
export const deleteJournalVoucher = (id) => del(`/vouchers/journals/${id}`)

export const getVoucher = (kind, id) => get(`/vouchers/${kind}/${id}`)
