import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  SegmentedControl,
  Select,
  Skeleton,
  Checkbox,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { Camera, SquarePen, Key, Plus, Trash2, Search, Users, UserCheck, UserX } from 'lucide-react'
import { DateInput } from '@mantine/dates'
import StatCard from '../../components/ui/StatCard'
import EmptyState from '../../components/ui/EmptyState'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as mastersApi from '../../api/endpoints/masters'
import * as usersApi from '../../api/endpoints/users'
import useDocFields from '../../hooks/useDocFields'
import { fieldCaption } from '../../utils/docFieldConditions'
import { isoDate } from '../../utils/format'

const USER_DOC_ID = 18
const ROLE_DOC_ID = 1160

const EMPTY_FORM = {
  code: '',
  name: '',
  roleId: '',
  mobile: '',
  email: '',
  designation: '',
  department: '',
  chkDob: false,
  dob: null,
  pwdResetDt: new Date(),
  password: '',
  confirm: '',
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
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['master', USER_DOC_ID],
    queryFn: () => mastersApi.listMaster(USER_DOC_ID),
  })
  const { data: roleData } = useQuery({
    queryKey: ['master', ROLE_DOC_ID],
    queryFn: () => mastersApi.listMaster(ROLE_DOC_ID),
  })

  const { data: fs } = useQuery({ queryKey: ['user-form-settings'], queryFn: usersApi.formSettings })
  const { byCode: fieldMeta } = useDocFields(USER_DOC_ID)
  const [photoKey, setPhotoKey] = useState(0)
  const [photoUrl, setPhotoUrl] = useState(null)
  useEffect(() => {
    let url = null
    let live = true
    setPhotoUrl(null)
    if (editingId && modalOpen) {
      usersApi.imageBlob(editingId).then((b) => { if (live) { url = URL.createObjectURL(b); setPhotoUrl(url) } }).catch(() => {})
    }
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [editingId, photoKey, modalOpen])
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)
  const rows = data?.rows || []
  const roles = (roleData?.rows || []).filter((r) => r.ROLEID !== 0)
  const roleOptions = roles.map((r) => ({ value: String(r.ROLEID), label: r.ROLENAME }))
  const isInactive = (r) => (r.Inactive || 'N').toUpperCase() === 'Y'
  const counts = { total: rows.length, active: rows.filter((r) => !isInactive(r)).length, inactive: rows.filter(isInactive).length }
  const q = query.trim().toLowerCase()
  const shown = rows.filter((r) => {
    if (status === 'active' && isInactive(r)) return false
    if (status === 'inactive' && !isInactive(r)) return false
    return !q || [r.UserCode, r.UserName, r.Mobileno].some((v) => String(v || '').toLowerCase().includes(q))
  })
  const roleName = (id) => roles.find((r) => r.ROLEID === id)?.ROLENAME || (id === 0 ? '-' : id)

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
      department: row.Department || '',
      chkDob: (row.ChkDOB || 'N').toUpperCase() === 'Y',
      dob: row.DOB ? new Date(row.DOB) : null,
      pwdResetDt: row.PwdResetDt ? new Date(row.PwdResetDt) : new Date(),
      password: '',
      confirm: '',
      inactive: (row.Inactive || 'N').toUpperCase() === 'Y',
      inactiveRmks: row.InactiveRmks || '',
    })
    setModalOpen(true)
  }

  async function onSave() {
    const bad = (msg) => notifications.show({ message: msg, color: 'red' })
    if (!form.code.trim()) return bad('User Code should not be blank!!')
    if (!form.name.trim()) return bad('User Name should not be blank!!')
    if (!fs?.ad_auth) {
      if (!editingId && !form.password.trim()) return bad('Password should not be blank!!')
      if (form.password || form.confirm) {
        if (!form.confirm.trim()) return bad('Confirm Password should not be blank!!')
        if (form.password.toUpperCase() !== form.confirm.toUpperCase()) return bad('Confirm Password should be same as password!!')
      }
    }
    if (form.inactive && !form.inactiveRmks.trim()) return bad('Reason for InActive!')
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return bad('EmailID is not valid!!')
    if (!fs?.user_based && !form.roleId) return bad('Role Name should not be blank!!')
    setSaving(true)
    try {
      const values = {
        UserCode: form.code.trim(),
        UserName: form.name.trim(),
        RoleID: form.roleId === '' ? 0 : Number(form.roleId),
        Mobileno: form.mobile.trim(),
        EmailID: form.email.trim(),
        DESIGNATION: form.designation.trim(),
        Department: form.department.trim(),
        ChkDOB: form.chkDob ? 'Y' : 'N',
        DOB: form.chkDob && form.dob ? isoDate(form.dob) : null,
        PwdResetDt: isoDate(form.pwdResetDt || new Date()),
        Inactive: form.inactive ? 'Y' : 'N',
        InactiveRmks: form.inactiveRmks.trim(),
      }
      let uid = editingId
      if (editingId) {
        await mastersApi.updateMasterRow(USER_DOC_ID, editingId, values)
      } else {
        const created = await mastersApi.createMasterRow(USER_DOC_ID, values)
        uid = created?.UserID ?? created?.id
      }
      if (form.password && uid) await usersApi.setPassword(uid, form.password)
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

  const confirm = useConfirm()
  async function onDelete(row) {
    if (!(await confirm({ title: 'Delete this user?', message: `User ${row.UserCode} will be deleted. This cannot be undone.`, confirmLabel: 'Delete' }))) return
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

  const rowActions = (row) => (
    <Group gap={4} wrap="nowrap">
      <ActionIcon variant="subtle" color="kumkum" size={36} onClick={() => openEdit(row)} aria-label={`Edit user ${row.UserCode}`}>
        <SquarePen size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="kumkum" size={36} onClick={() => setPwdModalUser(row)} aria-label={`Reset password for ${row.UserCode}`}>
        <Key size={16} />
      </ActionIcon>
      {row.UserCode !== 'ADMIN' && (
        <ActionIcon variant="subtle" color="red" size={36} onClick={() => onDelete(row)} aria-label={`Delete user ${row.UserCode}`}>
          <Trash2 size={16} />
        </ActionIcon>
      )}
    </Group>
  )
  const statusBadge = (row) =>
    isInactive(row) ? (
      <Badge color="gray" variant="light">Inactive</Badge>
    ) : (
      <Badge color="gold" variant="light" c="var(--vt-badge-ink)">Active</Badge>
    )

  return (
    <Stack gap="lg">
      <Group gap="xs" hiddenFrom="sm">
        <Badge size="lg" variant="light" color="gray" tt="none">{counts.total} total</Badge>
        <Badge size="lg" variant="light" color="gold" c="var(--vt-badge-ink)" tt="none">{counts.active} active</Badge>
        <Badge size="lg" variant="light" color="gray" tt="none">{counts.inactive} inactive</Badge>
      </Group>
      <div className="vt-users-tiles" style={{ display: 'grid', gap: 'var(--mantine-spacing-md)', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <StatCard label="Total users" value={counts.total} icon={Users} loading={isLoading} />
        <StatCard label="Active" value={counts.active} icon={UserCheck} tone="dark" loading={isLoading} />
        <StatCard label="Inactive" value={counts.inactive} icon={UserX} loading={isLoading} />
      </div>
      <style>{`@media (max-width: 47.99em) { .vt-users-tiles { display: none !important; } }`}</style>

      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="sm" wrap="wrap">
          <TextInput
            aria-label="Search users"
            placeholder="Search code, name or mobile"
            leftSection={<Search size={16} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={{ base: '100%', sm: 280 }}
          />
          <SegmentedControl
            aria-label="Filter by status"
            value={status}
            onChange={setStatus}
            data={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
          />
        </Group>
        <Button leftSection={<Plus size={16} />} color="kumkum" onClick={openAdd}>
          Add User
        </Button>
      </Group>

      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <Stack p="md" gap="xs">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={44} radius="md" />)}
          </Stack>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No users yet" hint="Add the first user, then set a password with the key button." action={<Button size="xs" color="kumkum" onClick={openAdd}>Add User</Button>} />
        ) : shown.length === 0 ? (
          <EmptyState icon={Search} title="No matching users" hint="Try a different search or status filter." />
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>User Code</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Mobile</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th w={140} aria-label="Actions" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((row) => (
                  <Table.Tr key={row.UserID}>
                    <Table.Td fw={600}>{row.UserCode}</Table.Td>
                    <Table.Td>{row.UserName}</Table.Td>
                    <Table.Td>{roleName(row.RoleID)}</Table.Td>
                    <Table.Td className="vt-num">{row.Mobileno}</Table.Td>
                    <Table.Td>{statusBadge(row)}</Table.Td>
                    <Table.Td>{rowActions(row)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'User Master - Edit' : 'User Master - New'} size="xl">
        <Stack>
          <Group align="flex-start" wrap="wrap" gap="lg">
            <Stack gap="sm" style={{ flex: '1 1 320px' }}>
              <TextInput className="vt-field-required" label="User Code" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.currentTarget.value }))} />
              <TextInput className="vt-field-required" label="User Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.currentTarget.value }))} />
              <TextInput label="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.currentTarget.value }))} />
              <Group align="flex-end" gap="sm">
                <Checkbox color="kumkum" label="DOB" checked={form.chkDob} onChange={(e) => setForm((f) => ({ ...f, chkDob: e.currentTarget.checked }))} mb={8} />
                <DateInput aria-label="Date of birth" valueFormat="DD/MM/YYYY" disabled={!form.chkDob} value={form.dob} onChange={(v) => setForm((f) => ({ ...f, dob: v }))} maxDate={new Date()} w={160} />
              </Group>
              <TextInput label="Email ID" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.currentTarget.value }))} />
              <TextInput label="Mobile No" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.currentTarget.value }))} />
              {!fs?.user_based && <Select className="vt-field-required" label="Role" required data={roleOptions} value={form.roleId} onChange={(v) => setForm((f) => ({ ...f, roleId: v || '' }))} clearable />}
              <TextInput label={caption('DESIGNATION', 'Designation')} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.currentTarget.value }))} />
              {!fs?.ad_auth && (
                <>
                  <PasswordInput className="vt-field-required" label="Password" required={!editingId} autoComplete="new-password" description={editingId ? 'Leave blank to keep the current password' : undefined} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.currentTarget.value }))} />
                  <PasswordInput className="vt-field-required" label="Confirm Password" required={!editingId} autoComplete="new-password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.currentTarget.value }))} />
                  {fs?.pwd_rules && (
                    <Text size="xs" c="dimmed">
                      Password rules: min length {fs.rules.min_len}, alphabets {fs.rules.min_alpha}, numeric {fs.rules.min_numeric}, special characters {fs.rules.min_spl}, lower case {fs.rules.min_lower}, upper case {fs.rules.min_upper}.
                    </Text>
                  )}
                  <DateInput label="Password Reset" valueFormat="DD/MM/YYYY" value={form.pwdResetDt} onChange={(v) => setForm((f) => ({ ...f, pwdResetDt: v }))} w={180} />
                </>
              )}
              <Switch label="Inactive" checked={form.inactive} onChange={(e) => setForm((f) => ({ ...f, inactive: e.currentTarget.checked }))} />
              {form.inactive && <Textarea className="vt-field-required" label="Inactive Remarks" required value={form.inactiveRmks} onChange={(e) => setForm((f) => ({ ...f, inactiveRmks: e.currentTarget.value }))} />}
            </Stack>
            <Stack gap="xs" align="center" style={{ flex: '0 0 190px' }}>
              <div style={{ width: 170, height: 190, border: '1px solid var(--vt-line)', borderRadius: 12, background: 'var(--vt-sandal)', display: 'grid', placeItems: 'center', overflow: 'hidden', textAlign: 'center', padding: 8 }}>
                {photoUrl ? <img src={photoUrl} alt="User" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Text size="xs" c="dimmed">{editingId ? 'Click below to add user image' : 'Save the user first, then add the image'}</Text>}
              </div>
              {editingId && (
                <Group gap="xs">
                  <Button component="label" size="compact-sm" variant="light" color="kumkum" leftSection={<Camera size={14} />}>
                    Add image
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (!f) return
                        try {
                          await usersApi.uploadImage(editingId, f)
                          setPhotoKey((k) => k + 1)
                          notifications.show({ message: 'Image updated', color: 'teal' })
                        } catch (err) {
                          notifications.show({ message: err?.response?.data?.detail || 'Could not update the image', color: 'red' })
                        }
                      }}
                    />
                  </Button>
                  {photoUrl && (
                    <Button size="compact-sm" variant="default" onClick={async () => { await usersApi.deleteImage(editingId); setPhotoKey((k) => k + 1) }}>
                      Remove
                    </Button>
                  )}
                </Group>
              )}
            </Stack>
          </Group>
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button color="kumkum" loading={saving} onClick={onSave}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(pwdModalUser)} onClose={() => setPwdModalUser(null)} title={`Reset password for ${pwdModalUser?.UserCode || ''}`}>
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
