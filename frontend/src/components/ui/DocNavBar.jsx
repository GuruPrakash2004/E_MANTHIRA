import { useState } from 'react'
import { ActionIcon, Badge, Button, Group, Modal, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { Ban, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FolderOpen, List, Pencil, Plus, Save, Search, Trash2 } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useQuery } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import * as metaApi from '../../api/endpoints/meta'
import EmptyState from './EmptyState'
import DocOptionsMenu from './DocOptionsMenu'
import ListingGrid from './ListingGrid'
import useRights from '../../hooks/useRights'
import { AlertifyMark } from '../../features/alertify/AlertifyLogo'

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
export default function DocNavBar({ docId, currentId, viewLabel, onLoad, onNew, onEdit, onCancelEdit, onSave, saving = false, editing = false, showNew = true, search, prefix = '', extraOptions = [], onCancelDoc, onDelete, lastSaved = null, alertify = null }) {
  const [findOpen, setFindOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [q, setQ] = useState('')
  const rights = useRights(docId) // what this user may do on the screen; buttons they have no right to are not offered

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
      <div className="vt-action-bar">
        <Group justify="space-between" gap="xs" p="sm" className="vt-action-bar-card">
          <Group gap="xs">
            {showNew && rights.add && (
              <Button color="kumkum" leftSection={<Plus size={16} />} onClick={onNew}>
                New
              </Button>
            )}
            {editing && onSave && rights.edit && (
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
                Save changes
              </Button>
            )}
            {editing && onCancelEdit && (
              <Button variant="default" onClick={onCancelEdit}>
                Cancel edit
              </Button>
            )}
            {currentId && onEdit && !editing && rights.edit && (
              <Button variant="light" color="kumkum" leftSection={<Pencil size={16} />} onClick={onEdit}>
                Edit
              </Button>
            )}
            {currentId && !editing && onCancelDoc && rights.edit && (
              <Button variant="light" color="orange" leftSection={<Ban size={16} />} onClick={onCancelDoc}>
                Cancel
              </Button>
            )}
            {currentId && !editing && onDelete && rights.del && (
              <Button variant="light" color="red" leftSection={<Trash2 size={16} />} onClick={onDelete}>
                Delete
              </Button>
            )}
            <Button variant="default" leftSection={<List size={16} />} onClick={() => setListOpen(true)}>
              List
            </Button>
            {alertify?.enabled && (
              <Tooltip label={alertify.ready ? 'Create an Alertify reminder from this bill' : (alertify.hint || 'Fill the bill details first')} withArrow>
                <Button
                  variant="default"
                  aria-label="Alertify"
                  data-disabled-look={alertify.ready ? undefined : 'true'}
                  style={alertify.ready ? undefined : { opacity: 0.6 }}
                  leftSection={<AlertifyMark size={18} />}
                  onClick={alertify.onClick}
                >
                  <span style={{ fontWeight: 800 }}><span>Alert</span><span style={{ color: '#14B8A6' }}>ify</span></span>
                </Button>
              </Tooltip>
            )}
            {!currentId && lastSaved?.id && (
              <Button variant="light" color="kumkum" leftSection={<FolderOpen size={16} />} onClick={() => onLoad(lastSaved.id)}>
                Open last saved{lastSaved.label ? `: ${lastSaved.label}` : ''}
              </Button>
            )}
            {currentId ? (
              <Badge size="lg" variant="light" color="gray" tt="none">
                {editing ? 'Editing' : 'View'}: {viewLabel || currentId}
              </Badge>
            ) : (
              <Text size="xs" c="dimmed" visibleFrom="sm">
                New entry. Use the arrows to look through saved records.
              </Text>
            )}
          </Group>
          <Group gap={6} wrap="nowrap">
            <DocOptionsMenu docId={docId} recordId={currentId} extra={extraOptions} />
            {btn('First record (Ctrl+Shift+F)', <ChevronFirst size={18} />, () => go('first'))}
            {btn('Previous record (Shift+Left)', <ChevronLeft size={18} />, () => go('prev'))}
            {btn('Find (Ctrl+Shift+S)', <Search size={17} />, () => setFindOpen(true))}
            {btn('Next record (Shift+Right)', <ChevronRight size={18} />, () => go('next'))}
            {btn('Last record (Ctrl+Shift+L)', <ChevronLast size={18} />, () => go('last'))}
          </Group>
        </Group>
      </div>

      {listOpen && <ListingGrid docId={docId} opened onClose={() => setListOpen(false)} onOpen={(_, id) => onLoad(id)} />}

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
