import { createContext, useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMenu } from '../api/endpoints/meta'

/**
 * The signed-in user's rights on a screen, from the same menu data the server enforces (MstRoleRights / MstUserRights, served
 * on each GET /meta/menu row as a 12-character string; position 1 Add, 2 Edit, 3 Delete, 4 Print, 5 View, 6/7 Authorise).
 * A screen the menu does not list is treated as allowed here, exactly as the server does; the server still has the last word.
 *
 *   useRights()         - the screen the user is on (the shell supplies its menu row through RightsContext)
 *   useRights(docId)    - the menu row that opens that DocID
 */
export const RightsContext = createContext(null)

const OPEN = '1'.repeat(12)

export function rightsFrom(row) {
  const s = row && row.rights ? String(row.rights) : OPEN // no row, or no rights on it: nothing to restrict by
  const at = (n) => s[n - 1] === '1'
  return { known: Boolean(row), string: s, add: at(1), edit: at(2), del: at(3), print: at(4), view: at(5), auth: at(6), at }
}

export default function useRights(docId = null) {
  const screen = useContext(RightsContext)
  const { data: menu } = useQuery({ queryKey: ['menu'], queryFn: getMenu, staleTime: 5 * 60_000, enabled: Boolean(docId) })
  return useMemo(() => {
    if (docId) return rightsFrom((menu || []).find((m) => Number(m.doc_id) === Number(docId)) || null)
    return rightsFrom(screen)
  }, [docId, menu, screen])
}
