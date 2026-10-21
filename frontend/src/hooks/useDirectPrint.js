import { useCallback } from 'react'
import { directPrintRecord } from '../lib/printing'

/** Returns `(recordId) => void`: F10 / "print now" for a document, falling back to the print dialog on failure. */
export default function useDirectPrint(docId, openDialog) {
  return useCallback((recordId) => directPrintRecord({ docId, recordId, openDialog }), [docId, openDialog])
}
