import { useHotkeys } from 'react-hotkeys-hook'

/** F10 = print the report on screen (works while a filter field is focused). Pass a function that does nothing when there is nothing to print. */
export default function usePrintKey(onPrint) {
  useHotkeys('f10', (e) => { e.preventDefault(); onPrint?.() }, { enableOnFormTags: true })
}
