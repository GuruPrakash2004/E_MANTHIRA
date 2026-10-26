import { useEffect, useState } from 'react'
import { Badge, Button, Checkbox, Chip, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import * as panchangaApi from '../../api/endpoints/panchanga'
import { WEEKDAY_LABELS, datesInRange } from '../../utils/dateRange'
import { isoDate } from '../../utils/format'

/**
 * "Add range" for the seva dates: type the From and To dates (DD-MMM-YYYY), optionally tick weekdays (all Mondays ...) or
 * only the days that have a Panchanga event, see exactly which dates will be added - each with its Panchanga event from the
 * temple calendar (MstPanch) - and add them in one go.
 */
export default function SevaRangeModal({ opened, onClose, existing = [], onAdd }) {
  const [from, setFrom] = useState(null)
  const [to, setTo] = useState(null)
  const [days, setDays] = useState([])
  const [onlyEvents, setOnlyEvents] = useState(false)

  useEffect(() => {
    if (opened) {
      setFrom(new Date())
      setTo(null)
      setDays([])
      setOnlyEvents(false)
    }
  }, [opened])

  const fromIso = from ? isoDate(from) : ''
  const toIso = to ? isoDate(to) : ''
  const valid = Boolean(from && to && !dayjs(to).isBefore(dayjs(from), 'day'))

  // the Panchanga events of the whole range, straight from the database
  const { data: events = [], isFetching } = useQuery({
    queryKey: ['panchanga', 'range', fromIso, toIso],
    queryFn: () => panchangaApi.listPanchanga(fromIso, toIso),
    enabled: opened && valid,
    staleTime: 60_000,
  })
  const eventOf = Object.fromEntries(events.filter((e) => e.name).map((e) => [e.date, e.name]))

  const have = new Set(existing)
  const picked = valid ? datesInRange(from, to, days).filter((iso) => !onlyEvents || eventOf[iso]) : []
  const fresh = picked.filter((iso) => !have.has(iso))

  return (
    <Modal opened={opened} onClose={onClose} title="Add seva dates for a range" size="lg" radius="lg">
      <Stack gap="md">
        <Group align="flex-start" grow>
          <DateInput
            label="From"
            value={from}
            onChange={(v) => {
              setFrom(v)
              if (v && to && dayjs(to).isBefore(dayjs(v), 'day')) setTo(null)
            }}
            data-autofocus
          />
          <DateInput
            label="To"
            value={to}
            minDate={from || undefined}
            onChange={setTo}
            error={from && to && !valid ? 'To must not be before From' : undefined}
          />
        </Group>

        <div>
          <Text size="sm" fw={500} mb={4}>Only on these days</Text>
          <Chip.Group multiple value={days.map(String)} onChange={(v) => setDays(v.map(Number))}>
            <Group gap={6}>
              {WEEKDAY_LABELS.map((label, i) => (
                <Chip key={label} value={String(i)} size="sm" color="kumkum" variant="light">{label}</Chip>
              ))}
            </Group>
          </Chip.Group>
          <Text size="xs" c="dimmed" mt={4}>Leave all unticked to add every day in the range.</Text>
        </div>

        <Checkbox color="kumkum" label="Only days that have a Panchanga event" checked={onlyEvents} onChange={(e) => setOnlyEvents(e.currentTarget.checked)} />

        <div>
          <Text size="sm" fw={500} mb={4}>
            {valid ? `${picked.length} date${picked.length === 1 ? '' : 's'} in this range${picked.length > fresh.length ? ` (${picked.length - fresh.length} already added)` : ''}` : 'Choose From and To to see the dates'}
            {isFetching ? ' ...' : ''}
          </Text>
          {valid && picked.length > 0 && (
            <ScrollArea.Autosize mah={240} type="auto">
              <Table verticalSpacing={4} fz="sm">
                <Table.Tbody>
                  {picked.map((iso) => (
                    <Table.Tr key={iso} style={have.has(iso) ? { opacity: 0.5 } : undefined}>
                      <Table.Td className="vt-num" w={110}>{dayjs(iso).format('DD-MMM-YYYY')}</Table.Td>
                      <Table.Td w={70}>{dayjs(iso).format('ddd')}</Table.Td>
                      <Table.Td>
                        {eventOf[iso] && <Badge variant="light" color="gold" tt="none">{eventOf[iso]}</Badge>}
                        {have.has(iso) && <Text span size="xs" c="dimmed" ml={6}>already added</Text>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
          {valid && picked.length >= 366 && <Text size="xs" c="red" mt={4}>Only the first 366 days are listed.</Text>}
        </div>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button
            color="kumkum"
            disabled={fresh.length === 0}
            onClick={() => {
              onAdd(fresh)
              onClose()
            }}
          >
            {fresh.length ? `Add ${fresh.length} date${fresh.length === 1 ? '' : 's'}` : 'Add dates'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
