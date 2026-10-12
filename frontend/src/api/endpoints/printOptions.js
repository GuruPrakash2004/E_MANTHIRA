import { get, put } from '../api'

export const listAllPrintOptions = () => get('/print-options')
export const updatePrintOption = (docId, optionName, body) =>
  put(`/print-options/${docId}/${encodeURIComponent(optionName)}`, body)
