import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as panchangaApi from '../../api/endpoints/panchanga'

/** The panchanga events of the month that contains `date`, keyed by YYYY-MM-DD: `{ '2026-11-12': {date, name, color} }`.
 * Same query key as the Panchanga page, so both share one cached request. */
export default function usePanchangaMonth(date) {
  const from = dayjs(date || new Date()).startOf('month')
  const { data } = useQuery({
    queryKey: ['panchanga', from.format('YYYY-MM-DD')],
    queryFn: () => panchangaApi.listPanchanga(from.format('YYYY-MM-DD'), from.endOf('month').format('YYYY-MM-DD')),
    staleTime: 5 * 60_000,
  })
  return Object.fromEntries((data || []).filter((d) => d.name).map((d) => [d.date, d]))
}
