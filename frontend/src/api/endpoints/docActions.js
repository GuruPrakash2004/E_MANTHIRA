import { get, post } from '../api'

export const getOptions = (docId) => get(`/doc-actions/${docId}/options`)
export const emailTemplates = (docId) => get(`/doc-actions/${docId}/email-templates`)
export const emailPrepare = (docId, id, template) => post(`/doc-actions/${docId}/${id}/email/prepare`, { template })
export const emailSend = (docId, id, body) => post(`/doc-actions/${docId}/${id}/email/send`, body)
export const smsTemplates = (docId) => get(`/doc-actions/${docId}/sms-templates`)
export const smsProviders = () => get('/doc-actions/sms-providers')
export const smsPrepare = (docId, id, template) => post(`/doc-actions/${docId}/${id}/sms/prepare`, { template })
export const smsSend = (docId, id, body) => post(`/doc-actions/${docId}/${id}/sms/send`, body)
