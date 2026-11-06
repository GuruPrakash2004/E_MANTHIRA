import { get, post } from '../api'

// Receivable / payable reports (backend/app/api/v1/party_reports.py). `kind` is "receivable" or "payable".
export const partyOptions = (kind, report) => get(`/party-reports/${kind}/options`, { params: { report } })
export const partyList = (kind, search) => get(`/party-reports/${kind}/parties`, { params: search ? { search } : undefined })
export const partyOutstanding = (kind, body) => post(`/party-reports/${kind}/party-outstanding`, body)
export const ageing = (kind, body) => post(`/party-reports/${kind}/ageing`, body)
export const paymentPlan = (body) => post('/party-reports/payable/payment-plan', body)
export const reminders = (kind, body) => post(`/party-reports/${kind}/reminders`, body)
