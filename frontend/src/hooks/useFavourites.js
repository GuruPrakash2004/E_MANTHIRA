import { useCallback, useEffect, useState } from 'react'

// Pinned sidebar screens, remembered per signed-in user in this browser (localStorage).
// Each entry is { to, caption }. Pinning is a shortcut only, nothing is written to the database.
function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v.filter((x) => x && x.to && x.caption) : []
  } catch {
    return []
  }
}

export default function useFavourites(userCode) {
  const key = `vt-favs:${userCode || 'anon'}`
  const [favs, setFavs] = useState(() => read(key))

  useEffect(() => setFavs(read(key)), [key])

  const isPinned = useCallback((to) => favs.some((f) => f.to === to), [favs])

  const toggle = useCallback(
    (item) => {
      setFavs((prev) => {
        const next = prev.some((f) => f.to === item.to) ? prev.filter((f) => f.to !== item.to) : [...prev, { to: item.to, caption: item.caption }]
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* storage full or blocked: keep the in-memory list */
        }
        return next
      })
    },
    [key]
  )

  return { favs, isPinned, toggle }
}
