// The ONLY place in the frontend that knows the backend's URL.
// Every feature imports an endpoint module (see src/api/endpoints/*.js),
// never axios directly — see /CLAUDE.md §5.
import axios from 'axios'

// Unset = same origin: the backend serves this site and the API under /api/v1, so a deployed build needs no config.
// (`npm run dev` proxies /api to the backend, see vite.config.js.) Set VITE_API_BASE_URL only to point at another server.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

/** Absolute URL for a backend path, for tags that cannot go through axios (e.g. <video src>). */
export const apiUrl = (path) => `${BASE_URL || ''}${path}`

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: false,
})

const TOKEN_KEY = 'vtemple_access_token'
const REFRESH_KEY = 'vtemple_refresh_token'
const FY_KEY = 'vtemple_fy_id'
const FY_LABEL_KEY = 'vtemple_fy_label'

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY)
}
export function setSession({ access_token, refresh_token, financial_year_id, financial_year_label }) {
  if (access_token) localStorage.setItem(TOKEN_KEY, access_token)
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token)
  if (financial_year_id) localStorage.setItem(FY_KEY, String(financial_year_id))
  if (financial_year_label) localStorage.setItem(FY_LABEL_KEY, financial_year_label)
}
/** "DD-MMM-YYYY - DD-MMM-YYYY" of the year this session works in (from sign-in), or ''. */
export function getFyLabel() {
  return localStorage.getItem(FY_LABEL_KEY) || ''
}
/** "FY 2026-27" of the year this session works in, or ''. */
export function getFyShort() {
  const years = getFyLabel().match(/\d{4}/g)
  return years && years.length >= 2 ? `FY ${years[0]}-${years[1].slice(2)}` : ''
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(FY_KEY)
  localStorage.removeItem(FY_LABEL_KEY)
}

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshPromise = null

api.interceptors.response.use(
  (res) => {
    // a saved / deleted document moves the "next bill no" on: screens showing that preview listen for this
    const m = String(res.config?.method || 'get').toLowerCase()
    if (m !== 'get' && typeof window !== 'undefined') window.dispatchEvent(new Event('vt-doc-written'))
    return res
  },
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retried && getRefreshToken()) {
      original._retried = true
      try {
        refreshPromise =
          refreshPromise ||
          api.post('/auth/refresh', null, { params: { refresh_token: getRefreshToken() } }).then((r) => r.data)
        const data = await refreshPromise
        refreshPromise = null
        setSession(data)
        original.headers.Authorization = `Bearer ${data.access_token}`
        return api(original)
      } catch (e) {
        refreshPromise = null
        clearSession()
        window.location.assign('/login')
        return Promise.reject(e)
      }
    }
    return Promise.reject(error)
  }
)

// Small helpers so feature code reads cleanly: get/post/put/del/download
export const get = (url, config) => api.get(url, config).then((r) => r.data)
export const post = (url, data, config) => api.post(url, data, config).then((r) => r.data)
export const put = (url, data, config) => api.put(url, data, config).then((r) => r.data)
export const del = (url, config) => api.delete(url, config).then((r) => r.data)
export const download = (url, config) => api.get(url, { ...config, responseType: 'blob' }).then((r) => r.data)
