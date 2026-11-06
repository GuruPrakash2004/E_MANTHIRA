import { get, post, del } from '../api'

export const getAskMeta = () => get('/ask-data/meta')
export const askQuestion = (question, lang) => post('/ask-data', { question, lang }, { timeout: 300000 })
export const getAskHistory = (q) => get('/ask-data/history', { params: q ? { q } : undefined })
export const rerunAsk = (id) => post(`/ask-data/history/${id}/rerun`)
export const deleteAsk = (id) => del(`/ask-data/history/${id}`)
