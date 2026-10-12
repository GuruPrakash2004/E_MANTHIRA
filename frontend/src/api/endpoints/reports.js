import { get, post } from '../api'

export const runCompleteDay = (filters) => post('/reports/complete-day', filters)
export const runCollection = (filters) => post('/reports/collection', filters)
export const runSevaIssue = (filters) => post('/reports/seva-issue', filters)
export const runDonations = (filters) => post('/reports/donations', filters)
export const runHallBookingVoucher = (filters) => post('/reports/hall-booking-voucher', filters)
export const runGeneralLedger = (filters) => post('/reports/general-ledger', filters)

export const listCustomReports = () => get('/reports/custom')
export const getCustomReportFields = (crid) => get(`/reports/custom/${crid}/fields`)
export const runCustomReport = (crid, filters) => post(`/reports/custom/${crid}/run`, { filters })

/** "Subsidiary Reports" catalog (legacy frmRptReport, reads UtlReports). */
export const getReportCatalog = () => get('/reports/catalog')
