import { api, download, get, post, put, del } from '../api'

export const listMaster = (docId, params) => get(`/masters/${docId}`, { params })
export const getMasterRow = (docId, rowId) => get(`/masters/${docId}/${rowId}`)
export const createMasterRow = (docId, values) => post(`/masters/${docId}`, values)
export const updateMasterRow = (docId, rowId, values) => put(`/masters/${docId}/${rowId}`, values)
export const deleteMasterRow = (docId, rowId) => del(`/masters/${docId}/${rowId}`)
export const getMasterLayout = (docId) => get(`/masters/${docId}/layout`)
export const coreLookup = (docId, field, search) => get(`/masters/${docId}/core-lookup/${field}`, { params: search ? { search } : undefined })

// Options menu
export const approveMasterRow = (docId, rowId, approve) => post(`/masters/${docId}/${rowId}/approve`, { approve })
export const getAttachSeva = (docId, rowId) => get(`/masters/${docId}/${rowId}/attach-seva`)
export const saveAttachSeva = (docId, rowId, sevaIds) => put(`/masters/${docId}/${rowId}/attach-seva`, { seva_ids: sevaIds })

// Supplier sub-screens (Multi Address / Contact Person / Alert Message / Activities)
const party = (docId, rowId, path = '') => `/masters/${docId}/${rowId}/party/${path}`
export const partyCounts = (docId, rowId) => get(party(docId, rowId, 'counts'))
export const listAddresses = (docId, rowId) => get(party(docId, rowId, 'addresses'))
export const saveAddress = (docId, rowId, values, id) => (id ? put(party(docId, rowId, `addresses/${id}`), values) : post(party(docId, rowId, 'addresses'), values))
export const deleteAddress = (docId, rowId, id) => del(party(docId, rowId, `addresses/${id}`))
export const listContacts = (docId, rowId) => get(party(docId, rowId, 'contacts'))
export const saveContact = (docId, rowId, values, id) => (id ? put(party(docId, rowId, `contacts/${id}`), values) : post(party(docId, rowId, 'contacts'), values))
export const deleteContact = (docId, rowId, id) => del(party(docId, rowId, `contacts/${id}`))
export const contactImage = (docId, rowId, id) => download(party(docId, rowId, `contacts/${id}/image`))
export const setContactImage = (docId, rowId, id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.put(party(docId, rowId, `contacts/${id}/image`), form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
export const listAlerts = (docId, rowId) => get(party(docId, rowId, 'alerts'))
export const saveAlerts = (docId, rowId, messages) => put(party(docId, rowId, 'alerts'), { messages })
export const listActivities = (docId, rowId) => get(party(docId, rowId, 'activities'))
export const addActivity = (docId, rowId, notes) => post(party(docId, rowId, 'activities'), { notes })
export const deleteActivity = (docId, rowId, id) => del(party(docId, rowId, `activities/${id}`))

// Item picture
export const masterImage = (docId, rowId) => download(`/masters/${docId}/${rowId}/image`)
export const setMasterImage = (docId, rowId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.put(`/masters/${docId}/${rowId}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
export const sendApprovalMail = (docId, rowId) => post(`/masters/${docId}/${rowId}/send-approval`)
