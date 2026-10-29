import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../api/endpoints/meta'

/**
 * The document's UtlTransactions switches (auth_req, freeze, edit_days, edit_doc_date, print_cancelled, allow_copy_from,
 * amendment, file_attach, print_after_save), read live so the Designer's choices apply here without a code change.
 * While loading, every switch is off except `edit_doc_date`, which stays true so the date is never locked by a guess.
 */
const LOADING = { auth_req: false, freeze: false, edit_days: 0, print_cancelled: false, edit_doc_date: true, allow_copy_from: false, amendment: false, file_attach: false, print_after_save: false }

export default function useDocRules(docId) {
  const { data } = useQuery({ queryKey: ['doc-rules', docId], queryFn: () => metaApi.getDocRules(docId), enabled: Boolean(docId), staleTime: 60_000 })
  return data || LOADING
}
