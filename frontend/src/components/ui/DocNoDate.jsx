import { Group, TextInput } from '@mantine/core'
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DateInput } from './AppDates'
import * as metaApi from '../../api/endpoints/meta'

/**
 * Bill no + bill date of an entry screen, for the right of its title row (PageHeader `right`): the prefix, the number the
 * next save will get and its printed form, then the date. While a saved record is open the number is that record's.
 *
 *   docId      the document (UtlTransactions.DocID)
 *   prefix / type   what picks the number series (optional; the document's first allowed prefix by default)
 *   fetchNo    optional override () => Promise<{ prefix, seq, print_no }> for documents whose series depends on something else (Seva: the Sannidhi)
 *   viewNo     printed number of the record being viewed (hides the preview)
 *   dateLabel  caption above the date
 */
export default function DocNoDate({ docId, prefix, type, fetchNo, queryExtra = '', viewNo, date, onDate, dateDisabled = false, dateLabel = 'Date', dateAria, noDate = false, enabled = true }) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const again = () => queryClient.invalidateQueries({ queryKey: ['doc-next-no'] })
    window.addEventListener('vt-doc-written', again)
    return () => window.removeEventListener('vt-doc-written', again)
  }, [queryClient])
  const { data: nextNo } = useQuery({
    queryKey: ['doc-next-no', docId, prefix ?? null, type ?? null, queryExtra],
    queryFn: () => (fetchNo ? fetchNo() : metaApi.getDocNextNo(docId, { ...(prefix != null && prefix !== '' ? { prefix } : {}), ...(type ? { type } : {}) })),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 0,
  })
  const label = `${nextNo?.short_form || 'Bill'} No.`
  const caption = { fontWeight: 700, fontSize: 'var(--mantine-font-size-sm)', whiteSpace: 'nowrap' }
  // the bill number itself: solid maroon with gold text so it stands out, for a new entry and for a saved record alike
  const strong = { background: 'linear-gradient(160deg, var(--vt-g1) 0%, var(--vt-g3) 100%)', color: '#F4E1A6', border: '1px solid rgba(244,225,166,0.35)', fontWeight: 800, letterSpacing: 0.4, fontSize: 'var(--mantine-font-size-md)', height: 36, paddingInline: 14, borderRadius: 10, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }
  const box = { input: { textAlign: 'center', fontWeight: 600 } }
  return (
    <Group gap="md" align="center" wrap="nowrap" data-no-autofocus style={{ whiteSpace: 'nowrap' }}>
      {viewNo || nextNo ? (
        <Group gap={8} wrap="nowrap" align="center" aria-label="Bill number">
          <span style={caption}>{label}</span>
          {!viewNo && nextNo && (
            <>
              <TextInput value={nextNo.prefix || ''} readOnly w={64} aria-label="Prefix" styles={box} />
              <TextInput value={String(nextNo.seq)} readOnly w={76} aria-label="Number" styles={{ input: { textAlign: 'center', fontWeight: 800 } }} />
            </>
          )}
          <span style={strong} aria-label="Printed bill number">{viewNo || nextNo?.print_no}</span>
        </Group>
      ) : null}
      {!noDate && (
        <Group gap={8} wrap="nowrap" align="center">
          <span style={caption}>{dateLabel}</span>
          <DateInput aria-label={dateAria || 'Document date'} valueFormat="DD-MMM-YYYY" value={date} onChange={(v) => v && onDate(v)} disabled={dateDisabled} className={dateDisabled ? 'vt-docdate-locked' : undefined} w={150} />
        </Group>
      )}
    </Group>
  )
}
