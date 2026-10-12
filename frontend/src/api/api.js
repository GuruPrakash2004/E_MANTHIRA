// The ONLY place in the frontend that knows the backend's URL.
// Every feature imports an endpoint module (see src/api/endpoints/*.js),
// never axios directly — see /CLAUDE.md §5.
import axios from 'axios'
import { isDemoMode } from '../lib/demoMode'
import { resolveDemoGet } from '../lib/demoData'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

if (!BASE_URL) {
  // Fail loudly in dev rather than silently calling a relative path.
  console.error('VITE_API_BASE_URL is not set — copy frontend/.env.example to frontend/.env')
}

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

// Demo Data mode (src/lib/demoMode.js, src/lib/demoAuth.js): when on, every
// GET below is answered from src/lib/demoData.js's curated fixtures (or a
// safe empty fallback) instead of a real network call, and every write is
// rejected with a message shaped like a normal API error — so the existing
// `err?.response?.data?.detail` handling in every screen's catch block
// already renders it correctly, no per-screen changes needed.
function demoReadOnlyRejection() {
  return Promise.reject({
    response: { data: { detail: 'Demo data is read-only — switch to Real Data (top right) to save changes.' } },
  })
}
// A GET not in the curated fixture set still needs *some* valid shape so the
// calling screen's `(data || []).map(...)` etc. don't throw — every screen
// in this app already treats an empty result as a normal, valid state.
function demoGetFallback(url) {
  return /\/\d+$/.test(url.split('?')[0]) ? null : []
}

// Small helpers so feature code reads cleanly: get/post/put/del/download
export const get = (url, config) => {
  if (isDemoMode()) {
    const mocked = resolveDemoGet(url)
    return Promise.resolve(mocked !== undefined ? mocked : demoGetFallback(url))
  }
  return api.get(url, config).then((r) => r.data)
}
export const post = (url, data, config) => {
  if (isDemoMode()) return demoReadOnlyRejection()
  return api.post(url, data, config).then((r) => r.data)
}
export const put = (url, data, config) => {
  if (isDemoMode()) return demoReadOnlyRejection()
  return api.put(url, data, config).then((r) => r.data)
}
export const del = (url, config) => {
  if (isDemoMode()) return demoReadOnlyRejection()
  return api.delete(url, config).then((r) => r.data)
}
export const download = (url, config) => {
  if (isDemoMode()) return demoReadOnlyRejection()
  return api.get(url, { ...config, responseType: 'blob' }).then((r) => r.data)
}
