import { useState } from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { reloadDesigner } from '../api/endpoints/meta'

// ADMIN-only "Refresh from Doc Designer": the server forgets its cached designer metadata, then every
// cached query (doc fields, menu, lookups) is refetched so open screens redraw. Nothing else re-reads it.
export default function DesignerRefreshButton() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    setBusy(true)
    try {
      await reloadDesigner()
      await qc.invalidateQueries()
      notifications.show({ message: 'Refreshed from Doc Designer', color: 'kumkum' })
    } catch {
      notifications.show({ message: 'Could not refresh from Doc Designer', color: 'red' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Tooltip label="Refresh from Doc Designer" withArrow>
      <ActionIcon variant="light" color="kumkum" size={40} aria-label="Refresh from Doc Designer" loading={busy} onClick={onClick}>
        <RefreshCw size={18} aria-hidden />
      </ActionIcon>
    </Tooltip>
  )
}
