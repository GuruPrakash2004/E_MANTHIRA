import { useMemo } from 'react'
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
    staleTime: 30_000, // the server notices Designer edits within seconds, so re-read soon
  })
  const fields = useMemo(() => data?.fields || [], [data])
  const byCode = useMemo(() => Object.fromEntries(fields.map((f) => [f.FldCode, f])), [fields])
  return { fields, byCode, isLoading }
}
