import { get, post, put } from '../api'

export const listSettings = () => get('/settings')
export const setSetting = (group, name, value) => put('/settings', { group, name, value })
export const saveSettings = (items) => put('/settings/bulk', items)
export const addSetting = (body) => post('/settings', body)
