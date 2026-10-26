import { get, post, put } from '../api'

export const login = (username, password) => post('/auth/login', { username, password })
export const me = () => get('/auth/me')
export const financialYears = () => get('/auth/financial-years')
// work in another financial year (this user only; the company's Active year is not changed) - returns fresh tokens
export const selectFinancialYear = (id) => put(`/auth/financial-years/${id}/select`)
export const changePassword = (body) => post('/auth/change-password', body)
