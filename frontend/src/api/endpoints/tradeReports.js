import { get } from '../api'

// Trading-module reports still listed in the legacy menu (backend: api/v1/trading_reports.py).
export const getAvailability = () => get('/trade-reports/availability')
export const getStockLevelTemplates = () => get('/trade-reports/stock-level/templates')
export const getStockLevel = (params) => get('/trade-reports/stock-level', { params })
export const getStockAgeing = (params) => get('/trade-reports/stock-ageing', { params })
export const getPartyOutstanding = (params) => get('/trade-reports/party-outstanding', { params })
export const getPartyOutstandingDetail = (params) => get('/trade-reports/party-outstanding-detail', { params })
