import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Textarea,
  Kbd,
} from '@mantine/core'
import { Download, SquarePen, FileUp, Plus, Search, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as attachmentsApi from '../../api/endpoints/attachments'
import * as mastersApi from '../../api/endpoints/masters'
import * as metaApi from '../../api/endpoints/meta'
import DynamicField from '../../components/DynamicField'
import { isFieldHidden, isFieldMandatory } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'

/** File attachments panel (UtlAttachFiles) — only shown for masters with FileAttachReq='Y', on an existing row. */
function AttachmentsSection({ docId, rowId }) {
  const queryClient = useQueryClient()
  const { data: files, refetch } = useQuery({
    queryKey: ['attachments', docId, rowId],
    queryFn: () => attachmentsApi.listAttachments(docId, rowId),
  })

  async function onUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await attachmentsApi.uploadAttachment(docId, rowId, file, '')
      notifications.show({ message: 'File attached', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['attachments', docId, rowId] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Upload failed', color: 'red' })
    } finally {
      e.target.value = ''
    }
  }

  async function onDelete(fileName) {
    if (!window.confirm('Remove this attachment?')) return
    try {
      await attachmentsApi.deleteAttachment(docId, rowId, fileName)
      notifications.show({ message: 'Attachment removed', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['attachments', docId, rowId] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not remove', color: 'red' })
    }
  }

  return (
    <div>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>
          Attachments
        </Text>
        <Button component="label" size="xs" variant="light" color="kumkum" leftSection={<FileUp size={14} />}>
          Add File
          <input type="file" hidden onChange={onUpload} />
        </Button>
      </Group>
      <Stack gap={4}>
        {(files || []).length === 0 && (
          <Text size="xs" c="dimmed">
            No files attached.
          </Text>
        )}
        {(files || []).map((f) => (
          <Group key={f.AFileName} justify="space-between" wrap="nowrap">
            <Text size="xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.AFileName.replace(/^\d+_/, '')}
            </Text>
            <Group gap={4} wrap="nowrap">
              <ActionIcon size="sm" variant="subtle" color="kumkum" onClick={() => attachmentsApi.downloadAttachment(docId, rowId, f.AFileName)}>
                <Download size={14} />
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onDelete(f.AFileName)}>
                <Trash2 size={14} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>
    </div>
  )
}

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

const EMPTY_FORM = { code: '', name: '', inactive: false, inactiveRmks: '' }

export default function MasterPage() {
  const { docId } = useParams()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [extra, setExtra] = useState({})
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['master', docId, search],
    queryFn: () => mastersApi.listMaster(docId, search ? { search } : undefined),
  })
  const { data: fieldsData } = useQuery({
    queryKey: ['doc-fields', docId],
    queryFn: () => metaApi.getDocFields(docId),
  })

  useEffect(() => {
    setSearch('')
  }, [docId])

  const meta = data?.meta
  const rows = data?.rows || []
  // Live values keyed by legacy FldCode, for evaluating conditional hide/
  // mandatory rules exactly like the dynamic transaction-screen engine
  // (useDocFields + docFieldConditions) — works for free here because `extra`
  // is already keyed by FldCode, same as isFieldHidden/isFieldMandatory expect.
  const codeValues = { [meta?.code_col]: form.code, [meta?.name_col]: form.name, ...extra }
  const extraFields = (fieldsData?.fields || []).filter(
    (f) => f.FldCode !== meta?.code_col && f.FldCode !== meta?.name_col && !isFieldHidden(f, codeValues)
  )

  function setExtraField(code, value) {
    setExtra((e) => ({ ...e, [code]: value }))
  }

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setExtra({})
    setModalOpen(true)
  }

  function openEdit(row) {
    setEditingId(row[meta.id_col])
    setForm({
      code: row[meta.code_col] || '',
      name: row[meta.name_col] || '',
      inactive: (row.InActive || 'N').toUpperCase() === 'Y',
      inactiveRmks: row.InActiveRmks || '',
    })
    setExtra(Object.fromEntries(extraFields.map((f) => [f.FldCode, row[f.FldCode]])))
    setModalOpen(true)
  }

  async function onSave() {
    if (!meta) return
    setSaving(true)
    try {
      const values = {
        [meta.code_col]: form.code.trim(),
        [meta.name_col]: form.name.trim(),
        InActive: form.inactive ? 'Y' : 'N',
        InActiveRmks: form.inactiveRmks.trim(),
        ...extra,
      }
      if (editingId) {
        await mastersApi.updateMasterRow(docId, editingId, values)
      } else {
        await mastersApi.createMasterRow(docId, values)
      }
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['master', docId] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(row) {
    if (!meta) return
    if (!window.confirm(`Delete ${row[meta.name_col]}?`)) return
    try {
      await mastersApi.deleteMasterRow(docId, row[meta.id_col])
      notifications.show({ message: 'Deleted Successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['master', docId] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Delete failed', color: 'red' })
    }
  }

  useDocShortcuts({
    onNew: () => !modalOpen && openAdd(),
    onSave: () => modalOpen && onSave(),
    onClose: () => modalOpen && setModalOpen(false),
  })

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              {meta?.caption || 'Master'}
            </Title>
            <Text size="sm" c="dimmed">
              {rows.length} record{rows.length === 1 ? '' : 's'}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <Kbd size="xs">Alt+N</Kbd>
          <Button leftSection={<Plus size={16} />} color="kumkum" onClick={openAdd} disabled={!meta}>
            Add New
          </Button>
        </Group>
      </Group>

      <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${KOLAM_PATTERN})`,
            backgroundSize: '140px 140px',
            opacity: 0.03,
            pointerEvents: 'none',
          }}
        />
        <TextInput
          placeholder="Search by code or name..."
          leftSection={<Search size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          mb="md"
          style={{ position: 'relative', maxWidth: 340 }}
        />

        <Table striped highlightOnHover style={{ position: 'relative' }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Code</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th w={90}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {!isLoading && rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c="dimmed" ta="center" py="md">
                    No records yet — click "Add New" to create the first one.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map((row) => (
              <Table.Tr key={row[meta.id_col]}>
                <Table.Td>{row[meta.code_col]}</Table.Td>
                <Table.Td>{row[meta.name_col]}</Table.Td>
                <Table.Td>
                  {(row.InActive || 'N').toUpperCase() === 'Y' ? (
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
                    <ActionIcon variant="subtle" color="kumkum" onClick={() => openEdit(row)}>
                      <SquarePen size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => onDelete(row)}>
                      <Trash2 size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? `Edit ${meta?.caption}` : `Add ${meta?.caption}`} radius="lg">
        <Stack>
          <TextInput
            label={`${meta?.short_form || ''} Code`}
            required
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.currentTarget.value }))}
          />
          <TextInput
            label={`${meta?.short_form || ''} Name`}
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.currentTarget.value }))}
          />
          {extraFields.map((f) => (
            <DynamicField
              key={f.FldCode}
              docId={docId}
              field={f}
              value={extra[f.FldCode]}
              onChange={(v) => setExtraField(f.FldCode, v)}
              required={isFieldMandatory(f, codeValues)}
            />
          ))}
          <Checkbox
            label="Inactive"
            checked={form.inactive}
            onChange={(e) => setForm((f) => ({ ...f, inactive: e.currentTarget.checked }))}
          />
          {form.inactive && (
            <Textarea
              label="Inactive Remarks"
              required
              value={form.inactiveRmks}
              onChange={(e) => setForm((f) => ({ ...f, inactiveRmks: e.currentTarget.value }))}
            />
          )}
          {editingId && meta?.file_attach_req && <AttachmentsSection docId={docId} rowId={editingId} />}
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
    </Stack>
  )
}
