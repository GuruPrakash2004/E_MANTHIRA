import { download, get, post } from '../api'

export const downloadImportTemplate = (docId) => download(`/masters/${docId}/import-template`)

export function importFromExcel(docId, file) {
  const form = new FormData()
  form.append('file', file)
  // No explicit Content-Type — axios/the browser set multipart/form-data
  // with the correct boundary on their own from the FormData body; setting
  // it manually here would omit that boundary and break the upload.
  return post(`/masters/${docId}/import`, form)
}

// Info grid under the pickers (field name / type / mandatory / foreign key / length / unique / default)
export const getImportFields = (docId) => get(`/masters/${docId}/import-fields`)

// "Load from Excel": the rows the file holds, nothing written
export function previewImport(docId, file) {
  const form = new FormData()
  form.append('file', file)
  return post(`/masters/${docId}/import-preview`, form)
}
