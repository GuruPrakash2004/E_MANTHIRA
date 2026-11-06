import { useState } from 'react'
import { Button, Checkbox, Group, Modal, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'

/**
 * "Selected Sannidhi / Selected Seva / Selected User" of the legacy reports: a checkbox that opens a "Select [Multiple] ..."
 * window - search box, a checklist (Sel / Code / Name), Select All, Ok / Cancel. Ticking Ok with nothing chosen un-ticks the
 * field, like the legacy form; the chosen count stays beside the checkbox and opens the window again.
 *
 *   label       caption of the checkbox ("Selected Sannidhi")
 *   title       the window's title ("Select [Multiple] Sannidhi Name")
 *   queryKey / load   () => Promise<[{ value, label, code? }]> the choices, read when the window opens
 *   value       chosen values (strings)        onChange(values)
 */
export default function MultiPickField({ label, title, queryKey, load, value, onChange, codeCaption = 'Code', nameCaption = 'Name' }) {
  const [open, setOpen] = useState(false)
  const [on, setOn] = useState(false)
  const [draft, setDraft] = useState([])
  const [q, setQ] = useState('')
  const { data: options = [], isLoading } = useQuery({ queryKey, queryFn: load, enabled: open, staleTime: 60_000 })

  const shown = options.filter((o) => `${o.code || ''} ${o.label}`.toLowerCase().includes(q.trim().toLowerCase()))
  const allValues = options.map((o) => String(o.value))
  const startPick = () => {
    setDraft(value)
    setQ('')
    setOpen(true)
  }
  const ok = () => {
    onChange(draft)
    setOn(draft.length > 0)
    setOpen(false)
  }
  const cancel = () => {
    setOpen(false)
    if (!value.length) setOn(false)
  }
  const toggle = (v) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))

  return (
    <>
      <Group gap={8} wrap="nowrap">
        <Checkbox
          color="kumkum"
          label={label}
          checked={on}
          onChange={(e) => {
            if (e.currentTarget.checked) {
              setOn(true)
              startPick()
            } else {
              setOn(false)
              onChange([])
            }
          }}
        />
        {on && value.length > 0 && (
          <UnstyledButton onClick={startPick} style={{ color: 'var(--vt-accent)', fontSize: 13, fontWeight: 700, textDecoration: 'underline' }} aria-label={`Change ${label}`}>
            {value.length} selected
          </UnstyledButton>
        )}
      </Group>

      <Modal opened={open} onClose={cancel} size="md" radius="lg" centered title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{title}</Text>}>
        <Stack gap="sm">
          <TextInput data-autofocus leftSection={<Search size={16} />} placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <div style={{ border: '1px solid var(--vt-line)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', background: 'var(--vt-sandal)', fontSize: 12, fontWeight: 700, padding: '6px 10px', borderBottom: '1px solid var(--vt-line)' }}>
              <span>Sel</span>
              <span>{codeCaption}</span>
              <span>{nameCaption}</span>
            </div>
            <ScrollArea.Autosize mah={320}>
              {isLoading && <Text size="sm" c="dimmed" p="sm">Loading...</Text>}
              {shown.map((o) => {
                const v = String(o.value)
                return (
                  <label key={v} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--vt-line)', cursor: 'pointer', background: draft.includes(v) ? 'var(--vt-gold-chip)' : undefined, fontSize: 13 }}>
                    <Checkbox color="kumkum" size="xs" checked={draft.includes(v)} onChange={() => toggle(v)} aria-label={o.label} />
                    <span>{o.code ?? o.label}</span>
                    <span>{o.label}</span>
                  </label>
                )
              })}
              {!isLoading && shown.length === 0 && <Text size="sm" c="dimmed" p="sm">Nothing found.</Text>}
            </ScrollArea.Autosize>
          </div>
          <Group justify="space-between">
            <Checkbox
              color="kumkum"
              label="Select All"
              checked={allValues.length > 0 && draft.length === allValues.length}
              indeterminate={draft.length > 0 && draft.length < allValues.length}
              onChange={(e) => setDraft(e.currentTarget.checked ? allValues : [])}
            />
            <Group gap="xs">
              <Text size="xs" c="dimmed">{draft.length} selected</Text>
              <Button color="kumkum" onClick={ok}>Ok</Button>
              <Button variant="default" onClick={cancel}>Cancel</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
