import { get, put } from '../api'

export const listSettings = () => get('/settings')
export const setSetting = (group, name, value) => put('/settings', { group, name, value })
