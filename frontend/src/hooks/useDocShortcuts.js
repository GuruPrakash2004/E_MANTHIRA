import { useHotkeys } from 'react-hotkeys-hook'

/**
 * The legacy vTemple7.exe hot-key set (CLAUDE.md §9) — counter staff only
 * have a keyboard for billing, so these need to work the same way here.
 * A screen wires only the actions it actually has; anything omitted is
 * simply not bound. Alt+ combos fire even while a form field is focused
 * (that's the whole point — Alt+S to save mid-entry); the navigation keys
 * (Shift+Arrow, Ctrl+Shift+F/L/S) are left to normal text-field behavior
 * while typing, same as the legacy app's own field-vs-grid focus handling.
 *
 *   Alt+N  New       Alt+E  Edit     Alt+S  Save      Alt+D  Delete
 *   Alt+C  Cancel    Alt+P  Print    Alt+O  Options   Alt+L  Close
 *   Shift+←/→  prev/next record      Ctrl+Shift+F/L  first/last record
 *   Ctrl+Shift+S  find
 */
export default function useDocShortcuts({
  onNew,
  onEdit,
  onSave,
  onDelete,
  onCancel,
  onPrint,
  onOptions,
  onClose,
  onPrev,
  onNext,
  onFirst,
  onLast,
  onFind,
} = {}) {
  const altOpts = { enableOnFormTags: true, preventDefault: true }
  const navOpts = { enableOnFormTags: false, preventDefault: true }

  useHotkeys('alt+n', (e) => { e.preventDefault(); onNew?.() }, altOpts, [onNew])
  useHotkeys('alt+e', (e) => { e.preventDefault(); onEdit?.() }, altOpts, [onEdit])
  useHotkeys('alt+s', (e) => { e.preventDefault(); onSave?.() }, altOpts, [onSave])
  useHotkeys('alt+d', (e) => { e.preventDefault(); onDelete?.() }, altOpts, [onDelete])
  useHotkeys('alt+c', (e) => { e.preventDefault(); onCancel?.() }, altOpts, [onCancel])
  useHotkeys('alt+p', (e) => { e.preventDefault(); onPrint?.() }, altOpts, [onPrint])
  useHotkeys('alt+o', (e) => { e.preventDefault(); onOptions?.() }, altOpts, [onOptions])
  useHotkeys('alt+l', (e) => { e.preventDefault(); onClose?.() }, altOpts, [onClose])
  useHotkeys('shift+left', (e) => { e.preventDefault(); onPrev?.() }, navOpts, [onPrev])
  useHotkeys('shift+right', (e) => { e.preventDefault(); onNext?.() }, navOpts, [onNext])
  useHotkeys('ctrl+shift+f', (e) => { e.preventDefault(); onFirst?.() }, navOpts, [onFirst])
  useHotkeys('ctrl+shift+l', (e) => { e.preventDefault(); onLast?.() }, navOpts, [onLast])
  useHotkeys('ctrl+shift+s', (e) => { e.preventDefault(); onFind?.() }, navOpts, [onFind])
}
