import { useEffect } from 'react'

// "The first field" = the first control in page order that takes keyboard entry: text boxes, text areas, Mantine selects
// (their input is readOnly when the select is not searchable, but it carries aria-haspopup) and date pickers (a button).
// Checkboxes / radios / plain buttons are not fields. Anything blue-captioned read-only, disabled or hidden is skipped.
const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button[data-dates-input]:not([disabled])',
].join(', ')

const MAX_WAIT_MS = 8000 // a screen that loads its form from the database can take a while on a real server
// An OPEN dialog / drawer carries role="dialog" (Mantine leaves empty `.mantine-Modal-root` shells in the page for every closed
// modal, so those must not count); `.vt-ws` is the welcome overlay.
const OVERLAY_SELECTOR = '[role="dialog"], .vt-ws'
const overlayOpen = () => Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some((el) => el.getClientRects().length > 0)

function isUsable(el) {
  if (!el.getClientRects().length) return false // display:none, or inside a collapsed / unmounted area
  if (getComputedStyle(el).visibility === 'hidden') return false
  if (el.closest('[aria-hidden="true"], [inert], [hidden], [data-no-autofocus], .vt-fld-readonly')) return false
  // a truly read-only box is display, not entry; a select's input is readOnly too but announces a popup
  if (el.tagName === 'INPUT' && el.readOnly && !el.hasAttribute('aria-haspopup') && el.getAttribute('role') !== 'combobox') return false
  if (el.tagName === 'TEXTAREA' && el.readOnly) return false
  return true
}

const isTextEntry = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

function tryFocus(container) {
  if (!container) return false
  // never reach into / behind an open dialog or the welcome overlay: try again once it has gone
  if (overlayOpen()) return false
  // Don't steal a field the user is already typing in. Focus sitting on a button or tab (a menu click, a tab switch) is fine to move.
  const active = document.activeElement
  if (active && container.contains(active) && isTextEntry(active)) return true

  const first = Array.from(container.querySelectorAll(FIELD_SELECTOR)).find(isUsable)
  if (!first) return false
  first.focus({ preventScroll: false })
  if (first.tagName === 'INPUT' && !first.readOnly && typeof first.select === 'function') {
    // Text ready to be typed over, same feel as the legacy EXE's field entry.
    try {
      first.select()
    } catch {
      /* some input types have no selection */
    }
  }
  return document.activeElement === first
}

/**
 * Puts the cursor in the first field of `containerRef` whenever `deps` changes (the route, or a tab on it) - every
 * screen starts ready for keyboard entry without the counter staff clicking in first (this app is keyboard-first,
 * CLAUDE.md). Wired once centrally in AppShellLayout, not per page.
 *
 * Screens that load their form from the database have no fields in the DOM on the first try, so this keeps watching
 * (MutationObserver) until a field is focused, the user starts typing / clicking elsewhere, or MAX_WAIT_MS passes.
 */
export default function useAutoFocusFirstField(containerRef, deps = []) {
  useEffect(() => {
    let done = false
    let observer
    let pending = 0

    const stop = () => {
      done = true
      observer?.disconnect()
      document.removeEventListener('keydown', onUser, true)
      document.removeEventListener('pointerdown', onUser, true)
    }
    // the user took over (typed, clicked a control): stop competing for focus
    function onUser(e) {
      if (e.type === 'keydown' && ['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      stop()
    }
    const attempt = () => {
      pending = 0
      if (done) return
      if (tryFocus(containerRef.current)) stop()
    }
    const schedule = () => {
      if (!pending) pending = setTimeout(attempt, 30) // one try per 30 ms however many DOM changes arrive (a timer, not rAF: rAF is paused in background tabs)
    }

    schedule()
    if (containerRef.current && 'MutationObserver' in window) {
      observer = new MutationObserver(schedule)
      observer.observe(containerRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'aria-hidden'] })
    }
    document.addEventListener('keydown', onUser, true)
    document.addEventListener('pointerdown', onUser, true)
    // while the welcome overlay / a dialog is still up the wait is extended (up to ~1 min), so focus lands when it closes
    let extended = 0
    let timeout = setTimeout(function giveUp() {
      if (!done && overlayOpen() && ++extended < 8) timeout = setTimeout(giveUp, MAX_WAIT_MS)
      else stop()
    }, MAX_WAIT_MS)

    return () => {
      clearTimeout(pending)
      clearTimeout(timeout)
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
