import { useState } from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useQuery } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import * as metaApi from '../../api/endpoints/meta'
import EmptyState from './EmptyState'
import DocOptionsMenu from './DocOptionsMenu'

/**
 * Record navigation for a transaction document (legacy toolbar: New / First / Previous / Find / Next / Last, with
 * Shift+Left / Shift+Right and Ctrl+Shift+F / L). The order, the financial-year scope and the table all come from the
 * backend (`GET /meta/docs/{doc}/nav`), so it works for any client's data.
 *
 *   currentId  - the record being viewed (null while entering a new one)
 *   onLoad(id) - show that record
 *   onNew()    - go back to a blank entry
 *   search     - async (text) => [{ id, label, sub }] used by Find
 */
export default function DocNavBar({ docId, currentId, viewLabel, onLoad, onNew, search, prefix = '' }) {
  const [findOpen, setFindOpen] = useState(false)
  const [q, setQ] = useState('')

  async function go(direction) {
    try {
      const r = await metaApi.navigateDoc(docId, { direction, current: currentId || undefined, prefix: prefix || undefined })
      if (r.id) onLoad(r.id)
      else notifications.show({ message: direction === 'next' || direction === 'last' ? 'This is the last record' : 'This is the first record', color: 'yellow' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not move to that record', color: 'red' })
    }
  }
  useHotkeys('shift+left', (e) => { e.preventDefault(); go('prev') }, { enableOnFormTags: false }, [currentId])
  useHotkeys('shift+right', (e) => { e.preventDefault(); go('next') }, { enableOnFormTags: false }, [currentId])
  useHotkeys('ctrl+shift+f', (e) => { e.preventDefault(); go('first') }, { enableOnFormTags: true }, [currentId])
  useHotkeys('ctrl+shift+l', (e) => { e.preventDefault(); go('last') }, { enableOnFormTags: true }, [currentId])
  useHotkeys('ctrl+shift+s', (e) => { e.preventDefault(); setFindOpen(true) }, { enableOnFormTags: true }, [])

  const { data: found = [], isLoading } = useQuery({ queryKey: ['docnav-find', docId, q], queryFn: () => search(q), enabled: findOpen && Boolean(search) })

  const btn = (label, icon, onClick) => (
    <Tooltip label={label} withArrow>
      <ActionIcon variant="default" size={40} aria-label={label} onClick={onClick}>
        {icon}
      </ActionIcon>
    </Tooltip>
  )

  return (
    <>
      <div style={{ position: 'sticky', bottom: 12, zIndex: 5, marginTop: 'var(--mantine-spacing-md)' }}>
        <Group justify="space-between" gap="xs" p="sm" style={{ borderRadius: 16, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', boxShadow: '0 6px 20px rgba(43,9,9,0.12)' }}>
          <Group gap="xs">
            <Button color="kumkum" leftSection={<Plus size={16} />} onClick={onNew}>
              New
            </Button>
            <DocOptionsMenu docId={docId} recordId={currentId} />
            {currentId ? (
              <Badge size="lg" variant="light" color="gray" tt="none">
                View: {viewLabel || currentId}
              </Badge>
            ) : (
              <Text size="xs" c="dimmed" visibleFrom="sm">
                New entry. Use the arrows to look through saved records.
              </Text>
            )}
          </Group>
          <Group gap={6} wrap="nowrap">
            {btn('First record (Ctrl+Shift+F)', <ChevronFirst size={18} />, () => go('first'))}
            {btn('Previous record (Shift+Left)', <ChevronLeft size={18} />, () => go('prev'))}
            {btn('Find (Ctrl+Shift+S)', <Search size={17} />, () => setFindOpen(true))}
            {btn('Next record (Shift+Right)', <ChevronRight size={18} />, () => go('next'))}
            {btn('Last record (Ctrl+Shift+L)', <ChevronLast size={18} />, () => go('last'))}
          </Group>
        </Group>
      </div>

      <Modal opened={findOpen} onClose={() => setFindOpen(false)} size="lg" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Find</Text>}>
        <Stack gap="sm">
          <TextInput data-autofocus leftSection={<Search size={16} />} placeholder="Document no, name or mobile" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <Table.ScrollContainer minWidth={420} mah={360}>
            <Table highlightOnHover>
              <Table.Tbody>
                {found.map((r) => (
                  <Table.Tr
                    key={r.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setFindOpen(false)
                      onLoad(r.id)
                    }}
                  >
                    <Table.Td className="vt-num" fw={600}>
                      {r.label}
                    </Table.Td>
                    <Table.Td>{r.sub}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {!isLoading && found.length === 0 && <EmptyState icon={Search} title="No records found" hint="Try part of the document number or name." />}
        </Stack>
      </Modal>
    </>
  )
}
