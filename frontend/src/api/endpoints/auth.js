import { get, post } from '../api'

export const login = (username, password) => post('/auth/login', { username, password })
export const me = () => get('/auth/me')
export const financialYears = () => get('/auth/financial-years')
export const changePassword = (body) => post('/auth/change-password', body)
