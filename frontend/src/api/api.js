// The ONLY place in the frontend that knows the backend's URL.
// Every feature imports an endpoint module (see src/api/endpoints/*.js),
// never axios directly — see /CLAUDE.md §5.
import axios from 'axios'
import { isDemoMode } from '../lib/demoMode'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

if (!BASE_URL) {
  // Fail loudly in dev rather than silently calling a relative path.
  console.error('VITE_API_BASE_URL is not set — copy frontend/.env.example to frontend/.env')
}

/** Absolute URL for a backend path, for tags that cannot go through axios (e.g. <video src>). */
export const apiUrl = (path) => `${BASE_URL || ''}${path}`

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: false,
})

const TOKEN_KEY = 'vtemple_access_token'
const REFRESH_KEY = 'vtemple_refresh_token'
const FY_KEY = 'vtemple_fy_id'

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY)
}
export function setSession({ access_token, refresh_token, financial_year_id }) {
  if (access_token) localStorage.setItem(TOKEN_KEY, access_token)
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token)
  if (financial_year_id) localStorage.setItem(FY_KEY, String(financial_year_id))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(FY_KEY)
}

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshPromise = null

api.interceptors.response.use(
  (res) => res,
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

// Demo Data mode (src/lib/demoMode.js, src/lib/demo/*): when on, EVERY request, reads and writes alike, is answered
// by the in-memory demo database (src/lib/demo/routes.js) through this axios adapter instead of the network, so all
// screens are populated and saving works for the session. Nothing is persisted; a reload resets the demo data.
const realAdapter = axios.getAdapter(axios.defaults.adapter)
api.defaults.adapter = (config) => (isDemoMode() ? import('../lib/demo/adapter').then((m) => m.demoAdapter(config)) : realAdapter(config))

// Small helpers so feature code reads cleanly: get/post/put/del/download
export const get = (url, config) => api.get(url, config).then((r) => r.data)
export const post = (url, data, config) => api.post(url, data, config).then((r) => r.data)
export const put = (url, data, config) => api.put(url, data, config).then((r) => r.data)
export const del = (url, config) => api.delete(url, config).then((r) => r.data)
export const download = (url, config) => api.get(url, { ...config, responseType: 'blob' }).then((r) => r.data)
