import { get, post, put } from '../api'

// Attendance + Attendance Monthly (backend/app/api/v1/attendance.py)
export const getDay = (day) => get('/attendance/day', { params: day ? { day } : undefined })
export const saveDay = (rows) => post('/attendance/day', { rows })
export const getMonth = (year, month) => get('/attendance/month', { params: { year, month } })
export const changeCell = (body) => put('/attendance/month/cell', body)
