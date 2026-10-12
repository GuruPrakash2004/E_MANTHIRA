import { useConfirm } from '../../components/ui/ConfirmProvider'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Group, Modal, Skeleton, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core'
import { Eye, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as mastersApi from '../../api/endpoints/masters'
import * as rolesApi from '../../api/endpoints/roles'

const ROLE_DOC_ID = 1160
const COLUMNS = [
  { key: 'open', label: 'Open' },
  { key: 'add', label: 'Add / Save' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete / Cancel' },
]

function TriCheckbox({ items, field, label, onToggleAll }) {
  const all = items.length > 0 && items.every((i) => i[field])
  const some = items.some((i) => i[field])
  return <Checkbox aria-label={label} checked={all} indeterminate={!all && some} onChange={() => onToggleAll(field, !all)} color="kumkum" styles={{ root: { display: 'flex', justifyContent: 'center' } }} />
}

export default function RolesRightsTab() {
  const queryClient = useQueryClient()
  const [selectedRoleId, setSelectedRoleId] = useState(null)
  const [roleName, setRoleName] = useState('')
  const [items, setItems] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newRoleCode, setNewRoleCode] = useState('')
  const [newRoleName, setNewRoleName] = useState('')

  const { data: roleData, isLoading: rolesLoading } = useQuery({ queryKey: ['master', ROLE_DOC_ID], queryFn: () => mastersApi.listMaster(ROLE_DOC_ID) })
  const roles = (roleData?.rows || []).filter((r) => r.ROLEID !== 0)

  useEffect(() => {
    if (!selectedRoleId && roles.length) setSelectedRoleId(roles[0].ROLEID)
  }, [roles, selectedRoleId])

  const selectedRole = roles.find((r) => r.ROLEID === selectedRoleId)

  const { data: rights } = useQuery({
    queryKey: ['role-rights', selectedRoleId],
    queryFn: () => rolesApi.getRoleRights(selectedRoleId),
    enabled: selectedRoleId != null,
  })

  useEffect(() => {
    if (rights) {
      setItems(rights)
      setDirty(false)
    }
  }, [rights])

  useEffect(() => {
    setRoleName(selectedRole?.ROLENAME || '')
  }, [selectedRole])

  const groups = useMemo(() => {
    const order = []
    const byType = {}
    for (const item of items) {
      if (!byType[item.type]) {
        byType[item.type] = []
        order.push(item.type)
      }
      byType[item.type].push(item)
    }
    return order.map((type) => ({ type, items: byType[type] }))
  }, [items])

  const openCount = items.filter((i) => i.open).length
  const buttonCount = items.reduce((n, i) => n + (i.add ? 1 : 0) + (i.edit ? 1 : 0) + (i.delete ? 1 : 0), 0)

  function toggleCell(menuItemId, field, value) {
    setItems((prev) => prev.map((i) => (i.menu_item_id === menuItemId ? { ...i, [field]: value } : i)))
    setDirty(true)
  }

  function toggleGroup(type, field, value) {
    setItems((prev) => prev.map((i) => (i.type === type ? { ...i, [field]: value } : i)))
    setDirty(true)
  }

  async function onSaveRights() {
    if (selectedRoleId == null) return
    setSaving(true)
    try {
      if (roleName.trim() && roleName.trim() !== selectedRole?.ROLENAME) {
        await mastersApi.updateMasterRow(ROLE_DOC_ID, selectedRoleId, { ROLENAME: roleName.trim() })
      }
      await rolesApi.saveRoleRights(selectedRoleId, items)
      notifications.show({ message: 'Rights saved', color: 'teal' })
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['master', ROLE_DOC_ID] })
      queryClient.invalidateQueries({ queryKey: ['role-rights', selectedRoleId] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function pickRole(id) {
    if (id === selectedRoleId) return
    if (dirty && !(await confirm({ title: 'Discard changes?', message: 'You have unsaved changes to this role. Switching roles will lose them.', confirmLabel: 'Discard' }))) return
    setSelectedRoleId(id)
  }

  async function onCancel() {
    if (dirty && !(await confirm({ title: 'Discard changes?', message: 'Your unsaved changes to this role will be lost.', confirmLabel: 'Discard' }))) return
    setItems(rights || [])
    setRoleName(selectedRole?.ROLENAME || '')
    setDirty(false)
  }

  const confirm = useConfirm()
  async function onCreateRole() {
    if (!newRoleCode.trim() || !newRoleName.trim()) return
    try {
      const created = await mastersApi.createMasterRow(ROLE_DOC_ID, { ROLECODE: newRoleCode.trim(), ROLENAME: newRoleName.trim(), InActive: 'N' })
      notifications.show({ message: 'Role created', color: 'teal' })
      setCreateOpen(false)
      setNewRoleCode('')
      setNewRoleName('')
      queryClient.invalidateQueries({ queryKey: ['master', ROLE_DOC_ID] })
      setSelectedRoleId(created.ROLEID)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not create role', color: 'red' })
    }
  }

  async function onDeleteRole() {
    if (!selectedRole) return
    if (!(await confirm({ title: 'Delete this role?', message: `Role "${selectedRole.ROLENAME}" will be deleted. Users assigned to it keep this RoleID until reassigned.`, confirmLabel: 'Delete' }))) return
    try {
      await mastersApi.deleteMasterRow(ROLE_DOC_ID, selectedRoleId)
      notifications.show({ message: 'Role deleted', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['master', ROLE_DOC_ID] })
      setSelectedRoleId(null)
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete role', color: 'red' })
    }
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Text size="sm" fw={600} mb={6} id="vt-role-label">
            Select role
          </Text>
          {rolesLoading ? (
            <Skeleton height={36} width={260} radius="xl" />
          ) : (
            <div role="radiogroup" aria-labelledby="vt-role-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {roles.map((r) => {
                const on = r.ROLEID === selectedRoleId
                return (
                  <UnstyledButton
                    key={r.ROLEID}
                    role="radio"
                    aria-checked={on}
                    onClick={() => pickRole(r.ROLEID)}
                    style={{
                      minHeight: 40,
                      padding: '0 16px',
                      borderRadius: 999,
                      fontSize: 14,
                      fontWeight: on ? 700 : 500,
                      border: `1px solid ${on ? 'var(--mantine-color-kumkum-7)' : 'var(--vt-line)'}`,
                      background: on ? 'var(--mantine-color-kumkum-7)' : 'var(--vt-surface)',
                      color: on ? '#FBF6EC' : 'var(--vt-ink)',
                    }}
                  >
                    {r.ROLENAME}
                  </UnstyledButton>
                )
              })}
            </div>
          )}
        </div>
        <Button leftSection={<Plus size={16} />} variant="default" onClick={() => setCreateOpen(true)}>
          Create new role
        </Button>
      </Group>

      {selectedRole && (
        <>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
              <TextInput label="Role Name" value={roleName} onChange={(e) => setRoleName(e.currentTarget.value)} />
              <Text size="xs" c="dimmed" mt={4}>
                {openCount} of {items.length} screens open, {buttonCount} buttons allowed
              </Text>
            </div>
            <Group>
              <Button leftSection={<Trash2 size={16} />} color="red" variant="light" onClick={onDeleteRole}>
                Delete Role
              </Button>
              {dirty && (
                <Button leftSection={<X size={16} />} variant="default" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button color="kumkum" loading={saving} onClick={onSaveRights}>
                Save Rights
              </Button>
            </Group>
          </Group>

          <Group gap="xl" p="sm" style={{ background: 'var(--vt-gold-chip)', borderRadius: 8 }}>
            <Group gap={6}>
              <Eye size={16} color="var(--vt-accent)" />
              <Text size="xs">
                <b>Open</b>: see the screen in the sidebar and look at its data
              </Text>
            </Group>
            <Group gap={6}>
              <Plus size={16} color="var(--vt-accent)" />
              <Text size="xs">
                <b>Add / Save</b>: create new records or save bills and entries
              </Text>
            </Group>
            <Group gap={6}>
              <Pencil size={16} color="var(--vt-accent)" />
              <Text size="xs">
                <b>Edit</b>: change existing records
              </Text>
            </Group>
            <Group gap={6}>
              <Trash2 size={16} color="var(--vt-accent)" />
              <Text size="xs">
                <b>Delete / Cancel</b>: remove records or cancel saved bills
              </Text>
            </Group>
          </Group>

          <Card withBorder p={0} style={{ overflow: 'hidden' }}>
          <Table.ScrollContainer minWidth={560} mah="70dvh">
          <Table highlightOnHover stickyHeader>
            <Table.Thead style={{ background: 'var(--vt-surface)', zIndex: 2 }}>
              <Table.Tr>
                <Table.Th>Screen</Table.Th>
                {COLUMNS.map((c) => (
                  <Table.Th key={c.key} style={{ textAlign: 'center' }}>
                    {c.label}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((g) => (
                <Fragment key={g.type}>
                  <Table.Tr style={{ background: 'var(--vt-gold-chip)' }}>
                    <Table.Td>
                      <Text fw={700} size="sm">
                        {g.type.toUpperCase()}{' '}
                        <Text span size="xs" c="dimmed" fw={400}>
                          {g.items.filter((i) => i.open).length} of {g.items.length} open
                        </Text>
                      </Text>
                    </Table.Td>
                    {COLUMNS.map((c) => (
                      <Table.Td key={c.key} style={{ textAlign: 'center' }}>
                        <TriCheckbox items={g.items} field={c.key} label={`${c.label}: all ${g.type} screens`} onToggleAll={(field, value) => toggleGroup(g.type, field, value)} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                  {g.items.map((item) => (
                    <Table.Tr key={item.menu_item_id}>
                      <Table.Td pl="lg">{item.caption}</Table.Td>
                      {COLUMNS.map((c) => (
                        <Table.Td key={c.key} style={{ textAlign: 'center' }}>
                          <Checkbox
                            aria-label={`${c.label}: ${item.caption}`}
                            checked={item[c.key]}
                            onChange={(e) => toggleCell(item.menu_item_id, c.key, e.currentTarget.checked)}
                            color="kumkum"
                            styles={{ root: { display: 'flex', justifyContent: 'center' } }}
                          />
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Fragment>
              ))}
              {groups.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="md">
                      No screens found.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
          </Table.ScrollContainer>
          </Card>
        </>
      )}

      {!rolesLoading && !selectedRole && roles.length === 0 && (
        <EmptyState icon={ShieldCheck} title="No roles yet" hint="Create the first role, then choose which screens and buttons it can use." />
      )}

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Create new role">
        <Stack>
          <TextInput label="Role Code" required value={newRoleCode} onChange={(e) => setNewRoleCode(e.currentTarget.value)} />
          <TextInput label="Role Name" required value={newRoleName} onChange={(e) => setNewRoleName(e.currentTarget.value)} />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button color="kumkum" onClick={onCreateRole}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
