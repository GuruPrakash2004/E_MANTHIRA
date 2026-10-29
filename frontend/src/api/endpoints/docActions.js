import { api, del, get, post, put } from '../api'

export const getOptions = (docId) => get(`/doc-actions/${docId}/options`)
export const emailTemplates = (docId) => get(`/doc-actions/${docId}/email-templates`)
export const emailPrepare = (docId, id, template) => post(`/doc-actions/${docId}/${id}/email/prepare`, { template })
export const emailSend = (docId, id, body) => post(`/doc-actions/${docId}/${id}/email/send`, body)
export const smsTemplates = (docId) => get(`/doc-actions/${docId}/sms-templates`)
export const smsProviders = () => get('/doc-actions/sms-providers')
export const smsPrepare = (docId, id, template) => post(`/doc-actions/${docId}/${id}/sms/prepare`, { template })
export const smsSend = (docId, id, body) => post(`/doc-actions/${docId}/${id}/sms/send`, body)

// Doc XL Export / XL Template / XL Import (documents with UtlTransactions.AllowImpExp = 'Y'); files are .xls
export const xlTemplate = (docId) => api.get(`/doc-actions/${docId}/xl-template`, { responseType: 'blob' }).then((r) => r.data)
export const xlExport = (docId, rows) => api.post(`/doc-actions/${docId}/xl-export`, { rows }, { responseType: 'blob' }).then((r) => r.data)
export const xlImport = (docId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/doc-actions/${docId}/xl-import`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}

// Amendment: only offered when the document's switch is on and its header table has the columns (dormant otherwise)
export const getAmendment = (docId, id) => get(`/doc-actions/${docId}/${id}/amendment`)
export const setAmendment = (docId, id, body) => put(`/doc-actions/${docId}/${id}/amendment`, body)

// Label Printing (offered when the document's UtlOption list has a "Label Print" entry)
export const labelColumns = (docId) => get(`/doc-actions/${docId}/label-columns`)
export const labelTemplates = (docId) => get(`/doc-actions/${docId}/label-templates`)
export const addLabelTemplate = (docId, body) => post(`/doc-actions/${docId}/label-templates`, body)
export const updateLabelTemplate = (docId, id, body) => put(`/doc-actions/${docId}/label-templates/${id}`, body)
export const deleteLabelTemplate = (docId, id) => del(`/doc-actions/${docId}/label-templates/${id}`)
export const runLabels = (docId, body) => post(`/doc-actions/${docId}/labels`, body)
export const labelDocuments = () => get('/doc-actions/label-documents')
