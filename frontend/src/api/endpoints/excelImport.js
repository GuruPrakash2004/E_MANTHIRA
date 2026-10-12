import { download, post } from '../api'

export const downloadImportTemplate = (docId) => download(`/masters/${docId}/import-template`)

export function importFromExcel(docId, file) {
  const form = new FormData()
  form.append('file', file)
  // No explicit Content-Type — axios/the browser set multipart/form-data
  // with the correct boundary on their own from the FormData body; setting
  // it manually here would omit that boundary and break the upload.
  return post(`/masters/${docId}/import`, form)
}
