import { get, post, put } from '../api'

// Alertify: the reminder app's own database. Settings are ADMIN only; the config is what every screen may read.
export const getAlertifyConfig = () => get('/alertify/config')
export const getAlertifySettings = () => get('/alertify/settings')
export const testAlertify = (body) => post('/alertify/test', body)
export const saveAlertify = (body) => put('/alertify/settings', body)
export const createAlerts = (body) => post('/alertify/alerts', body)
