import { api, apiUrl, del, get, put } from '../api'

// Optional ADMIN-uploaded welcome video (backend/app/api/v1/welcome.py). No DB tables: file on the server disk.
//
// Caching is handled here so nobody ever needs a hard refresh: the video URL carries ?v=<file mtime> (a new upload is
// a new URL, so the browser re-downloads it; an unchanged one is served from the browser cache for a year), and the
// last known settings are remembered in localStorage so a slow or failed lookup never delays or breaks the welcome.
const CACHE_KEY = 'vt-welcome-cfg'
const isCfg = (c) => c && typeof c === 'object' && !Array.isArray(c)

export function cachedWelcome() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY))
    return isCfg(c) ? c : null
  } catch {
    return null
  }
}
function remember(c) {
  if (isCfg(c)) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c))
    } catch {
      /* storage full or blocked: just skip caching */
    }
  }
  return c
}

export const getWelcome = () => get('/welcome').then(remember)
export const setWelcomeEnabled = (enabled) => put('/welcome/enabled', { enabled }).then(remember)
export const removeWelcome = () => del('/welcome').then(remember)
export const welcomeVideoUrl = (version) => apiUrl(`/welcome/video?v=${version || 0}`)

export const uploadWelcome = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return api
    .post('/welcome', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
    .then((r) => remember(r.data))
}
