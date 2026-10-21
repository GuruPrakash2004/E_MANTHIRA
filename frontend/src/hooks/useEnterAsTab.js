const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=hidden]), textarea, select'

/**
 * Counter-staff habit from the legacy app: Enter moves to the next field, Shift+Enter to the previous one.
 * Use as `onKeyDown` on a form container. Leaves Enter alone in a textarea, in a dropdown that is open (Enter
 * picks the highlighted option), on buttons/links, and in any field marked `data-no-enter-tab`.
 */
export default function useEnterAsTab() {
  return function onKeyDown(e) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.nativeEvent?.isComposing) return
    const el = e.target
    if (!(el instanceof HTMLElement) || !el.matches(FIELD) || el.tagName === 'TEXTAREA') return
    if (el.getAttribute('aria-expanded') === 'true' || el.closest('[data-no-enter-tab]')) return
    const fields = [...e.currentTarget.querySelectorAll(FIELD)].filter((f) => !f.disabled && !f.readOnly && f.tabIndex >= 0 && f.offsetParent !== null)
    const i = fields.indexOf(el)
    const next = fields[i + (e.shiftKey ? -1 : 1)]
    if (i < 0 || !next) return
    e.preventDefault()
    next.focus()
    if (typeof next.select === 'function' && next.type !== 'number') next.select()
  }
}
