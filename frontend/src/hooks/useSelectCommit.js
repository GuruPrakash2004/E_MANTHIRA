import { useEffect, useRef, useState } from 'react'
import { useDebouncedValue } from '@mantine/hooks'
import { fieldScope, focusNextField } from './useEnterAsTab'

/**
 * Shared behaviour of every searchable lookup dropdown (LookupSelect, CoreField):
 *  - typing highlights the first match, so Enter picks it;
 *  - Tab with matching text typed picks the first match instead of throwing the typed text away;
 *  - choosing an option moves the cursor to the next field, so no second Enter is needed;
 *  - text that matches nothing shows "Not found" under the field once the user leaves it.
 * `useOptions(search)` = a hook returning {options: [{value, label}], loading, data} for the debounced search text,
 * `commit(value)` = the owner's onChange for an option value.
 * Returns `options`, `loading`, `data`, `notFound`, `selectProps` (spread on <Select>) and `onBlurCheck`.
 */
export default function useSelectCommit({ useOptions, selectedValue, commit }) {
  const [typed, setTyped] = useState('')
  const [search] = useDebouncedValue(typed, 250)
  const { options, loading, data, failed, reload } = useOptions(search)
  const [notFound, setNotFound] = useState(false)
  const inputRef = useRef(null)
  const latest = useRef({ options, loading, selectedValue })
  latest.current = { options, loading, selectedValue }
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const selectedLabel = () => {
    const { options: list, selectedValue: sel } = latest.current
    return sel == null || sel === '' ? '' : list.find((o) => o.value === String(sel))?.label || ''
  }
  const firstMatch = (text) => {
    const t = text.trim().toLowerCase()
    if (!t) return null
    const list = latest.current.options
    return list.find((o) => o.label.toLowerCase() === t) || list.find((o) => o.label.toLowerCase().startsWith(t)) || list.find((o) => o.label.toLowerCase().includes(t)) || null
  }

  const selectProps = {
    ref: inputRef,
    selectFirstOptionOnChange: true,
    nothingFoundMessage: loading ? 'Loading...' : failed ? 'Could not load this list - check the database connection, then reopen' : 'Not found',
    onSearchChange: (v) => {
      setTyped(v)
      if (v) setNotFound(false)
    },
    onOptionSubmit: () => {
      setNotFound(false)
      const el = inputRef.current
      setTimeout(() => focusNextField(el, fieldScope(el)), 0) // after Mantine has closed the list and stored the value
    },
    onKeyDown: (e) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return
      // an option highlighted with the arrow keys (or the mouse) is chosen by Tab, same as Enter would
      const list = document.getElementById(e.currentTarget.getAttribute('aria-controls') || '')
      const marked = list?.querySelector('[data-combobox-selected]') // only rendered while the list is open
      const markedValue = marked?.getAttribute('value')
      const picked = marked ? latest.current.options.find((o) => o.value === markedValue || o.label === marked.textContent.trim()) : null
      if (picked) {
        if (String(latest.current.selectedValue ?? '') !== picked.value) commit(picked.value)
        setNotFound(false)
        return
      }
      const text = e.currentTarget.value
      if (!text.trim() || text.trim().toLowerCase() === selectedLabel().toLowerCase()) return
      const hit = firstMatch(text)
      if (hit) {
        setNotFound(false)
        commit(hit.value)
      }
    },
  }

  // On leaving the field: text that is neither the chosen option nor a match for anything is reported as "Not found".
  // Judged after a short wait so the list for what was typed has loaded.
  function onBlurCheck(e) {
    const text = e.currentTarget.value.trim()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (latest.current.loading || !text || text.toLowerCase() === selectedLabel().toLowerCase()) return
      setNotFound(!firstMatch(text))
    }, 450)
  }

  return { options, loading, data, notFound, selectProps, onBlurCheck, failed, reload }
}
