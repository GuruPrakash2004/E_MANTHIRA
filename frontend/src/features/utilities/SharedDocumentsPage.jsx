import DataGrid from '../../components/ui/DataGrid'
import { useState } from 'react'
import { ActionIcon, Autocomplete, Button, Card, FileInput, Group, Modal, Skeleton, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FilePlus2, FolderOpen, Pencil, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '../../api/endpoints/utilities'
import EmptyState from '../../components/ui/EmptyState'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import useRights from '../../hooks/useRights'

/**
 * Shared Documents (legacy frmUtlSharedDocuments): files shared with every user, listed by Group Name with remarks.
 * Add needs a group and a file; Edit changes the group and remarks; Remove deletes the row and the file.
 */
export default function SharedDocumentsPage() {
  const rights = useRights()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState(null) // { mode: 'add' | 'edit', ... }
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['shared-docs'], queryFn: api.listSharedDocs })
  const rows = data?.rows || []
  const groups = data?.groups || []
  const current = rows.find((r) => r.doc_id === sel)
  const refresh = () => qc.invalidateQueries({ queryKey: ['shared-docs'] })
  const fail = (e, fallback) => notifications.show({ message: e?.response?.data?.detail || fallback, color: 'red' })

  async function save() {
    setSaving(true)
    try {
      const r = form.mode === 'add' ? await api.addSharedDoc({ group: form.group, remarks: form.remarks, file: form.file }) : await api.updateSharedDoc(form.doc_id, form.group, form.remarks)
      notifications.show({ message: r.message, color: 'teal' })
      setForm(null)
      refresh()
    } catch (e) {
      fail(e, 'Error while saving')
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!current) return notifications.show({ message: 'No files found!', color: 'yellow' })
    if (!(await confirm({ title: 'Delete this document?', message: `Are you sure you want to delete the document '${current.file}'?`, confirmLabel: 'Delete' }))) return
    try {
      await api.deleteSharedDoc(current.doc_id)
      setSel(null)
      refresh()
    } catch (e) {
      fail(e, 'Could not delete the document')
    }
  }
  async function download(r) {
    if (!r.available) return notifications.show({ message: 'File not found!', color: 'red' })
    try {
      const blob = await api.downloadSharedDoc(r.doc_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = r.file
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      fail(e, 'Could not download the file')
    }
  }

  return (
    <Stack gap="lg" className="vt-rise">
      <UtilityBanner
        title="Shared Documents"
        subtitle="Files shared with everyone, kept by group."
        heading="Shared documents"
        sub="Common to all users"
        facts={[{ label: rows.length === 1 ? 'document' : 'documents', value: isLoading ? '-' : rows.length }]}
        emblem={<FolderOpen size={60} color="#F4E1A6" strokeWidth={1.4} />}
        actions={
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        }
      />

      <Card withBorder p="lg">
        <Stack gap="md">
          {isLoading ? (
            <Skeleton height={140} radius="md" />
          ) : rows.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No shared documents yet" hint="Press Add to share the first one." />
          ) : (
            <DataGrid
              name="shared-documents"
              idKey="doc_id"
              rows={rows}
              selected={sel}
              onSelect={setSel}
              maxHeight="60vh"
              columns={[
                { key: 'sl_no', label: 'SI No' },
                { key: 'group', label: 'Group Name' },
                { key: 'file', label: 'File Name' },
                { key: 'remarks', label: 'Remarks' },
                {
                  key: 'dl',
                  label: 'Download',
                  value: () => '',
                  render: (r) => (
                    <ActionIcon variant="subtle" color="kumkum" aria-label={`Download ${r.file}`} disabled={!r.available} title={r.available ? 'Download' : 'This file is not on the server'} onClick={(e) => { e.stopPropagation(); download(r) }}>
                      <Download size={16} />
                    </ActionIcon>
                  ),
                },
              ]}
            />
          )}
          <Group justify="flex-end">
            {rights.add && (
            <Button color="kumkum" leftSection={<FilePlus2 size={16} />} onClick={() => setForm({ mode: 'add', group: '', remarks: '', file: null })}>
              Add
            </Button>
            )}
            {rights.edit && (
            <Button variant="light" color="kumkum" leftSection={<Pencil size={16} />} disabled={!current} onClick={() => setForm({ mode: 'edit', doc_id: current.doc_id, group: current.group, file_name: current.file, remarks: current.remarks })}>
              Edit
            </Button>
            )}
            {rights.del && (
            <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={!current} onClick={remove}>
              Remove
            </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {form && (
        <Modal opened onClose={() => setForm(null)} radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{form.mode === 'add' ? 'Add document' : 'Edit document'}</Text>}>
          <Stack gap="sm">
            <Autocomplete className="vt-field-required" label="Group Name" required data={groups} value={form.group} onChange={(v) => setForm({ ...form, group: v })} maxLength={100} data-autofocus />
            {form.mode === 'add' ? (
              <FileInput className="vt-field-required" label="Document" required placeholder="Browse for a file" value={form.file} onChange={(f) => setForm({ ...form, file: f })} />
            ) : (
              <TextInput className="vt-fld-readonly" label="Document" readOnly value={form.file_name} />
            )}
            <Textarea label="Remarks" autosize minRows={2} maxLength={250} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button color="kumkum" loading={saving} disabled={!form.group.trim() || (form.mode === 'add' && !form.file)} onClick={save}>OK</Button>
              <Button variant="default" onClick={() => setForm(null)}>Cancel</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
