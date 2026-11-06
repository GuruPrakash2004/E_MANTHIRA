import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PrintPickerModal from '../components/PrintPickerModal'
import { directPrintRecord, loadFormats } from '../lib/printing'
import useRights from './useRights'

/**
 * Preview and Print for any row of a history list or the full listing of a document.
 *   can        - this document has print formats and the user may print (otherwise show no buttons)
 *   preview(id)- open the print dialog for that record (page preview first, then Print from there)
 *   print(id)  - print straight away (the Print Agent / server printer as the user set up; the dialog opens if that fails)
 *   dialog     - the dialog element: render it once next to the list
 * Formats come from UtlOption through the print API, so a document without a print format simply shows no buttons.
 */
export default function useRowPrint(docId, title) {
  const rights = useRights(docId)
  const [printFor, setPrintFor] = useState(null)
  const { data: formats } = useQuery({ queryKey: ['print-formats', docId], queryFn: () => loadFormats(docId), enabled: Boolean(docId), staleTime: 5 * 60_000, retry: false })
  const can = Boolean(docId) && rights.print && Array.isArray(formats) && formats.length > 0

  const preview = useCallback((id) => setPrintFor(id), [])
  const print = useCallback((id) => directPrintRecord({ docId, recordId: id, openDialog: setPrintFor }), [docId])
  const dialog = docId ? <PrintPickerModal opened={printFor != null} onClose={() => setPrintFor(null)} docId={docId} recordId={printFor} title={title} /> : null
  return { can, preview, print, dialog }
}
