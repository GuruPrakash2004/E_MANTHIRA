import { useQuery } from '@tanstack/react-query'
import * as alertifyApi from '../api/endpoints/alertify'

/** Alertify on/off + readiness, from Temple Settings. Any signed-in user may read it (no secrets). */
export default function useAlertifyConfig() {
  const { data } = useQuery({ queryKey: ['alertify-config'], queryFn: alertifyApi.getAlertifyConfig, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, retry: false })
  return { enabled: Boolean(data?.enabled), ready: Boolean(data?.ready), defaultTime: data?.default_time || '11:00' }
}
