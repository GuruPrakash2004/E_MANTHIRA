import { del, get, post, put } from '../api'

const B = '/settings/other'
export const listTables = () => get(`${B}/tables`)
export const listColumns = (table) => get(`${B}/tables/${encodeURIComponent(table)}/columns`)

export const listCaptions = () => get(`${B}/field-captions`)
export const saveCaptions = (items) => put(`${B}/field-captions`, items)
export const addCaption = (body) => post(`${B}/field-captions`, body)
export const deleteCaption = (code) => del(`${B}/field-captions/${encodeURIComponent(code)}`)

export const listLinkages = () => get(`${B}/delete-linkage`)
export const linkageCandidates = (table, column) => get(`${B}/delete-linkage/candidates`, { params: { table, column } })
export const saveLinkage = (body) => put(`${B}/delete-linkage`, body)
export const deleteLinkage = (table) => del(`${B}/delete-linkage/${encodeURIComponent(table)}`)

export const listSearchFields = () => get(`${B}/search-fields`)
export const addSearchField = (body) => post(`${B}/search-fields`, body)
export const updateSearchField = (id, body) => put(`${B}/search-fields/${id}`, body)
export const deleteSearchField = (id) => del(`${B}/search-fields/${id}`)

export const getLoginSettings = () => get(`${B}/login`)
export const saveLoginSettings = (body) => put(`${B}/login`, body)

export const getDocNumbers = () => get(`${B}/doc-numbers`)
export const saveDocNumbers = (rows) => put(`${B}/doc-numbers`, rows)
export const getDocPrefixes = (docId) => get(`${B}/doc-numbers/${docId}/prefixes`)
export const saveDocPrefixes = (docId, rows) => put(`${B}/doc-numbers/${docId}/prefixes`, rows)

// kind: 'transaction' (Transaction/Voucher Settings) or 'master' (Master Settings): same switches, different documents
const base = (kind) => (kind === 'master' ? 'master-settings' : 'transaction-settings')
export const listTrnDocuments = (kind) => get(`${B}/${base(kind)}/documents`)
export const getTrnSettings = (docId, kind) => get(`${B}/${base(kind)}/${docId}`)
export const saveTrnSettings = (docId, values, kind) => put(`${B}/${base(kind)}/${docId}`, values)
export const getMisc = () => get(`${B}/misc`)
export const saveMisc = (body) => put(`${B}/misc`, body)

export const listFilterDocuments = (kind) => get(`${B}/filter-settings/documents`, { params: { kind } })
export const getFilter = (docId) => get(`${B}/filter-settings/${docId}`)
export const saveFilter = (docId, items) => put(`${B}/filter-settings/${docId}`, items)
export const deleteFilter = (docId) => del(`${B}/filter-settings/${docId}`)

export const getFormSettings = () => get(`${B}/form-settings`)
export const saveFormSettings = (rows) => put(`${B}/form-settings`, rows)

export const getStockSettings = () => get(`${B}/stock-settings`)
export const saveStockSettings = (rows) => put(`${B}/stock-settings`, rows)

export const listPostDocs = () => get(`${B}/post-docs`)
export const getPostDoc = (id) => get(`${B}/post-docs/${id}`)
export const addPostDoc = (body) => post(`${B}/post-docs`, body)
export const updatePostDoc = (id, body) => put(`${B}/post-docs/${id}`, body)
export const deletePostDoc = (id) => del(`${B}/post-docs/${id}`)
