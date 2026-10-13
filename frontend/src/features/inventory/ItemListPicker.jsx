import { useState } from 'react'
import { Button, Checkbox, Group, Modal, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import * as inventoryApi from '../../api/endpoints/inventory'

/**
 * "Select Item" box of the legacy stock reports: type to find an item and press Enter / "+" to add it, or use "..." to
 * tick several; the chosen items collect in the Selected Item list (Clear List empties it).
 *   value: [{ id, code, name }]    onChange(list)
 */
export default function ItemListPicker({ value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const { data: found = [] } = useQuery({ queryKey: ['ref-items', q], queryFn: () => inventoryApi.referencerItems(q), enabled: q.trim().length > 0 })

  const add = (items) => {
    const have = new Set(value.map((v) => v.id))
    onChange([...value, ...items.filter((i) => !have.has(i.id))])
  }
  const addTyped = () => {
    const t = q.trim().toLowerCase()
    const exact = found.find((i) => i.code.toLowerCase() === t) || (found.length === 1 ? found[0] : null)
    if (exact) {
      add([exact])
      setQ('')
    } else {
      setOpen(true)
    }
  }

  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          aria-label="Select Item"
          placeholder="Select Item"
          leftSection={<Search size={15} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTyped()}
        />
        <Button variant="default" px={10} aria-label="Add item" onClick={addTyped}><Plus size={16} /></Button>
        <Button variant="default" px={10} aria-label="Pick several items" onClick={() => setOpen(true)}>...</Button>
      </Group>
      <div style={{ border: '1px solid var(--vt-line)', borderRadius: 10, background: 'var(--vt-surface)' }}>
        <div style={{ padding: '6px 10px', fontWeight: 700, fontSize: 13, background: 'var(--vt-sandal)', borderRadius: '10px 10px 0 0', textAlign: 'center' }}>Selected Item</div>
        <ScrollArea h={96}>
          {value.length === 0 ? (
            <Text size="xs" c="dimmed" p="xs">No item selected (all items)</Text>
          ) : (
            value.map((v) => (
              <Group key={v.id} justify="space-between" px="xs" py={3} wrap="nowrap">
                <Text size="sm" truncate>{v.code} · {v.name}</Text>
                <UnstyledButton aria-label={`Remove ${v.code}`} onClick={() => onChange(value.filter((x) => x.id !== v.id))}><X size={14} /></UnstyledButton>
              </Group>
            ))
          )}
        </ScrollArea>
      </div>
      <UnstyledButton onClick={() => onChange([])} style={{ alignSelf: 'flex-end', color: 'var(--vt-accent)', fontWeight: 700, fontSize: 13, textDecoration: 'underline' }}>
        Clear List
      </UnstyledButton>
      {open && <ItemsDialog already={value} onClose={() => setOpen(false)} onApply={(items) => { add(items); setOpen(false) }} initial={q} />}
    </Stack>
  )
}

function ItemsDialog({ already, initial, onClose, onApply }) {
  const [q, setQ] = useState(initial || '')
  const { data: items = [] } = useQuery({ queryKey: ['ref-items-dlg', q], queryFn: () => inventoryApi.referencerItems(q) })
  const [sel, setSel] = useState(new Map())
  const have = new Set(already.map((a) => a.id))
  const list = items.filter((i) => !have.has(i.id))
  const toggle = (i) => setSel((m) => { const n = new Map(m); n.has(i.id) ? n.delete(i.id) : n.set(i.id, i); return n })
  return (
    <Modal opened onClose={onClose} size="md" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Select [Multiple] Items</Text>}>
      <Stack gap="sm">
        <TextInput data-autofocus leftSection={<Search size={16} />} placeholder="Item code or name" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Checkbox color="kumkum" label="Select All" checked={list.length > 0 && list.every((i) => sel.has(i.id))} onChange={(e) => setSel(e.currentTarget.checked ? new Map([...sel, ...list.map((i) => [i.id, i])]) : new Map())} />
        <ScrollArea h={300}>
          {list.map((i) => <Checkbox key={i.id} color="kumkum" mb={6} label={`${i.code} · ${i.name}`} checked={sel.has(i.id)} onChange={() => toggle(i)} />)}
          {list.length === 0 && <Text size="sm" c="dimmed">No items found.</Text>}
        </ScrollArea>
        <Group justify="flex-end">
          <Button color="kumkum" disabled={sel.size === 0} onClick={() => onApply([...sel.values()])}>OK</Button>
          <Button variant="default" onClick={onClose}>Cancel</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
