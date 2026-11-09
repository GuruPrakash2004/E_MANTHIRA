import { useState } from 'react'
import { Alert, Badge, Button, Card, Group, Select, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Printer } from 'lucide-react'
import * as printOptionsApi from '../../api/endpoints/printOptions'

/**
 * "Print service printer": the Windows default printer of the PC that runs the print service. Crystal Reports asks it about paper
 * each time a report opens, so an offline network printer there makes the first preview of every report wait about 45 seconds.
 * Picking a reachable one here applies it right away and again every time the print service starts (ADMIN only).
 */
export default function ServicePrinterCard({ printers, isAdmin }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['service-printer'], queryFn: printOptionsApi.getServicePrinter, staleTime: 10_000 })
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const current = data?.current || ''
  const value = pick ?? current
  const list = [...new Set([...(printers || []), ...(current ? [current] : [])])]

  async function save() {
    setBusy(true)
    try {
      const r = await printOptionsApi.setServicePrinter(value)
      notifications.show({ message: r.message, color: 'teal', autoClose: 8000 })
      setPick(null)
      queryClient.invalidateQueries({ queryKey: ['service-printer'] })
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not change the printer', color: 'red' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card withBorder p="sm">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Select
          label="Print service printer"
          description="The default printer of the PC that runs the print service. Reports open slowly while it is an offline network printer."
          leftSection={<Printer size={16} />}
          searchable
          data={list}
          value={value || null}
          onChange={(v) => setPick(v)}
          disabled={!isAdmin}
          w={420}
        />
        <Button color="kumkum" loading={busy} disabled={!isAdmin || !value || value === current} onClick={save}>Apply</Button>
        {!isAdmin && <Text size="xs" c="dimmed">Only ADMIN can change this.</Text>}
        {current && <Badge variant="light" color={data?.is_network ? 'orange' : 'teal'} tt="none">Now: {current}</Badge>}
      </Group>
      {data?.is_network && (
        <Alert mt="sm" color="orange" variant="light" icon={<AlertTriangle size={16} />}>
          The default printer is a network printer. If it is switched off or not reachable, every report takes about 45 seconds to open the first time. Choose a local printer (for example Microsoft Print to PDF) and press Apply.
        </Alert>
      )}
    </Card>
  )
}
