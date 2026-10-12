import { useEffect } from 'react'

// Text-like, enabled, visible fields only — checkboxes/radios don't take a
// text cursor, so they're not what "land in the first field" means here.
const FOCUSABLE_SELECTOR =
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])'

const MAX_WAIT_MS = 2000 // give a query-loading screen time to render its form before giving up

function isVisible(el) {
  return el.offsetParent !== null
}

function tryFocus(container) {
  if (!container) return false
  // Don't steal focus the user already placed (e.g. clicked a field before
  // this ran), and never reach into an open modal/drawer from the page
  // behind it — Mantine already focuses those on its own.
  const active = document.activeElement
  if (active && active !== document.body && container.contains(active)) return true
  if (document.querySelector('.mantine-Modal-root, .mantine-Drawer-root')) return true

  const first = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).find(isVisible)
  if (!first) return false
  first.focus()
  if (first.tagName === 'INPUT' && typeof first.select === 'function') {
    // Text ready to be typed over, same feel as the legacy EXE's field entry.
    first.select()
  }
  return true
}

/**
 * Puts the cursor in the first field of `containerRef` whenever `deps`
 * changes (the route, typically) — every screen should start ready for
 * keyboard entry without the counter staff having to click in first (this
 * app is keyboard-first, CLAUDE.md §9). Wired once centrally in
 * AppShellLayout rather than per page.
 *
 * Content that depends on a query (e.g. a page showing a Loader first) may
 * not have its fields in the DOM yet on the first attempt, so this keeps
 * retrying via MutationObserver for up to MAX_WAIT_MS rather than giving
 * up after one try.
 */
export default function useAutoFocusFirstField(containerRef, deps = []) {
  useEffect(() => {
    let done = false
    let observer

    const attempt = () => {
      if (done) return
      if (tryFocus(containerRef.current)) {
        done = true
        observer?.disconnect()
      }
    }

    const raf = requestAnimationFrame(attempt)

    if (containerRef.current && 'MutationObserver' in window) {
      observer = new MutationObserver(attempt)
      observer.observe(containerRef.current, { childList: true, subtree: true })
    }

    const timeout = setTimeout(() => {
      done = true
      observer?.disconnect()
    }, MAX_WAIT_MS)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timeout)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
