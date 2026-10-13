import { get, post, put } from '../api'

export const getMailSettings = () => get('/mail-settings')
export const saveMailSettings = (values) => put('/mail-settings', values)
export const sendTestMail = (to) => post('/mail-settings/test', { to })
export const getSmsProviders = () => get('/mail-settings/sms-providers')
export const saveSmsProviders = (rows) => put('/mail-settings/sms-providers', rows)
