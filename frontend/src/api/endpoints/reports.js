import { api, get, post, put } from '../api'

export const runCompleteDay = (filters) => post('/reports/complete-day', filters)
export const runCollection = (filters) => post('/reports/collection', filters)
export const runSevaIssue = (filters) => post('/reports/seva-issue', filters)
export const runDonations = (filters) => post('/reports/donations', filters)
export const runHallBookingVoucher = (filters) => post('/reports/hall-booking-voucher', filters)
export const runGeneralLedger = (filters) => post('/reports/general-ledger', filters)

export const listCustomReports = () => get('/reports/custom')
export const getCustomReportFields = (crid) => get(`/reports/custom/${crid}/fields`)
export const customFilterValues = (crid, params) => get(`/reports/custom/${crid}/filter-values`, { params })
export const runCustomReport = (crid, body) => post(`/reports/custom/${crid}/run`, body)
export const exportCustomReport = (crid, body) => api.post(`/reports/custom/${crid}/export`, body, { responseType: 'blob' }).then((r) => r.data)
export const emailCustomReport = (crid, body) => post(`/reports/custom/${crid}/email`, body)
export const customRightsUsers = () => get('/reports/custom/rights/users')
export const customRights = (userId) => get(`/reports/custom/rights/${userId}`)
export const saveCustomRights = (userId, ids) => put(`/reports/custom/rights/${userId}`, { rpt_ids: ids })

/** "Subsidiary Reports" catalog (legacy frmRptReport, reads UtlReports). */
export const getReportCatalog = () => get('/reports/catalog')
export const hallVoucherBookings = (params) => get('/reports/hall-booking-voucher/bookings', { params })
export const catalogUsers = () => get('/reports/catalog/users')
export const catalogRights = (userId) => get(`/reports/catalog/rights/${userId}`)
export const saveCatalogRights = (userId, rptIds) => put(`/reports/catalog/rights/${userId}`, { rpt_ids: rptIds })
export const partyGlAccounts = (kind) => get('/reports/party-gl/accounts', { params: { kind } })
export const runPartyGl = (body) => post('/reports/party-gl', body)
