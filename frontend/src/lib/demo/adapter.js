// axios adapter used while Demo Data mode is on: every request (reads AND writes, through the helpers or raw
// api.get/api.post) is answered by the in-memory demo router instead of the network. A small delay keeps loading
// states visible so they can be reviewed too.
import axios from 'axios'
import { DemoError, handleDemoRequest } from './routes'

const DELAY_MS = 220

function parseBody(data) {
  if (data == null) return undefined
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return undefined
    }
  }
  return data // FormData / object
}

export function demoAdapter(config) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const [path, search] = String(config.url || '').split('?')
        const query = { ...Object.fromEntries(new URLSearchParams(search || '')), ...(config.params || {}) }
        Object.keys(query).forEach((k) => query[k] === undefined && delete query[k])
        const { data } = handleDemoRequest({ method: config.method || 'get', path, query, body: parseBody(config.data) })
        resolve({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} })
      } catch (err) {
        if (err instanceof DemoError) {
          const response = { data: { detail: err.detail }, status: err.status, statusText: 'Error', headers: {}, config }
          reject(new axios.AxiosError(err.detail, err.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', config, {}, response))
        } else {
          reject(err)
        }
      }
    }, DELAY_MS)
  })
}
