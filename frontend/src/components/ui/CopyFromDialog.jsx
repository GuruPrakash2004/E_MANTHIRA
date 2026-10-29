import { useEffect, useState } from 'react'
import { Button, Checkbox, Group, Modal, ScrollArea, Skeleton, Stack, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { Copy, Search } from 'lucide-react'
import EmptyState from './EmptyState'

/**
 * Copy From (legacy frmUtlCopyFrom): pick a saved document and load its details into the entry that is open, as a new
 * entry. Shown by the screen only when the document's UtlTransactions.AllowCopyFrom is 'Y' (useDocRules).
 *
 * `search(q, { allFy })` returns [{ id, label, sub }] (the screen's own finder, the same one its navigation bar uses);
 * `onLoad(id)` fills the entry. "Load Prev FinYear Also" widens the search to every financial year; "Keep this window
 * open" leaves the dialog up so several documents can be copied in turn. `allowReversal` (vouchers) adds the legacy
 * "DC / CR Reversal" tick: the copy comes in with debit and credit swapped, and `onLoad(id, { reverse })` is told so.
 */
export default function CopyFromDialog({ opened, onClose, docName, search, onLoad, allowReversal = false }) {
  const [q, setQ] = useState('')
  const [dq] = useDebouncedValue(q, 250)
  const [allFy, setAllFy] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)
  const [reverse, setReverse] = useState(false)
  const [sel, setSel] = useState(null)
  const [loading, setLoading] = useState(false)

  const { data, isFetching } = useQuery({ queryKey: ['copy-from', docName, dq, allFy], queryFn: () => search(dq, { allFy }), enabled: opened })
  const rows = data || []

  useEffect(() => {
    if (!opened) {
      setQ('')
      setSel(null)
    }
  }, [opened])

  async function load() {
    if (!sel) return
    setLoading(true)
    try {
      await onLoad(sel, { reverse })
      if (!keepOpen) onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} radius="lg" size="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Copy From</Text>}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">This will insert the details of the selected document into the current active document.</Text>
        <TextInput label="Document" readOnly className="vt-fld-readonly" value={docName} />
        <TextInput label="Doc No" placeholder="Type a number or a name" leftSection={<Search size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus />
        <ScrollArea h={240} type="auto">
          {isFetching && !rows.length ? (
            <Skeleton height={120} radius="md" />
          ) : rows.length === 0 ? (
            <EmptyState icon={Copy} title="No documents found" hint="Try another number, or tick Load Prev FinYear Also." />
          ) : (
            <Stack gap={4}>
              {rows.map((r) => (
                <Group
                  key={r.id}
                  justify="space-between"
                  wrap="nowrap"
                  p="xs"
                  onClick={() => setSel(r.id)}
                  onDoubleClick={() => { setSel(r.id); onLoad(r.id, { reverse }).then(() => !keepOpen && onClose()) }}
                  style={{ cursor: 'pointer', borderRadius: 8, background: sel === r.id ? 'var(--vt-gold-chip)' : undefined, border: '1px solid var(--vt-line)' }}
                >
                  <Text fw={600} size="sm">{r.label}</Text>
                  <Text size="xs" c="dimmed" truncate>{r.sub}</Text>
                </Group>
              ))}
            </Stack>
          )}
        </ScrollArea>
        <Group justify="space-between" wrap="wrap">
          <Stack gap={4}>
            <Checkbox size="xs" color="kumkum" label="Load Prev FinYear Also" checked={allFy} onChange={(e) => { setAllFy(e.currentTarget.checked); setSel(null) }} />
            {allowReversal && <Checkbox size="xs" color="kumkum" label="DC / CR Reversal" checked={reverse} onChange={(e) => setReverse(e.currentTarget.checked)} />}
            <Checkbox size="xs" color="kumkum" label="Keep this window open after loading document." checked={keepOpen} onChange={(e) => setKeepOpen(e.currentTarget.checked)} />
          </Stack>
          <Group gap="xs">
            <Button color="kumkum" leftSection={<Copy size={16} />} disabled={!sel} loading={loading} onClick={load}>Load</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}
