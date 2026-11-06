import { useQuery } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'

/** Quantity on hand of the items on a document's lines, at the document's location (all locations until one is chosen): { [itemId]: qty }. */
export default function useQoh(lines, locId) {
  const ids = [...new Set((lines || []).map((l) => Number(l.item_id)).filter((n) => n > 0))].sort((a, b) => a - b)
  const { data } = useQuery({
    queryKey: ['qoh', locId || 0, ids.join(',')],
    queryFn: () => inventoryApi.getQoh(ids, locId ? Number(locId) : null),
    enabled: ids.length > 0,
    staleTime: 15_000,
  })
  return data || {}
}

export const fmtQoh = (map, itemId) => (itemId && map[itemId] != null ? Number(map[itemId]).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '-')
