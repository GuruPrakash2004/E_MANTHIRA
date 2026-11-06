/**
 * One browser tab per screen. Opening a different screen from the sidebar opens it in a new tab; if that screen is
 * already open in another tab of this app, that tab is brought forward instead of opening a duplicate.
 *
 * Every tab names itself `vt:<route>` (window.name) and answers on a BroadcastChannel, so any tab can ask
 * "does anyone already have this screen?". Browsers only let a page focus a tab it opened itself, so switching is
 * best effort: the owning tab also flashes its title so the person can spot it.
 */
const CHANNEL = 'vt-tabs'
const PREFIX = 'vt:'
const WAIT_MS = 160

let channel = null
let currentKey = ''
const getChannel = () => {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = ({ data }) => {
    if (!data || data.key !== currentKey) return
    if (data.type === 'who') channel.postMessage({ type: 'have', key: data.key, id: data.id })
    if (data.type === 'focus') {
      try {
        window.focus()
      } catch {
        /* the browser may refuse; the title flash below still helps */
      }
      flashTitle()
    }
  }
  return channel
}

export const routeKey = (to) => String(to || '/').split('#')[0].replace(/\/+$/, '') || '/'

/** Call on every route change: names this tab after the screen it shows. */
export function registerTab(path) {
  currentKey = routeKey(path)
  try {
    window.name = PREFIX + currentKey
  } catch {
    /* ignore */
  }
  getChannel()
}

function flashTitle() {
  const original = document.title
  let n = 0
  const t = setInterval(() => {
    document.title = n % 2 === 0 ? '● Opened here' : original
    if (++n > 7) {
      clearInterval(t)
      document.title = original
    }
  }, 500)
}

/** Open `to` in its own tab (or switch to the tab that already has it). Resolves true when it handled the navigation. */
export function openInTab(to) {
  const key = routeKey(to)
  if (key === currentKey || typeof window === 'undefined') return false
  const ch = getChannel()
  const target = PREFIX + key
  const open = () => {
    const w = window.open(to, target)
    return Boolean(w)
  }
  if (!ch) return open()
  // ask every tab whether it already shows this screen; the answer arrives within a moment
  const id = Math.random().toString(36).slice(2)
  let owned = false
  const on = ({ data }) => {
    if (data?.type === 'have' && data.id === id) owned = true
  }
  ch.addEventListener('message', on)
  ch.postMessage({ type: 'who', key, id })
  setTimeout(() => {
    ch.removeEventListener('message', on)
    if (owned) {
      ch.postMessage({ type: 'focus', key })
      const w = window.open('', target) // reuses the named tab without reloading it when it is in our window group
      try {
        if (w && w.document.URL === 'about:blank' && !w.document.body?.children.length) w.location.href = to
        else w?.focus()
      } catch {
        /* cross-context: the tab was told to focus itself */
      }
    } else {
      open()
    }
  }, WAIT_MS)
  return true
}
