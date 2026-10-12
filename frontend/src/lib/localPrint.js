// Talks to the vTemple Print Agent — a tiny Windows program (one per
// counter PC, see backend/tools/printagent/) listening on
// 127.0.0.1:8787 of THIS PC. A browser page can't list a PC's printers or
// print to them without a dialog; the agent closes that gap. Framework
// independent, plain fetch — see backend/tools/printagent/README.md for
// the protocol and security model.
import { api } from '../api/api'

const BASE = 'http://127.0.0.1:8787'
const AGENT_ID = 'vtemple-print-agent'
const FRESH_MS = 20000 // how long a successful detection is trusted
const RETRY_MS = 3000 // how soon we try again after failing to find it

let cache = null // {host, default, printers} | null
let cacheAt = 0

async function probe(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/health`, { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    if (data.agent !== AGENT_ID) return null
    return { host: data.host, default: data.default, printers: data.printers || [] }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Looks for the agent (600ms timeout), remembering the result for 20s (3s
 * while missing) so repeated calls don't keep hitting the network. */
export async function detectAgent() {
  const now = Date.now()
  const ttl = cache ? FRESH_MS : RETRY_MS
  if (cache !== null && now - cacheAt < ttl) return cache
  const result = await probe(600)
  cache = result
  cacheAt = now
  return result
}

/** Whatever is already known, right now — never waits on the network.
 * Use this on the hot path (save/print); never block a save on it. */
export function agentNow() {
  return cache
}

/** Fire-and-forget refresh in the background (e.g. on page load, or while
 * the agent isn't installed yet — the Settings panel polls with this). */
export function warmAgent() {
  detectAgent().catch(() => {})
}

/** Sends already-rendered pages straight to a printer on THIS PC. */
export async function printOnThisPc(pages, { printer, copies, name } = {}) {
  const origin = window.location.origin
  let res
  try {
    res = await fetch(`${BASE}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer: printer || '', copies: copies || 1, name: name || '', pages }),
    })
  } catch {
    cache = null
    cacheAt = 0
    throw new Error(`Could not reach the Print Agent on this PC. Check Print Settings.`)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Print Agent refused the job (${res.status})`)
  }
  void origin
  return res.json()
}

/** Asks the server to render a document's pages (POST /print/pages-style
 * endpoint), then sends them straight to a printer on THIS PC. */
export async function printDocumentOnThisPc(pagesUrl, printer) {
  const { data } = await api.get(pagesUrl)
  return printOnThisPc(data.pages, { printer, copies: data.copies, name: data.name })
}

const STORAGE_KEY = 'vtemple_printer'

/** The printer the user picked for this PC, prefixed `pc:` so it can be
 * told apart from a server-side (UtlOption.DirectPrinterName) choice. */
export function getRememberedPrinter() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v && v.startsWith('pc:') ? v.slice(3) : null
  } catch {
    return null
  }
}

export function rememberPrinter(printerName) {
  try {
    localStorage.setItem(STORAGE_KEY, `pc:${printerName}`)
  } catch {
    // ignore (private browsing, storage disabled, etc.)
  }
}
