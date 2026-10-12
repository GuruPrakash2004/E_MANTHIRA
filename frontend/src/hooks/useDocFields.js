import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../api/endpoints/meta'

/**
 * Live UtlDocDsgrFlds for a document, indexed by FldCode — the same
 * metadata `frmTrnSeva`/`frmTrnPartyDoc` read every time they open, so a
 * change made in the legacy Designer tool takes effect here with zero code
 * changes (CLAUDE.md rule 5). Returns { fields, byCode, isLoading }.
 */
export default function useDocFields(docId) {
  const { data, isLoading } = useQuery({
    queryKey: ['doc-fields', docId],
    queryFn: () => metaApi.getDocFields(docId),
    enabled: Boolean(docId),
  })
  const fields = data?.fields || []
  const byCode = Object.fromEntries(fields.map((f) => [f.FldCode, f]))
  return { fields, byCode, isLoading }
}
