import { useEffect, useState } from 'react'
import { Button, Checkbox, Group, Modal, ScrollArea, Skeleton, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'

/**
 * "Which Sannidhis do you use?" - lists every Sannidhi of the temple (the Designer's own SANNIDHIID list) and lets this
 * user tick the ones their counter works with. Seva Entry then offers only those (none ticked = all of them).
 */
export default function SannidhiShortlistModal({ opened, onClose, docId, field = 'SANNIDHIID', selected, onSave }) {
  const { data: all = [], isLoading } = useQuery({
    queryKey: ['lookup', docId, field, '', null],
    queryFn: () => metaApi.getLookup(docId, field, ''),
    enabled: opened,
    staleTime: 30_000,
  })
  const [picked, setPicked] = useState([])
  useEffect(() => {
    if (opened) setPicked(selected.map(String))
  }, [opened, selected])

  const options = all.filter((o) => Number(o.value) !== 0)
  return (
    <Modal opened={opened} onClose={onClose} title="My Sannidhis" radius="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Tick the Sannidhis you use. Seva Entry will show only these. Leave all unticked to see every Sannidhi.
        </Text>
        {isLoading ? (
          <Skeleton height={120} />
        ) : (
          <ScrollArea.Autosize mah={320}>
            <Checkbox.Group value={picked} onChange={setPicked}>
              <Stack gap={8}>
                {options.map((o) => (
                  <Checkbox key={o.value} value={String(o.value)} label={o.label} color="kumkum" />
                ))}
              </Stack>
            </Checkbox.Group>
          </ScrollArea.Autosize>
        )}
        <Group justify="space-between">
          <Button variant="subtle" color="gray" onClick={() => setPicked([])}>Clear all</Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button color="kumkum" onClick={() => { onSave(picked.map(Number)); onClose() }}>Save</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}
