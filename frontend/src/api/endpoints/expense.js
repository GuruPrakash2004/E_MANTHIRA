import { get, post, del } from '../api'

// Expense Entry (DocID 1260) — backend: api/v1/expense.py
export const listExpenses = (params) => get('/expenses', { params })
export const getExpense = (id) => get(`/expenses/${id}`)
export const createExpense = (body) => post('/expenses', body)
export const cancelExpense = (id, reason) => post(`/expenses/${id}/cancel`, { reason })
export const deleteExpense = (id) => del(`/expenses/${id}`)
