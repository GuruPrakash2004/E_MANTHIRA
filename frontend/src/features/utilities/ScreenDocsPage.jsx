import { useState } from 'react'
import { ActionIcon, Button, Card, FileInput, Group, Modal, Select, Skeleton, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FilePlus2, FileText, Pencil, Trash2, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../../api/endpoints/utilities'
import EmptyState from '../../components/ui/EmptyState'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'

/**
 * Screen Documents (legacy frmUtlScreenDocs): reference files attached to a screen, grouped by Group Name, each with
 * remarks. Screens come from the live menu plus any caption already used in UtlScreenDocs; `?screen=` opens one directly.
 */
export default function ScreenDocsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [params] = useSearchParams()
  const [screen, setScreen] = useState(params.get('screen') || null)
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState(null) // { mode: 'add' | 'edit', ... }
  const [saving, setSaving] = useState(false)

  const { data: screens } = useQuery({ queryKey: ['screen-doc-screens'], queryFn: api.screenDocScreens })
  const { data: docs, isLoading } = useQuery({ queryKey: ['screen-docs', screen], queryFn: () => api.listScreenDocs(screen), enabled: Boolean(screen) })
  const rows = docs || []
  const current = rows.find((r) => r.doc_id === sel)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['screen-docs'] })
    qc.invalidateQueries({ queryKey: ['screen-doc-screens'] })
  }
  const fail = (e, fallback) => notifications.show({ message: e?.response?.data?.detail || fallback, color: 'red' })

  async function save() {
    setSaving(true)
    try {
      const r = form.mode === 'add' ? await api.addScreenDoc({ screen, group: form.group, remarks: form.remarks, file: form.file }) : await api.updateScreenDoc(form.doc_id, form.remarks)
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
    if (!current || !(await confirm({ title: 'Remove this document?', message: `${current.file} will be removed from this screen.`, confirmLabel: 'Remove' }))) return
    try {
      await api.deleteScreenDoc(current.doc_id)
      setSel(null)
      refresh()
    } catch (e) {
      fail(e, 'Could not remove the document')
    }
  }
  async function download(r) {
    if (!r.available) return notifications.show({ message: `This file : ${r.file} does not exist on the server`, color: 'red' })
    try {
      const blob = await api.downloadScreenDoc(r.doc_id)
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
        title="Screen Documents"
        subtitle="Manuals, forms and notes attached to a screen."
        heading={screen || 'Choose a screen'}
        sub="Screen documents"
        facts={[{ label: rows.length === 1 ? 'document' : 'documents', value: screen ? (isLoading ? '-' : rows.length) : '-' }]}
        emblem={<FileText size={60} color="#F4E1A6" strokeWidth={1.4} />}
        actions={
          <Button variant="default" leftSection={<X size={16} />} onClick={() => navigate(-1)}>
            Close
          </Button>
        }
      />

      <Card withBorder p="lg">
        <Stack gap="md">
          <Select
            className="vt-field-required"
            label="Screen"
            placeholder="Choose a screen"
            searchable
            data={(screens || []).map((s) => ({ value: s.caption, label: s.count ? `${s.caption} (${s.count})` : s.caption }))}
            value={screen}
            onChange={(v) => { setScreen(v); setSel(null) }}
            maw={420}
          />
          {!screen ? (
            <EmptyState icon={FileText} title="Choose a screen" hint="Its attached documents are listed here." />
          ) : isLoading ? (
            <Skeleton height={140} radius="md" />
          ) : rows.length === 0 ? (
            <EmptyState icon={FileText} title="No documents on this screen" hint="Press Add to attach the first one." />
          ) : (
            <Table.ScrollContainer minWidth={520}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={70}>SI No</Table.Th>
                    <Table.Th>Group Name</Table.Th>
                    <Table.Th>File Name</Table.Th>
                    <Table.Th>Remarks</Table.Th>
                    <Table.Th w={50} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.doc_id} onClick={() => setSel(r.doc_id)} style={{ cursor: 'pointer', background: sel === r.doc_id ? 'var(--vt-gold-chip)' : undefined }}>
                      <Table.Td>{r.sl_no}</Table.Td>
                      <Table.Td>{r.group}</Table.Td>
                      <Table.Td>{r.file}</Table.Td>
                      <Table.Td>{r.remarks}</Table.Td>
                      <Table.Td>
                        <ActionIcon variant="subtle" color="kumkum" aria-label={`Download ${r.file}`} disabled={!r.available} title={r.available ? 'Download' : 'This file is not on the server'} onClick={(e) => { e.stopPropagation(); download(r) }}>
                          <Download size={16} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<FilePlus2 size={16} />} disabled={!screen} onClick={() => setForm({ mode: 'add', group: '', remarks: '', file: null })}>
              Add
            </Button>
            <Button variant="light" color="kumkum" leftSection={<Pencil size={16} />} disabled={!current} onClick={() => setForm({ mode: 'edit', doc_id: current.doc_id, group: current.group, file_name: current.file, remarks: current.remarks })}>
              Edit
            </Button>
            <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={!current} onClick={remove}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Card>

      {form && (
        <Modal opened onClose={() => setForm(null)} radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{form.mode === 'add' ? 'Add document' : 'Edit document'}</Text>}>
          <Stack gap="sm">
            <TextInput className="vt-field-required" label="Group Name" required readOnly={form.mode === 'edit'} value={form.group} onChange={(e) => setForm({ ...form, group: e.currentTarget.value })} data-autofocus />
            {form.mode === 'add' ? (
              <FileInput className="vt-field-required" label="File" required placeholder="Browse for a file" value={form.file} onChange={(f) => setForm({ ...form, file: f })} />
            ) : (
              <TextInput className="vt-fld-readonly" label="File Name" readOnly value={form.file_name} />
            )}
            <Textarea label="Remarks" autosize minRows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button color="kumkum" loading={saving} disabled={form.mode === 'add' && (!form.group.trim() || !form.file)} onClick={save}>Save</Button>
              <Button variant="default" onClick={() => setForm(null)}>Cancel</Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
