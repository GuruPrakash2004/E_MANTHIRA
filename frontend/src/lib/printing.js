// Printing from the UI. One place that knows how a document gets printed; screens and PrintDialog call these.
// All HTTP goes through api/endpoints/print.js (and so through the single api.js client).
import { notifications } from '@mantine/notifications'
import * as printApi from '../api/endpoints/print'
import { detectAgent, getRememberedPrinter, printDocumentOnThisPc } from './localPrint'

export const AFTER_SAVE = { PRINT: 'print', ASK: 'ask', NONE: 'none' }

/** What to do right after Save for a format: `UtlOption.AfterSaveAction` PP = print now, P = ask, anything else = nothing. */
export function afterSaveBehaviour(format) {
  const a = String(format?.after_save_action || '').trim().toUpperCase()
  if (a === 'PP') return AFTER_SAVE.PRINT
  if (a === 'P') return AFTER_SAVE.ASK
  return AFTER_SAVE.NONE
}

/** The format to pre-select: the server's `selected` (your last choice beats the designer default), else the first one that exists. */
export function pickFormat(formats) {
  return formats?.find((f) => f.selected && f.available) || formats?.find((f) => f.available) || formats?.[0] || null
}

export const loadFormats = (docId) => printApi.listFormats(docId)

/** Renders the record and returns an object URL for the PDF (the caller revokes it). */
export async function renderToUrl({ docId, recordId, optionName }) {
  const blob = await printApi.renderPdf({ docId, recordId, optionName })
  return URL.createObjectURL(blob)
}

/** One render for the preview pane: the page images (real shape) plus an object URL of the same PDF for Print. */
export async function renderToPreview({ docId, recordId, optionName }) {
  const r = await printApi.renderPreview({ docId, recordId, optionName })
  const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
  return { url: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), pages: r.pages }
}

/** Remembers the user's choice; failure is harmless. */
export function rememberFormat(docId, optionName) {
  return printApi.savePreference(docId, optionName).catch(() => {})
}

/** The browser's own print dialog for an already-rendered PDF. */
export function printInBrowser(pdfUrl) {
  const win = window.open(pdfUrl, '_blank')
  if (!win) throw new Error('The browser blocked the print window. Allow pop-ups for this site and try again.')
  win.addEventListener('load', () => {
    win.focus()
    win.print()
  })
}

/** Direct print on the print service's PC. */
export const printOnServer = (args) => printApi.printOnServer(args)

/** Print on a printer attached to THIS PC through the Print Agent. */
export const printOnThisPc = ({ docId, recordId, optionName, printer }) =>
  printDocumentOnThisPc(printApi.pagesUrl(docId, optionName, recordId), printer || undefined)

/**
 * Plain-language message from any failed print call. The backend already turns Crystal/printer errors into advice
 * (`detail`); a failed PDF request arrives as a Blob, so it is read as JSON first.
 */
export async function printErrorMessage(err) {
  let data = err?.response?.data
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text())
    } catch {
      data = null
    }
  }
  const detail = typeof data?.detail === 'string' ? data.detail : null
  if (detail) return detail
  if (err?.message && !err.response) return err.message
  return 'Printing did not complete. Try again, or ask the administrator.'
}

/** Print a record right now with no dialog (AfterSaveAction "PP"): the format's own printer, else this PC's Print Agent, else the browser. */
export async function printNow({ docId, recordId, format }) {
  if (format.printer_name) {
    await printOnServer({ docId, recordId, optionName: format.option_name, printerName: format.printer_name, copies: format.copies })
    return `Sent to ${format.printer_name}`
  }
  const agent = await detectAgent()
  if (agent?.printers?.length) {
    const remembered = getRememberedPrinter()
    const printer = remembered && agent.printers.includes(remembered) ? remembered : agent.default || agent.printers[0]
    await printOnThisPc({ docId, recordId, optionName: format.option_name, printer })
    return `Sent to ${printer} on this PC`
  }
  printInBrowser(await renderToUrl({ docId, recordId, optionName: format.option_name }))
  return 'Opened the print window'
}

/**
 * What a screen calls right after a successful Save. Follows the document's `UtlOption.AfterSaveAction`:
 * PP = print straight away, P = open the print dialog, anything else = do nothing (the Print button is still there).
 * Never throws: a failed lookup falls back to doing nothing, a failed print shows the reason.
 */
export async function handleAfterSave({ docId, recordId, openDialog }) {
  let format = null
  try {
    format = pickFormat(await loadFormats(docId))
  } catch {
    return
  }
  const behaviour = afterSaveBehaviour(format)
  if (behaviour === AFTER_SAVE.ASK) {
    openDialog(recordId)
  } else if (behaviour === AFTER_SAVE.PRINT && format?.available) {
    try {
      notifications.show({ message: await printNow({ docId, recordId, format }), color: 'teal' })
    } catch (err) {
      notifications.show({ title: 'Could not print', message: await printErrorMessage(err), color: 'red' })
      openDialog(recordId)
    }
  }
}

// True while a PrintDialog is open, so a screen's own F10 handler stands down and F10 prints once (from the dialog).
let printDialogOpen = false
export const setPrintDialogOpen = (v) => { printDialogOpen = v }
export const isPrintDialogOpen = () => printDialogOpen

/**
 * F10 on a screen: print this record straight away in the format and printer last used, no dialog.
 * If the format is missing or the print fails, the reason is shown and the dialog opens so it can be fixed.
 */
export async function directPrintRecord({ docId, recordId, openDialog }) {
  if (printDialogOpen || !recordId) return
  try {
    const format = pickFormat(await loadFormats(docId))
    if (!format?.available) throw new Error('No print format is available for this document.')
    notifications.show({ message: await printNow({ docId, recordId, format }), color: 'teal' })
  } catch (err) {
    notifications.show({ title: 'Could not print', message: await printErrorMessage(err), color: 'red' })
    openDialog?.(recordId)
  }
}
