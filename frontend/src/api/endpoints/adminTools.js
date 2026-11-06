import { del, download, get, post } from '../api'

// SQL Query Execution, SQL Saved Query, Bulk Update (backend/app/api/v1/admin_tools.py)
export const sqlInfo = () => get('/admin-tools/sql/info')
export const sqlTables = (search) => get('/admin-tools/sql/tables', { params: search ? { search } : undefined })
export const sqlColumns = (name) => get(`/admin-tools/sql/tables/${encodeURIComponent(name)}/columns`)
export const runSql = (sql) => post('/admin-tools/sql/run', { sql })

export const savedList = (group) => get('/admin-tools/saved', { params: group ? { group } : undefined })
export const savedTables = (search) => get('/admin-tools/saved/tables', { params: search ? { search } : undefined })
export const savedGet = (name) => get(`/admin-tools/saved/${encodeURIComponent(name)}`)
export const savedRun = (name) => post(`/admin-tools/saved/${encodeURIComponent(name)}/run`)
export const savedSave = (body) => post('/admin-tools/saved', body)
export const savedDelete = (name) => del(`/admin-tools/saved/${encodeURIComponent(name)}`)

export const bulkTables = () => get('/admin-tools/bulk/tables')
export const bulkRows = (name, filters) => get(`/admin-tools/bulk/tables/${encodeURIComponent(name)}`, { params: { filters: JSON.stringify(filters || {}) } })
export const bulkUpdate = (body) => post('/admin-tools/bulk/update', body)
export const bulkDelete = (body) => post('/admin-tools/bulk/delete', body)
export const hsnTemplate = () => download('/admin-tools/bulk/hsn/template')
const fileForm = (file) => {
  const f = new FormData()
  f.append('file', file)
  return f
}
export const hsnPreview = (file) => post('/admin-tools/bulk/hsn/preview', fileForm(file))
export const hsnApply = (file) => post('/admin-tools/bulk/hsn/apply', fileForm(file))
