import { useState } from 'react'
import { Card, Group, MultiSelect, Text, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as metaApi from '../../api/endpoints/meta'
import * as mastersApi from '../../api/endpoints/masters'
import { formatINR } from '../../utils/format'

/**
 * "Add more sevas for this devotee": every seva picked here becomes its own bill when the entry is saved, sharing the
 * devotee, Sannidhi, dates and payment on the form. The list is the Seva field's own live lookup (UtlDocDsgrFlds), the
 * rate of each pick is the Seva master's amount, exactly what the server will charge.
 *
 *   value    - [{ id, label, rate }]  (rate is null while it loads)
 *   onChange - receives a function (updater) or an array, like a setState
 */
export default function ExtraSevas({ docId, sevaMasterDocId, mainId, ctx, value, onChange }) {
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 250)
  const { data: found = [] } = useQuery({
    queryKey: ['lookup', docId, 'SVAID', debounced, ctx || null, 'extra'],
    queryFn: () => metaApi.getLookup(docId, 'SVAID', debounced, ctx),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  // the picked ones stay listed even when the current search no longer returns them
  const options = [...value.map((v) => ({ value: String(v.id), label: v.label })), ...found.map((o) => ({ value: String(o.value), label: o.label }))]
    .filter((o, i, all) => o.value !== String(mainId) && all.findIndex((x) => x.value === o.value) === i)

  function pick(ids) {
    const labels = Object.fromEntries(options.map((o) => [o.value, o.label]))
    onChange((cur) => ids.map((id) => cur.find((v) => String(v.id) === id) || { id: Number(id), label: labels[id] || id, rate: null }))
    ids.forEach((id) => {
      if (value.some((v) => String(v.id) === id)) return
      mastersApi
        .getMasterRow(sevaMasterDocId, id)
        .then((row) => onChange((cur) => cur.map((v) => (String(v.id) === id ? { ...v, rate: Number(row?.AMT) || 0 } : v))))
        .catch(() => onChange((cur) => cur.map((v) => (String(v.id) === id ? { ...v, rate: 0 } : v))))
    })
  }

  return (
    <Card withBorder p="lg">
      <Title order={4} mb={2}>More sevas for this devotee</Title>
      <Text size="xs" c="dimmed" mb="sm">
        Each seva you add here is saved as its own bill (own bill no and receipt), with the same devotee, dates and payment as above.
      </Text>
      <MultiSelect
        aria-label="More sevas"
        placeholder={value.length ? undefined : 'Search and pick sevas'}
        searchable
        clearable
        nothingFoundMessage="No seva found"
        data={options}
        value={value.map((v) => String(v.id))}
        onChange={pick}
        searchValue={search}
        onSearchChange={setSearch}
        filter={({ options: opts }) => opts}
        hidePickedOptions
        maxDropdownHeight={260}
      />
      {value.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
          {value.map((v) => (
            <Group key={v.id} justify="space-between" wrap="nowrap">
              <Text size="sm">{v.label}</Text>
              <Text size="sm" fw={600} className="vt-num" c={v.rate === 0 ? 'red' : undefined}>
                {v.rate === null ? '...' : v.rate === 0 ? 'No rate set' : formatINR(v.rate)}
              </Text>
            </Group>
          ))}
        </div>
      )}
    </Card>
  )
}
