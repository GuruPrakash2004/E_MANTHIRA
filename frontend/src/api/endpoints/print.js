import { api, download, get, post, put } from '../api'

export const getPrintOptions = (docId) => api.get(`/print/${docId}/options`).then((r) => r.data)

/** Remembers this user's choice for this document — pre-selected next time,
 * same "sticky" feel as the legacy EXE's per-user print option memory. */
export const setPrintPreference = (docId, optionName) => put(`/print/${docId}/preference`, { option_name: optionName })

/** Fetches the rendered PDF (from the Crystal service) as a Blob. */
export const previewPdf = (docId, optionName, recordId) =>
  download(`/print/${docId}/${encodeURIComponent(optionName)}/${recordId}/preview`)

/** Opens the PDF in a new tab and triggers the browser print dialog — this
 * is how the website "links with the printer": the OS/browser print dialog
 * lets the counter staff pick the thermal or A4 printer, same as choosing a
 * printer in the old Windows app's print dialog. */
export async function printViaBrowser(docId, optionName, recordId) {
  const blob = await previewPdf(docId, optionName, recordId)
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) {
    win.addEventListener('load', () => {
      win.focus()
      win.print()
    })
  }
  return url
}

/** Silent print straight to the option's configured printer (e.g. the
 * counter's thermal printer) via the Crystal service — no browser dialog,
 * matching the legacy app's DirectPrinterName behaviour. Requires the real
 * Crystal print service (or a local agent) to be reachable. */
export const printDirect = (docId, optionName, recordId) =>
  post(`/print/${docId}/${encodeURIComponent(optionName)}/${recordId}/print-direct`)

/** Rasterised pages for the local Print Agent (see src/lib/localPrint.js) —
 * relative path only, the agent helper calls `api.get` with it itself. */
export const pagesUrl = (docId, optionName, recordId) =>
  `/print/${docId}/${encodeURIComponent(optionName)}/${recordId}/pages`

/** The *Download Print Agent for this PC* button — a direct link (not an
 * axios call) since it's a file download, pre-addressed to THIS page's
 * own origin so the agent's allow-list matches exactly. */
/** PDF Generator (bulk) — port of frmUtlBulkPDFGenerator. Returns a ZIP
 * Blob of one PDF per record in the date range. */
export const bulkPdf = (docId, optionName, fromDate, toDate) =>
  download(`/print/${docId}/${encodeURIComponent(optionName)}/bulk-pdf`, { params: { from_date: fromDate, to_date: toDate } })

export function agentDownloadUrl() {
  const base = api.defaults.baseURL.replace(/\/$/, '')
  return `${base}/print/agent?origin=${encodeURIComponent(window.location.origin)}`
}

// ---- Print API v2 (roadmap step 8): job builder + bridge on the server. Feature code goes through lib/printing.js.

/** Formats for a document: [{option_name, rpt_file, available, default, preferred, selected, printer_name, copies, after_save_action}]. */
export const listFormats = (docId) => api.get('/print/options', { params: { doc_id: docId } }).then((r) => r.data)

/** PDF Blob of one record in one format (blank option = the document's first format, like the desktop). */
export const renderPdf = ({ docId, recordId, optionName }) =>
  api.post('/print/render', { doc_id: docId, doc_id_value: recordId, option_name: optionName || null }, { responseType: 'blob' }).then((r) => r.data)

/** Remember this user's last format for the document. */
export const savePreference = (docId, optionName) => put('/print/preference', { doc_id: docId, option_name: optionName })

/** Direct print on the print service's PC (printer blank = the option's own). */
export const printOnServer = ({ docId, recordId, optionName, printerName, copies }) =>
  post('/print/print', { doc_id: docId, doc_id_value: recordId, option_name: optionName || null, printer_name: printerName || null, copies: copies || null })

/** PDF Generator (legacy form flow): documents with print types, parties, records, then download the ticked ones. */
export const bulkDocuments = () => get('/print/bulk/documents')
export const bulkParties = (docId) => get(`/print/bulk/${docId}/parties`)
export const bulkRecords = (docId, params) => get(`/print/bulk/${docId}/records`, { params })
export const bulkDownloadSelected = (docId, optionName, recordIds) =>
  api.post(`/print/bulk/${docId}/${encodeURIComponent(optionName)}/download`, { record_ids: recordIds }, { responseType: 'blob' }).then((r) => r.data)
