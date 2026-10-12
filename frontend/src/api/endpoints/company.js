import { get, post, put } from '../api'

export const getCompany = () => get('/company')
export const updateCompany = (values) => put('/company', values)
export const listFinancialYears = () => get('/company/financial-years')
export const addFinancialYear = (fromDate, toDate) => post('/company/financial-years', { from_date: fromDate, to_date: toDate })
export const setActiveFinancialYear = (fromDate) => put('/company/financial-years/active', { from_date: fromDate })
