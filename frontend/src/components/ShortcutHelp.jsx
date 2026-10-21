import { useState } from 'react'
import { ActionIcon, Kbd, Modal, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { Keyboard } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'

const GROUPS = [
  { title: 'Entry screens', rows: [
    ['Alt+N', 'New'], ['Alt+E', 'Edit'], ['Alt+S', 'Save only'], ['Alt+D', 'Delete'], ['Alt+C', 'Cancel'], ['Alt+L', 'Close'],
    ['Enter / Shift+Enter', 'Next / previous field'], ['F6', 'Load last entry'],
  ] },
  { title: 'Printing', rows: [
    ['Alt+P', 'Open the print dialog'], ['F10', 'Save and print now, no dialog (on a saved record: print it)'],
    ['Up / Down', 'Pick format (in the print dialog)'], ['Enter or F10', 'Print (in the print dialog)'], ['Esc', 'Close the dialog'],
  ] },
  { title: 'Records', rows: [
    ['Shift+← / →', 'Previous / next record'], ['Ctrl+Shift+F / L', 'First / last record'], ['Ctrl+Shift+S', 'Find'],
  ] },
  { title: 'Anywhere', rows: [
    ['F1', 'This help'], ['Ctrl+K or /', 'Search screens'], ['Tab / Shift+Tab', 'Move between controls'],
  ] },
]

/** F1 (or the header button) lists every keyboard shortcut. */
export default function ShortcutHelp() {
  const [open, setOpen] = useState(false)
  useHotkeys('f1', (e) => { e.preventDefault(); setOpen((o) => !o) }, { enableOnFormTags: true })
  return (
    <>
      <Tooltip label="Keyboard shortcuts (F1)" withArrow>
        <ActionIcon variant="subtle" color="kumkum" size={40} visibleFrom="sm" aria-label="Keyboard shortcuts" onClick={() => setOpen(true)}>
          <Keyboard size={20} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="lg" centered>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          {GROUPS.map((g) => (
            <Stack key={g.title} gap={6}>
              <Text fw={700} size="sm" c="var(--vt-accent)">{g.title}</Text>
              {g.rows.map(([k, d]) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text size="sm">{d}</Text>
                  <Kbd>{k}</Kbd>
                </div>
              ))}
            </Stack>
          ))}
        </SimpleGrid>
      </Modal>
    </>
  )
}
