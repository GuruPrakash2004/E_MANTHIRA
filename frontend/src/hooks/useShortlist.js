import { useCallback, useState } from 'react'

/**
 * A per-user, per-browser shortlist of ids (e.g. the Sannidhis this counter uses), kept in localStorage under
 * `vt-shortlist:<name>:<user>`. An empty shortlist means "no filter - show everything".
 */
export default function useShortlist(name, user) {
  const key = `vt-shortlist:${name}:${user || ''}`
  const [ids, setIdsState] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || '[]')
      return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []
    } catch {
      return []
    }
  })
  const setIds = useCallback(
    (next) => {
      const clean = [...new Set(next.map(Number).filter(Number.isFinite))]
      setIdsState(clean)
      try {
        if (clean.length) localStorage.setItem(key, JSON.stringify(clean))
        else localStorage.removeItem(key)
      } catch {
        /* storage blocked: the choice lasts until the page is closed */
      }
    },
    [key]
  )
  return [ids, setIds]
}
