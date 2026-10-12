import { api, download, post, put } from '../api'

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
