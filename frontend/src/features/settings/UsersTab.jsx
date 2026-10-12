import { useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { SquarePen, Key, Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as mastersApi from '../../api/endpoints/masters'
import * as usersApi from '../../api/endpoints/users'
import useDocFields from '../../hooks/useDocFields'
import { fieldCaption } from '../../utils/docFieldConditions'

const USER_DOC_ID = 18
const ROLE_DOC_ID = 1160

const EMPTY_FORM = {
  code: '',
  name: '',
  roleId: '',
  mobile: '',
  email: '',
  designation: '',
  inactive: false,
  inactiveRmks: '',
}

export default function UsersTab() {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [pwdModalUser, setPwdModalUser] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['master', USER_DOC_ID],
    queryFn: () => mastersApi.listMaster(USER_DOC_ID),
  })
  const { data: roleData } = useQuery({
    queryKey: ['master', ROLE_DOC_ID],
    queryFn: () => mastersApi.listMaster(ROLE_DOC_ID),
  })

  const { byCode: fieldMeta } = useDocFields(USER_DOC_ID)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const rows = data?.rows || []
  const roles = (roleData?.rows || []).filter((r) => r.ROLEID !== 0)
  const roleOptions = roles.map((r) => ({ value: String(r.ROLEID), label: r.ROLENAME }))
  const roleName = (id) => roles.find((r) => r.ROLEID === id)?.ROLENAME || (id === 0 ? '—' : id)

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(row) {
    setEditingId(row.UserID)
    setForm({
      code: row.UserCode || '',
      name: row.UserName || '',
      roleId: row.RoleID != null ? String(row.RoleID) : '',
      mobile: row.Mobileno || '',
      email: row.EmailID || '',
      designation: row.DESIGNATION || '',
      inactive: (row.Inactive || 'N').toUpperCase() === 'Y',
      inactiveRmks: row.InactiveRmks || '',
    })
    setModalOpen(true)
  }

  async function onSave() {
    setSaving(true)
    try {
      const values = {
        UserCode: form.code.trim(),
        UserName: form.name.trim(),
        RoleID: form.roleId === '' ? 0 : Number(form.roleId),
        Mobileno: form.mobile.trim(),
        EmailID: form.email.trim(),
        DESIGNATION: form.designation.trim(),
        Inactive: form.inactive ? 'Y' : 'N',
        InactiveRmks: form.inactiveRmks.trim(),
      }
      if (editingId) {
        await mastersApi.updateMasterRow(USER_DOC_ID, editingId, values)
      } else {
        await mastersApi.createMasterRow(USER_DOC_ID, values)
      }
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['master', USER_DOC_ID] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(row) {
    if (!window.confirm(`Delete user ${row.UserCode}?`)) return
    try {
      await mastersApi.deleteMasterRow(USER_DOC_ID, row.UserID)
      notifications.show({ message: 'Deleted Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['master', USER_DOC_ID] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Delete failed', color: 'red' })
    }
  }

  async function onSavePassword() {
    if (newPassword.length < 4) {
      notifications.show({ message: 'Password must be at least 4 characters', color: 'red' })
      return
    }
    try {
      await usersApi.setPassword(pwdModalUser.UserID, newPassword)
      notifications.show({ message: `Password updated for ${pwdModalUser.UserCode}`, color: 'teal' })
      setPwdModalUser(null)
      setNewPassword('')
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not set password', color: 'red' })
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {rows.length} user{rows.length === 1 ? '' : 's'}
        </Text>
        <Button leftSection={<Plus size={16} />} color="kumkum" onClick={openAdd}>
          Add User
        </Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>User Code</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Mobile</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th w={120}></Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {!isLoading && rows.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text c="dimmed" ta="center" py="md">
                  No users yet — click "Add User" to create the first one.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {rows.map((row) => (
            <Table.Tr key={row.UserID}>
              <Table.Td>{row.UserCode}</Table.Td>
              <Table.Td>{row.UserName}</Table.Td>
              <Table.Td>{roleName(row.RoleID)}</Table.Td>
              <Table.Td>{row.Mobileno}</Table.Td>
              <Table.Td>
                {(row.Inactive || 'N').toUpperCase() === 'Y' ? (
                  <Badge color="gray" variant="light">
                    Inactive
                  </Badge>
                ) : (
                  <Badge color="teal" variant="light">
                    Active
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon variant="subtle" color="kumkum" onClick={() => openEdit(row)} title="Edit">
                    <SquarePen size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="blue" onClick={() => setPwdModalUser(row)} title="Reset password">
                    <Key size={16} />
                  </ActionIcon>
                  {row.UserCode !== 'ADMIN' && (
                    <ActionIcon variant="subtle" color="red" onClick={() => onDelete(row)} title="Delete">
                      <Trash2 size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit User' : 'Add User'} radius="lg">
        <Stack>
          <TextInput label="User Code" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.currentTarget.value }))} />
          <TextInput label="User Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.currentTarget.value }))} />
          <Select label="Role" data={roleOptions} value={form.roleId} onChange={(v) => setForm((f) => ({ ...f, roleId: v || '' }))} clearable />
          <TextInput label="Mobile No" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.currentTarget.value }))} />
          <TextInput label="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.currentTarget.value }))} />
          <TextInput label={caption('DESIGNATION', 'Designation')} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.currentTarget.value }))} />
          <Checkbox label="Inactive" checked={form.inactive} onChange={(e) => setForm((f) => ({ ...f, inactive: e.currentTarget.checked }))} />
          {form.inactive && (
            <Textarea
              label="Inactive Remarks"
              required
              value={form.inactiveRmks}
              onChange={(e) => setForm((f) => ({ ...f, inactiveRmks: e.currentTarget.value }))}
            />
          )}
          {!editingId && (
            <Text size="xs" c="dimmed">
              Set the initial password afterwards with the key icon on the user row.
            </Text>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button color="kumkum" loading={saving} onClick={onSave}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(pwdModalUser)} onClose={() => setPwdModalUser(null)} title={`Reset password — ${pwdModalUser?.UserCode || ''}`} radius="lg">
        <Stack>
          <PasswordInput label="New Password" value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setPwdModalUser(null)}>
              Cancel
            </Button>
            <Button color="kumkum" onClick={onSavePassword}>
              Update Password
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
