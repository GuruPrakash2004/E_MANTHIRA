import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { loadFormats, printErrorMessage, printNow, rememberFormat } from '../lib/printing'

/**
 * The Options menu of an entry screen's ribbon: the document's print formats (UtlOption) and what clicking one does, exactly as Seva Entry
 * and Donation Receipt Entry do it. Each format acts on its own Print Click, like the legacy ribbon: D = print straight away, anything else
 * = open the preview / print window on that format.
 *
 *   printFormats           the formats for the Options menu
 *   printWithFormat(f)     handler for the menu items (and, with the default format, for the ribbon's Print button)
 *   printOption            the format name the print window should open on (pass it as `initialOption`)
 *   clearPrintOption()     call when the print window closes
 *
 * `viewId` is the saved document that is on screen; `setPrintFor(id)` opens the print window for it.
 */
export default function usePrintFormats(docId, { viewId, setPrintFor, noun = 'document' }) {
  const queryClient = useQueryClient()
  const [printOption, setPrintOption] = useState(null)
  const { data: printFormats = [] } = useQuery({ queryKey: ['print-formats', docId], queryFn: () => loadFormats(docId), staleTime: 60_000 })

  async function printWithFormat(format) {
    if (!viewId) return notifications.show({ message: `Open a saved ${noun} first (Find, List or the arrows), then choose a print option`, color: 'yellow' })
    setPrintOption(format?.option_name || null) // the preview window opens on the very format that was clicked
    if (!format) return setPrintFor(viewId)
    try {
      await rememberFormat(docId, format.option_name)
      // keep the cached list in step with the saved choice, so the ribbon's Print button and the next preview start on it too
      queryClient.setQueryData(['print-formats', docId], (list) => (Array.isArray(list) ? list.map((f) => ({ ...f, selected: f.option_name === format.option_name, preferred: f.option_name === format.option_name })) : list))
      if (String(format.click_operation || '').toUpperCase() === 'D' && format.available) {
        notifications.show({ message: await printNow({ docId, recordId: viewId, format }), color: 'teal' })
      } else setPrintFor(viewId)
    } catch (err) {
      notifications.show({ title: 'Could not print', message: await printErrorMessage(err), color: 'red' })
      setPrintFor(viewId)
    }
  }

  return { printFormats, printWithFormat, printOption, clearPrintOption: () => setPrintOption(null) }
}
