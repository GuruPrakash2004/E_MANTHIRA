import { get, post } from '../api'

// Voucher Listing + Day Book (backend/app/api/v1/acc_reports.py)
export const voucherListingOptions = () => get('/acc-reports/voucher-listing/options')
export const voucherListingDoc = (docId) => get(`/acc-reports/voucher-listing/docs/${docId}`)
export const voucherListingLedgers = (search) => get('/acc-reports/voucher-listing/ledgers', { params: search ? { search } : undefined })
export const runVoucherListing = (body) => post('/acc-reports/voucher-listing/run', body)

export const dayBookOptions = () => get('/acc-reports/day-book/options')
export const runDayBook = (body) => post('/acc-reports/day-book/run', body)

export const profitMarginDefinitions = () => get('/acc-reports/profit-margin/definitions')
export const profitMarginItems = (search) => get('/acc-reports/profit-margin/items', { params: search ? { search } : undefined })
export const runProfitMargin = (body) => post('/acc-reports/profit-margin/run', body)
