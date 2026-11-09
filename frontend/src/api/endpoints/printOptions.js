import { del, get, post, put } from '../api'

export const listAllPrintOptions = () => get('/print-options')
export const listServerPrinters = (refresh = false) => get('/print-options/printers', { params: { refresh } })
export const updatePrintOption = (docId, optionName, body) =>
  put(`/print-options/${docId}/${encodeURIComponent(optionName)}`, body)

// Fonts the print formats need (regional-language reports use non-Unicode fonts such as "BRH Kannada")
export const getFormatFonts = (docId, optionName) => get('/print-options/fonts', { params: { doc_id: docId, option_name: optionName } })
export const listFontFiles = () => get('/print-options/font-files')
export const uploadFontFile = (file) => {
  const body = new FormData()
  body.append('file', file)
  return post('/print-options/font-files', body)
}

// Add / delete a print format, and the lists the form picks from
export const createPrintOption = (body) => post('/print-options', body)
export const deletePrintOption = (docId, optionName) => del(`/print-options/${docId}/${encodeURIComponent(optionName)}`)
export const listPrintScreens = () => get('/print-options/screens')
export const listRptFiles = () => get('/print-options/rpt-files')
export const getFormulaTemplate = () => get('/print-options/template')

// Legacy "Print Settings" window: the Transaction list, Alter Order, and the prefix-wise default print
export const listPrintTransactions = () => get('/print-options/transactions')
export const savePrintOptionOrder = (docId, names) => put(`/print-options/order/${docId}`, { names })
export const getPrefixDefaults = (docId) => get(`/print-options/prefix-defaults/${docId}`)
export const savePrefixDefaults = (docId, rows) => put(`/print-options/prefix-defaults/${docId}`, rows)

// The Windows default printer of the PC running the print service (a slow or offline default makes every report open slowly)
export const getServicePrinter = () => get('/print-options/service-printer')
export const setServicePrinter = (printer) => put('/print-options/service-printer', { printer })
export const createReportDefaults = (docId) => post(`/print-options/report-defaults/${docId}`)
