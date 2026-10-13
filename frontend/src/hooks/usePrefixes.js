import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../api/endpoints/meta'

/** Document-number prefixes for a DocID (UtlDocNoPrefix). Rarely changes, so cached for 30 minutes. */
export default function usePrefixes(docId) {
  return useQuery({
    queryKey: ['prefixes', docId],
    queryFn: () => metaApi.getPrefixes(docId),
    enabled: Boolean(docId),
    staleTime: 30 * 60_000,
  })
}
