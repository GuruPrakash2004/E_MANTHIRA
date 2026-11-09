/**
 * After New on an entry screen: bring the page back to its top and put the cursor in the first field, so the clerk never starts a
 * fresh bill half-way down the page. Called by the ribbon's New button and by the Alt+N shortcut, so every entry screen gets it.
 */
export function scrollEntryToTop() {
  try {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const behavior = smooth ? 'smooth' : 'auto'
    window.scrollTo({ top: 0, behavior })
    document.querySelector('.vt-app-main')?.scrollTo?.({ top: 0, behavior })
    // the form re-renders (blank, defaults) first; focus the first usable field once it is there, without letting focus scroll the page
    window.setTimeout(() => {
      const first = document.querySelector('.vt-entry-main input:not([disabled]):not([readonly]):not([type="hidden"]), .vt-entry-main textarea:not([disabled]):not([readonly])')
      first?.focus?.({ preventScroll: true })
    }, 120)
  } catch {
    /* scrolling is a nicety: never break New */
  }
}
