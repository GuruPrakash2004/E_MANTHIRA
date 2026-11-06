import { useState } from 'react'
import { ActionIcon, Autocomplete, Button, Group, Modal, ScrollArea, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import * as inventoryApi from '../../api/endpoints/inventory'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { ItemsDialog } from './ItemListPicker'

/**
 * "Add Items" of the legacy stock reports (frmUtlAddItems): paste a list of item codes (one per line) and press >>>> to check them
 * against the item master (Valid / Invalid), or tick items from the master; save the list under a name, load or remove a saved
 * list; "Load Items" puts every valid item into the report's Selected Item list.
 *   onLoad(items)  items: [{ id, code, name }]
 */
export default function AddItemsDialog({ onClose, onLoad }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [rows, setRows] = useState([]) // [{ sl_no, code, valid, item_id, name }]
  const [listName, setListName] = useState('')
  const [remarks, setRemarks] = useState('')
  const [pickOpen, setPickOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: lists } = useQuery({ queryKey: ['item-lists'], queryFn: inventoryApi.itemLists })
  const canLists = Boolean(lists?.available)
  const fail = (e, m) => notifications.show({ message: e?.response?.data?.detail || m, color: 'red' })
  const renumber = (list) => list.map((r, i) => ({ ...r, sl_no: i + 1 }))

  async function check() {
    const codes = text.split(/\r?\n/).map((c) => c.trim()).filter(Boolean)
    if (!codes.length) return
    setBusy(true)
    try {
      setRows(renumber(await inventoryApi.validateItemCodes(codes)))
      setText('')
    } catch (e) {
      fail(e, 'Could not check the items')
    } finally {
      setBusy(false)
    }
  }
  async function pickedFromMaster(items) {
    setBusy(true)
    try {
      setRows(renumber(await inventoryApi.validateItemCodes(items.map((i) => i.code))))
    } catch (e) {
      fail(e, 'Could not read the chosen items')
    } finally {
      setBusy(false)
    }
  }
  const valid = rows.filter((r) => r.valid)

  async function loadList() {
    if (!listName.trim()) return notifications.show({ message: 'Please Select or Enter the Item List Name!', color: 'yellow' })
    try {
      const r = await inventoryApi.loadItemList(listName.trim())
      if (!r.items.length) return notifications.show({ message: 'No items in that list', color: 'yellow' })
      setRows(renumber(r.items))
      setRemarks(r.remarks || '')
    } catch (e) {
      fail(e, 'Could not load the list')
    }
  }
  async function saveList() {
    if (!listName.trim()) return notifications.show({ message: 'Please Select or Enter the Item List Name!', color: 'yellow' })
    if (!valid.length) return notifications.show({ message: 'Please Select alteast one Item!', color: 'yellow' })
    try {
      await inventoryApi.saveItemList(listName.trim(), remarks, valid.map((r) => r.item_id))
      notifications.show({ message: 'Item list saved', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['item-lists'] })
    } catch (e) {
      fail(e, 'Could not save the list')
    }
  }
  async function removeList() {
    if (!listName.trim()) return notifications.show({ message: 'Please Select the Item List Name!', color: 'yellow' })
    if (!(await confirm({ title: 'Delete this list of items?', message: `The saved list "${listName.trim()}" will be deleted.`, confirmLabel: 'Delete' }))) return
    try {
      await inventoryApi.removeItemList(listName.trim())
      notifications.show({ message: 'Item list deleted!', color: 'teal' })
      setRows([])
      setListName('')
      setRemarks('')
      queryClient.invalidateQueries({ queryKey: ['item-lists'] })
    } catch (e) {
      fail(e, 'Could not delete the list')
    }
  }

  return (
    <>
      <Modal opened onClose={onClose} size="min(960px, 96vw)" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Add Items</Text>} zIndex={300}>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Button color="kumkum" onClick={() => setPickOpen(true)}>Select Multiple Items from Item Master</Button>
            {canLists && (
              <Stack gap={6} style={{ flex: '1 1 420px', maxWidth: 520 }}>
                <Group gap={6} wrap="nowrap" align="flex-end">
                  <Autocomplete label="Item List" aria-label="Item list name" data={lists?.names || []} value={listName} onChange={setListName} style={{ flex: 1 }} maxLength={100} />
                  <Button variant="default" onClick={loadList}>Load</Button>
                  <Button variant="default" onClick={saveList}>Save List</Button>
                  <Button variant="default" onClick={removeList}>Remove List</Button>
                </Group>
                <TextInput aria-label="List remarks" placeholder="Remarks for this list" value={remarks} onChange={(e) => setRemarks(e.currentTarget.value)} maxLength={250} />
              </Stack>
            )}
          </Group>

          <Group align="stretch" wrap="nowrap" gap="sm">
            <Stack gap={4} style={{ flex: '1 1 40%', minWidth: 0 }}>
              <Text size="sm" c="blue.8" fw={600}>Paste the List of Items in the box below</Text>
              <Textarea aria-label="Pasted item codes" value={text} onChange={(e) => setText(e.currentTarget.value)} minRows={14} maxRows={14} autosize styles={{ input: { fontFamily: 'inherit' } }} />
              <Text size="xs" c="blue.8">After pasting click on &gt;&gt; button</Text>
            </Stack>
            <Button variant="default" loading={busy} onClick={check} disabled={!text.trim()} style={{ alignSelf: 'center' }} aria-label="Check the pasted items">&gt;&gt;&gt;&gt;</Button>
            <div style={{ flex: '1 1 52%', minWidth: 0, border: '1px solid var(--vt-line)', borderRadius: 8, overflow: 'hidden' }}>
              <ScrollArea h={330}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--vt-g3)', color: '#F4E1A6' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 10px', width: 60 }}>SLNo</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px' }}>ItemCode</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', width: 130 }}>Valid/Invalid</th>
                      <th style={{ width: 36 }} aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.sl_no}-${r.code}`} style={{ background: r.valid ? undefined : 'rgba(220,38,38,0.08)' }}>
                        <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--vt-line)' }}>{r.sl_no}</td>
                        <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--vt-line)' }} title={r.name}>{r.code}</td>
                        <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--vt-line)' }}>
                          {r.valid ? <CircleCheck size={16} color="var(--mantine-color-teal-6)" aria-label="Valid" /> : <CircleX size={16} color="var(--mantine-color-red-6)" aria-label="Invalid" />}
                        </td>
                        <td style={{ borderBottom: '1px solid var(--vt-line)' }}>
                          <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Remove ${r.code}`} onClick={() => setRows((list) => renumber(list.filter((_, k) => k !== i)))}><Trash2 size={13} /></ActionIcon>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <Text size="sm" c="dimmed" ta="center" py="xl">Paste item codes and press &gt;&gt;&gt;&gt;, or pick items from the item master.</Text>}
              </ScrollArea>
            </div>
          </Group>

          <Group justify="space-between">
            <Text size="xs" c="dimmed">{rows.length ? `${valid.length} valid, ${rows.length - valid.length} invalid` : ''}</Text>
            <Group gap="xs">
              <Button variant="default" onClick={() => { setRows([]); setText('') }} disabled={!rows.length && !text}>Delete All</Button>
              <Button color="kumkum" disabled={!valid.length} onClick={() => onLoad(valid.map((r) => ({ id: r.item_id, code: r.code, name: r.name })))}>Load Items</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
      {pickOpen && <ItemsDialog already={[]} onClose={() => setPickOpen(false)} onApply={(items) => { setPickOpen(false); pickedFromMaster(items) }} initial="" />}
    </>
  )
}
