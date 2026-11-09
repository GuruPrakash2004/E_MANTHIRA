import { api, apiUrl, del, get, post, put } from '../api'

// Welcome videos: a library of MP4s chosen by an ADMIN plus the rule that picks one per sign-in (backend/app/api/v1/welcome.py).
// No DB tables: the files live on the server disk.
//
// Caching is handled here so nobody ever needs a hard refresh: the video URL carries ?v=<file mtime> (a new upload is
// a new URL, so the browser re-downloads it; an unchanged one is served from the browser cache for a year), and the
// last known settings are remembered in localStorage so a slow or failed lookup never delays or breaks the welcome.
const CACHE_KEY = 'vt-welcome-cfg'
const LAST_KEY = 'vt-welcome-last'
export const BUILTIN = 'builtin'
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

/** The clip this browser played last ('' = none); "random each sign-in" skips it. */
export function lastPlayed() {
  try {
    return localStorage.getItem(LAST_KEY) || ''
  } catch {
    return ''
  }
}
export function rememberPlayed(id) {
  try {
    localStorage.setItem(LAST_KEY, id || BUILTIN)
  } catch {
    /* ignore */
  }
}

/** True when the remembered pick is still the right one (per-day / every-N-hours modes, before its change time): the video can start at once. */
export function cachedPickStillValid(c) {
  if (!isCfg(c)) return false
  if (c.enabled === false) return true
  return (c.mode === 'day' || c.mode === 'hours') && 'play' in c && Boolean(c.next_change) && new Date(c.next_change) > new Date()
}

/** The URL of the clip a config picked, or null for the built-in two-clip welcome. */
export const pickedUrl = (c) => (c?.play && c.play.id !== BUILTIN ? welcomeVideoUrl(c.play.id, c.play.version, c.play.static) : null)

export const getWelcome = (exclude) => get('/welcome', { params: exclude ? { exclude } : undefined }).then(remember)
export const setWelcomeEnabled = (enabled) => put('/welcome/enabled', { enabled }).then(remember)
export const setWelcomeSettings = (body) => put('/welcome/settings', body).then(remember)
// A clip that ships with the frontend (`staticPath`) is played straight from the web server, like the built-in clips; only clips an
// admin uploaded are streamed through the API.
export const welcomeVideoUrl = (id, version, staticPath) => (staticPath ? `${staticPath}?v=${version || 0}` : apiUrl(`/welcome/video/${encodeURIComponent(id)}?v=${version || 0}`))

export const patchWelcomeVideo = (id, body) => put(`/welcome/videos/${encodeURIComponent(id)}`, body).then(remember)
export const deleteWelcomeVideo = (id) => del(`/welcome/videos/${encodeURIComponent(id)}`).then(remember)
export const importWelcomeFolder = () => post('/welcome/import-folder').then(remember)

export const uploadWelcomeVideo = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return api
    .post('/welcome/videos', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
    .then((r) => remember(r.data))
}
