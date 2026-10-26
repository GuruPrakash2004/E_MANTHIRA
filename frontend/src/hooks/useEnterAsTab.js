const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=hidden]), textarea, select'

/** Moves the cursor to the next (or previous) field inside `scope`, the way Tab would. Returns whether it moved. */
export function focusNextField(el, scope, back = false) {
  if (!(el instanceof HTMLElement) || !scope) return false
  const fields = [...scope.querySelectorAll(FIELD)].filter((f) => !f.disabled && !f.readOnly && f.tabIndex >= 0 && f.offsetParent !== null)
  const i = fields.indexOf(el)
  const next = fields[i + (back ? -1 : 1)]
  if (i < 0 || !next) return false
  next.focus()
  if (typeof next.select === 'function' && next.type !== 'number') next.select()
  return true
}

/** The container Enter-as-Tab works inside for a field: the entry form, a dialog, or any form. */
export function fieldScope(el) {
  return el?.closest?.('.vt-entry-main, [role="dialog"], form') || null
}

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
    if (focusNextField(el, e.currentTarget, e.shiftKey)) e.preventDefault()
  }
}
