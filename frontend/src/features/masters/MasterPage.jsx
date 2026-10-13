import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Kbd, Menu, Modal, SegmentedControl, Select, Skeleton, Stack, Table, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ChevronUp, Copy, Database, Download, FileText, FileUp, ImageUp, Plus, Save, Search, SquarePen, Trash2, X } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as attachmentsApi from '../../api/endpoints/attachments'
import * as mastersApi from '../../api/endpoints/masters'
import * as metaApi from '../../api/endpoints/meta'
import DynamicField from '../../components/DynamicField'
import CoreField from './CoreField'
import AttachSevaModal from './AttachSevaModal'
import { ActivitiesModal, AddressesModal, AlertsModal, ContactsModal } from './PartyPanels'
import EmptyState from '../../components/ui/EmptyState'
import { SectionCard } from '../../components/ui/EntryParts'
import { isFieldHidden, isFieldMandatory } from '../../utils/docFieldConditions'
import useDocShortcuts from '../../hooks/useDocShortcuts'

// Everything on this screen is driven by backend metadata: caption / short form / column names / attachment flag from
// the master's UtlTransactions row (`meta`), and every extra field (caption, widget, list, mandatory, read-only,
// default, hide rules) from UtlDocDsgrFlds. Nothing here is specific to one master.

const EMPTY_FORM = { code: '', name: '', inactive: false, inactiveRmks: '' }
const flagDefaults = (fields) => Object.fromEntries(fields.filter((f) => f.type === 'flag').map((f) => [f.code, 'N']))
const isInactive = (row) => (row.InActive || 'N').toUpperCase() === 'Y'

/** File attachments panel (UtlAttachFiles), only shown for masters with FileAttachReq='Y', on an existing row. */
function AttachmentsSection({ docId, rowId }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
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
    if (!(await confirm({ title: 'Remove this attachment?', message: 'The file will be removed from this record.', confirmLabel: 'Remove' }))) return
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
      <Group justify="space-between" mb={6}>
        <Text size="sm" fw={700}>
          Attachments ({(files || []).length})
        </Text>
        <Button component="label" size="xs" variant="light" color="kumkum" leftSection={<FileUp size={14} />}>
          Add file
          <input type="file" hidden onChange={onUpload} />
        </Button>
      </Group>
      <Stack gap={6}>
        {(files || []).length === 0 && (
          <Text size="xs" c="dimmed">
            No files attached yet.
          </Text>
        )}
        {(files || []).map((f) => (
          <Group key={f.AFileName} justify="space-between" wrap="nowrap" px="sm" py={6} style={{ border: '1px solid var(--vt-line)', borderRadius: 10, background: 'var(--vt-surface)' }}>
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <FileText size={16} color="var(--vt-accent)" aria-hidden />
              <Text size="sm" truncate>
                {f.AFileName.replace(/^\d+_/, '')}
              </Text>
            </Group>
            <Group gap={2} wrap="nowrap">
              <ActionIcon size={32} variant="subtle" color="kumkum" aria-label={`Download ${f.AFileName.replace(/^\d+_/, '')}`} onClick={() => attachmentsApi.downloadAttachment(docId, rowId, f.AFileName)}>
                <Download size={16} />
              </ActionIcon>
              <ActionIcon size={32} variant="subtle" color="red" aria-label={`Remove ${f.AFileName.replace(/^\d+_/, '')}`} onClick={() => onDelete(f.AFileName)}>
                <Trash2 size={16} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>
    </div>
  )
}

export default function MasterPage() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const listRef = useRef(null)
  const searchRef = useRef(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  // view = record shown read-only (legacy: form locked until New/Edit); new / edit = fields open, Save + Cancel offered.
  const [mode, setMode] = useState('view')
  const [form, setForm] = useState(EMPTY_FORM)
  const [extra, setExtra] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [panel, setPanel] = useState(null) // open Supplier sub-screen / Attach Seva dialog
  const [copyOpen, setCopyOpen] = useState(false)
  const [itemImgVersion, setItemImgVersion] = useState(0)
  const imgInput = useRef(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['master', docId, search],
    queryFn: () => mastersApi.listMaster(docId, search ? { search } : undefined),
  })
  const { data: fieldsData } = useQuery({
    queryKey: ['doc-fields', docId],
    queryFn: () => metaApi.getDocFields(docId),
  })

  const { data: layout } = useQuery({ queryKey: ['master-layout', docId], queryFn: () => mastersApi.getMasterLayout(docId), staleTime: 5 * 60_000 })
  const coreFields = layout?.fields || []
  // masters with a single key field instead of a Code/Name pair (State City Country)
  const primary = layout?.primary || null
  const panels = layout?.panels || []
  const panelDocId = Number(docId)

  const editing = mode !== 'view'
  const meta = data?.meta
  // The legacy list includes the ID-0 "none" placeholder row; it is not a real record, so it is not shown here.
  const allRows = useMemo(() => (data?.rows || []).filter((r) => !meta || r[meta.id_col] !== 0), [data, meta])
  const rows = useMemo(() => {
    if (!meta) return []
    const filtered = allRows.filter((r) => (statusFilter === 'all' ? true : statusFilter === 'active' ? !isInactive(r) : isInactive(r)))
    return [...filtered].sort((a, b) => String(a[meta.code_col] ?? '').localeCompare(String(b[meta.code_col] ?? ''), undefined, { numeric: true, sensitivity: 'base' }))
  }, [allRows, meta, statusFilter])
  const selectedRow = meta ? allRows.find((r) => r[meta.id_col] === selectedId) : null
  const hasParty = panels.length > 0 && Boolean(selectedId)
  const { data: counts } = useQuery({ queryKey: ['party-counts', panelDocId, selectedId], queryFn: () => mastersApi.partyCounts(panelDocId, selectedId), enabled: hasParty && !editing })
  const { data: contactRows = [] } = useQuery({ queryKey: ['party-contacts', panelDocId, selectedId], queryFn: () => mastersApi.listContacts(panelDocId, selectedId), enabled: hasParty && !editing })
  const { data: itemImg } = useQuery({
    queryKey: ['master-image', panelDocId, selectedId, itemImgVersion],
    queryFn: async () => {
      try {
        return URL.createObjectURL(await mastersApi.masterImage(panelDocId, selectedId))
      } catch {
        return null
      }
    },
    enabled: Boolean(layout?.image) && Boolean(selectedId),
  })
  const index = selectedRow ? rows.findIndex((r) => r[meta.id_col] === selectedId) : -1

  const bodyFields = useMemo(() => (fieldsData?.fields || []).filter((f) => f.FldCode !== meta?.code_col && f.FldCode !== meta?.name_col), [fieldsData, meta])
  // Live values keyed by legacy FldCode, for evaluating conditional hide/mandatory rules exactly like the dynamic
  // transaction-screen engine (useDocFields + docFieldConditions); `extra` is already keyed by FldCode.
  const codeValues = { [meta?.code_col]: form.code, [meta?.name_col]: form.name, ...extra }
  const extraFields = bodyFields.filter((f) => !isFieldHidden(f, codeValues))

  function loadRow(row) {
    setSelectedId(row[meta.id_col])
    setForm({ code: row[meta.code_col] || '', name: row[meta.name_col] || '', inactive: isInactive(row), inactiveRmks: row.InActiveRmks || '' })
    setExtra(Object.fromEntries([...bodyFields.map((f) => f.FldCode), ...coreFields.map((f) => f.code)].map((c) => [c, row[c]])))
    setFormError('')
    setMode('view')
  }

  // Switching to another master starts clean.
  useEffect(() => {
    setSearch('')
    setStatusFilter('all')
    setSelectedId(null)
    setMode('view')
    setForm(EMPTY_FORM)
    setExtra({})
  }, [docId])
  // While viewing, keep a valid selection (first row by default) as the list loads or changes, and refresh the shown values.
  useEffect(() => {
    if (!meta || mode !== 'view') return
    if (selectedRow) loadRow(selectedRow)
    else if (rows.length) loadRow(rows[0])
    else {
      setSelectedId(null)
      setForm(EMPTY_FORM)
      setExtra({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, meta, fieldsData, layout, statusFilter])

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const setExtraField = (code, value) => setExtra((e) => ({ ...e, [code]: value }))

  function goto(i) {
    if (editing || !rows.length) return
    const row = rows[Math.min(Math.max(i, 0), rows.length - 1)]
    if (row) loadRow(row)
  }
  function onNew() {
    if (!meta || editing) return
    setSelectedId(null)
    setForm(EMPTY_FORM)
    setExtra({ ...flagDefaults(coreFields), ...(layout?.defaults || {}) })
    setFormError('')
    setMode('new')
  }
  function onEdit() {
    if (!selectedRow || editing) return
    setFormError('')
    setMode('edit')
  }
  function onCancel() {
    if (!editing) return
    setFormError('')
    if (selectedRow) loadRow(selectedRow)
    else if (rows.length) loadRow(rows[0])
    else {
      setForm(EMPTY_FORM)
      setExtra({})
      setMode('view')
    }
  }
  function onClose() {
    if (editing) return onCancel()
    navigate('/')
  }

  async function sendApproval(id) {
    try {
      const r = await mastersApi.sendApprovalMail(docId, id)
      notifications.show({ title: r.message, message: (r.sent || []).join('; '), color: 'teal' })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not send the mail', color: 'red' })
    }
  }

  async function onSave() {
    if (!meta || !editing) return
    setSaving(true)
    setFormError('')
    try {
      const values = {
        [meta.code_col]: form.code.trim(),
        [meta.name_col]: form.name.trim(),
        InActive: form.inactive ? 'Y' : 'N',
        InActiveRmks: form.inactiveRmks.trim(),
        ...(mode === 'new' ? flagDefaults(coreFields) : {}),
        ...extra,
      }
      if (primary) values[meta.code_col] = values[meta.name_col] = form.name.trim()
      const saved = mode === 'edit' ? await mastersApi.updateMasterRow(docId, selectedId, values) : await mastersApi.createMasterRow(docId, values)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      if (saved && saved[meta.id_col] != null) setSelectedId(saved[meta.id_col])
      // Legacy: with e-mail approval on, saving a record that still needs approval mails the approvers straight away.
      if (saved && (layout?.options || []).some((o) => o.name === 'Send Mail for Approval')) sendApproval(saved[meta.id_col])
      setMode('view')
      await queryClient.invalidateQueries({ queryKey: ['master', docId] })
      refetch()
    } catch (err) {
      const detail = err?.response?.data?.detail
      const status = err?.response?.status
      // Validation problems (blank code/name, duplicate code, missing remarks) are shown next to the form.
      if (detail && [409, 422].includes(status)) setFormError(detail)
      else notifications.show({ message: detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!meta || !selectedRow || editing) return
    if (!(await confirm({ title: 'Delete this record?', message: `${selectedRow[meta.name_col]} will be deleted. This cannot be undone.`, confirmLabel: 'Delete' }))) return
    try {
      await mastersApi.deleteMasterRow(docId, selectedId)
      notifications.show({ message: 'Deleted Successfully!', color: 'teal' })
      setSelectedId(null)
      await queryClient.invalidateQueries({ queryKey: ['master', docId] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Delete failed', color: 'red' })
    }
  }

  useDocShortcuts({
    onNew,
    onEdit,
    onSave,
    onDelete,
    onCancel,
    onClose,
    onPrev: () => goto(index - 1),
    onNext: () => goto(index + 1),
    onFirst: () => goto(0),
    onLast: () => goto(rows.length - 1),
    onFind: () => searchRef.current?.focus(),
  })

  const caption = meta?.caption || 'Master'
  const partyInfo = {
    code: selectedRow?.[meta?.code_col] || '',
    name: selectedRow?.[meta?.name_col] || '',
    codeCaption: layout?.code_caption || `${meta?.short_form || ''} Code`,
    noun: caption.replace(/ Master$/, ''),
  }
  const filtering = Boolean(search) || statusFilter !== 'all'
  const modeLabel = mode === 'new' ? 'New record' : mode === 'edit' ? 'Editing' : selectedRow ? 'Viewing' : ''

  const navBtn = (label, icon, onClick, disabled) => (
    <Tooltip label={label} withArrow>
      <ActionIcon variant="default" size={40} aria-label={label} onClick={onClick} disabled={disabled}>
        {icon}
      </ActionIcon>
    </Tooltip>
  )

  return (
    <Stack gap="lg" className="vt-rise" pb={72}>
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <div aria-hidden style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg, var(--vt-g1), var(--vt-g2d))', color: '#F4E1A6', boxShadow: '0 4px 12px rgba(122,31,31,0.25)' }}>
            <Database size={24} />
          </div>
          <div>
            <Title order={2}>{caption}</Title>
            <Text size="sm" c="dimmed">
              {isLoading ? 'Loading records' : `${allRows.length} record${allRows.length === 1 ? '' : 's'}`}
            </Text>
          </div>
        </Group>
        {meta?.auth_req && selectedRow && !editing && (
          <Badge size="lg" variant="light" color={selectedRow.Authorised === 'Y' ? 'green' : 'red'} tt="none">
            {selectedRow.Authorised === 'Y' ? 'APPROVED' : 'UN-APPROVED'}
          </Badge>
        )}
        {modeLabel && (
          <Badge size="lg" variant="light" color={editing ? 'kumkum' : 'gray'} tt="none">
            {modeLabel}
          </Badge>
        )}
      </Group>

      <div className="vt-master-layout">
        {/* Record list + search */}
        <Card withBorder p="md" className="vt-master-list-card">
          <Stack gap="sm">
            <TextInput
              ref={searchRef}
              aria-label={`Search ${caption} by code or name`}
              placeholder="Search by code or name"
              leftSection={<Search size={16} />}
              rightSection={
                search ? (
                  <ActionIcon variant="subtle" color="gray" size={28} aria-label="Clear search" onClick={() => setSearch('')}>
                    <X size={14} />
                  </ActionIcon>
                ) : null
              }
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <SegmentedControl
              aria-label="Status filter"
              color="kumkum"
              size="xs"
              fullWidth
              value={statusFilter}
              onChange={setStatusFilter}
              data={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <div ref={listRef} className="vt-master-list" role="listbox" aria-label={`${caption} records`}>
              {isLoading ? (
                Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} height={46} radius="md" mb={6} />)
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={filtering ? Search : Database}
                  title={filtering ? 'No matching records' : `No ${caption.toLowerCase()} records yet`}
                  hint={filtering ? 'Try a different word, or clear the search and filter.' : 'Use New to add the first one.'}
                />
              ) : (
                rows.map((row) => {
                  const active = row[meta.id_col] === selectedId
                  return (
                    <UnstyledButton
                      key={row[meta.id_col]}
                      role="option"
                      aria-selected={active}
                      aria-current={active ? 'true' : undefined}
                      disabled={editing}
                      onClick={() => loadRow(row)}
                      className="vt-master-item"
                      data-active={active || undefined}
                    >
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={600} truncate>
                            {row[meta.name_col]}
                          </Text>
                          <Text size="xs" c="dimmed" className="vt-num" truncate>
                            {(layout?.list_subtitle_cols || []).length ? layout.list_subtitle_cols.map((c) => row[c]).filter(Boolean).join(' · ') : row[meta.code_col]}
                          </Text>
                        </div>
                        {isInactive(row) && (
                          <Badge color="gray" variant="light" size="sm">
                            Inactive
                          </Badge>
                        )}
                      </Group>
                    </UnstyledButton>
                  )
                })
              )}
            </div>
            {filtering && (
              <Text size="xs" c="dimmed">
                Showing {rows.length} of {allRows.length}
              </Text>
            )}
          </Stack>
        </Card>

        {/* Record form */}
        <Stack gap="md" style={{ minWidth: 0 }}>
          <SectionCard title={`${caption} details`} hint={editing ? 'Fill in the fields and press Save (Alt+S).' : 'Choose New (Alt+N) to add a record, or Edit (Alt+E) to change this one.'}>
            <Stack gap="sm">
              {formError && (
                <Alert color="red" variant="light" role="alert">
                  {formError}
                </Alert>
              )}
              {/* Code and Name are always mandatory on a master: red captions, like the legacy screens. */}
              {primary ? (
                <TextInput
                  className="vt-field-required"
                  data-autofocus
                  label={primary.caption}
                  required
                  readOnly={!editing}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.currentTarget.value, name: e.currentTarget.value }))}
                  maw={520}
                />
              ) : (
                <>
                  <TextInput
                    className="vt-field-required"
                    data-autofocus
                    label={layout?.code_caption || `${meta?.short_form || ''} Code`}
                    required
                    readOnly={!editing}
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.currentTarget.value }))}
                    maw={520}
                  />
                  <TextInput
                    className="vt-field-required"
                    label={layout?.name_caption || `${meta?.short_form || ''} Name`}
                    required
                    readOnly={!editing}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.currentTarget.value }))}
                    maw={520}
                  />
                </>
              )}
              {/* Built-in fields served by GET /masters/{doc}/layout (Item, Supplier, State City Country ...) */}
              {coreFields.filter((f) => f.type !== 'flag').map((f) => (
                <div key={f.code} style={{ maxWidth: 520 }}>
                  <CoreField
                    docId={docId}
                    field={f}
                    value={extra[f.code]}
                    locked={!editing}
                    onChange={(v, opt) =>
                      setExtra((e) => {
                        const next = { ...e, [f.code]: v }
                        if (opt && f.fills) Object.entries(f.fills).forEach(([target, src]) => (next[target] = opt[src] ?? ''))
                        return next
                      })
                    }
                  />
                </div>
              ))}
              {coreFields.some((f) => f.type === 'flag') && (
                <Group gap="lg" wrap="wrap">
                  {coreFields.filter((f) => f.type === 'flag').map((f) => (
                    <CoreField key={f.code} docId={docId} field={f} value={extra[f.code]} locked={!editing} onChange={(v) => setExtra((e) => ({ ...e, [f.code]: v }))} />
                  ))}
                </Group>
              )}
              {layout?.image && (
                <Group gap="sm" align="flex-start" wrap="nowrap">
                  <div style={{ width: 120, height: 120, borderRadius: 12, border: '1px solid var(--vt-line)', background: 'var(--vt-sandal)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                    {itemImg ? <img src={itemImg} alt="Item" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageUp size={26} aria-hidden color="var(--vt-accent)" />}
                  </div>
                  <input
                    ref={imgInput}
                    type="file"
                    accept="image/png,image/jpeg"
                    hidden
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file || !selectedId) return
                      try {
                        await mastersApi.setMasterImage(panelDocId, selectedId, file)
                        setItemImgVersion((v) => v + 1)
                        notifications.show({ message: 'Image updated', color: 'teal' })
                      } catch (err) {
                        notifications.show({ message: err?.response?.data?.detail || 'Could not update the image', color: 'red' })
                      }
                    }}
                  />
                  <Button size="xs" variant="light" color="kumkum" leftSection={<ImageUp size={14} />} disabled={!selectedId || editing} onClick={() => imgInput.current?.click()}>
                    {itemImg ? 'Change image' : 'Add image'}
                  </Button>
                </Group>
              )}
              {!layout?.hide_inactive && (
              <Checkbox
                color="kumkum"
                label="Inactive"
                description="Inactive records stay in the list but are not offered in dropdowns."
                disabled={!editing}
                checked={form.inactive}
                onChange={(e) => setForm((f) => ({ ...f, inactive: e.currentTarget.checked }))}
              />
              )}
              {form.inactive && !layout?.hide_inactive && (
                <Textarea
                  className="vt-field-required"
                  label="Inactive Remarks"
                  required
                  readOnly={!editing}
                  autosize
                  minRows={2}
                  maw={520}
                  value={form.inactiveRmks}
                  onChange={(e) => setForm((f) => ({ ...f, inactiveRmks: e.currentTarget.value }))}
                />
              )}
            </Stack>
          </SectionCard>

          {extraFields.length > 0 && (
            <SectionCard title="Header Info">
              <Stack gap="sm" maw={520}>
                {extraFields.map((f) => (
                  <DynamicField key={f.FldCode} docId={docId} field={f} value={extra[f.FldCode]} onChange={(v) => setExtraField(f.FldCode, v)} required={isFieldMandatory(f, codeValues)} locked={!editing} />
                ))}
              </Stack>
            </SectionCard>
          )}

          {panels.length > 0 && (
            <SectionCard title="More details">
              <Stack gap="sm">
                <Group gap="xs" wrap="wrap">
                  {panels.map((p) => (
                    <Button key={p.key} variant="default" disabled={!selectedRow || editing} onClick={() => setPanel(p.key)}>
                      {p.label} ({counts?.[p.key] ?? 0})
                    </Button>
                  ))}
                </Group>
                {contactRows.length > 0 && (
                  <Table.ScrollContainer minWidth={420}>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Name</Table.Th>
                          <Table.Th>Designation</Table.Th>
                          <Table.Th>Mobile No</Table.Th>
                          <Table.Th>eMail</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {contactRows.map((c) => (
                          <Table.Tr key={c.PartyCID}>
                            <Table.Td>{c.CName}</Table.Td>
                            <Table.Td>{c.CDesig}</Table.Td>
                            <Table.Td>{c.CMobNo}</Table.Td>
                            <Table.Td>{c.Email}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
                {!selectedRow && (
                  <Text size="xs" c="dimmed">
                    Save the record first to add addresses, contacts, alerts and notes.
                  </Text>
                )}
              </Stack>
            </SectionCard>
          )}

          {meta?.file_attach_req && (
            <SectionCard title="File Attachment">
              {selectedRow && mode === 'view' ? (
                <AttachmentsSection docId={docId} rowId={selectedId} />
              ) : (
                <Text size="xs" c="dimmed">
                  Save the record first, then attach files to it.
                </Text>
              )}
            </SectionCard>
          )}
        </Stack>
      </div>

      {/* Action bar pinned to the bottom, like the legacy form footer: New / Edit / Delete / Close and record navigation. */}
      <div style={{ position: 'sticky', bottom: 12, zIndex: 5 }}>
        <Group justify="space-between" gap="xs" p="sm" style={{ borderRadius: 16, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', boxShadow: '0 6px 20px rgba(43,9,9,0.12)' }}>
          <Group gap="xs" wrap="wrap">
            {editing ? (
              <>
                <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
                  Save
                </Button>
                <Button variant="default" leftSection={<X size={16} />} onClick={onCancel}>
                  Cancel
                </Button>
                {mode === 'new' && layout?.copy_from && (
                  <Button variant="light" color="kumkum" leftSection={<Copy size={16} />} onClick={() => setCopyOpen(true)}>
                    Copy From
                  </Button>
                )}
                <Group gap={6} c="dimmed" visibleFrom="sm">
                  <Kbd size="xs">Alt+S</Kbd>
                </Group>
              </>
            ) : (
              <>
                <Button color="kumkum" leftSection={<Plus size={16} />} onClick={onNew} disabled={!meta}>
                  New
                </Button>
                <Button variant="light" color="kumkum" leftSection={<SquarePen size={16} />} onClick={onEdit} disabled={!selectedRow}>
                  Edit
                </Button>
                <Button variant="light" color="red" leftSection={<Trash2 size={16} />} onClick={onDelete} disabled={!selectedRow}>
                  Delete
                </Button>
                <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
                  Close
                </Button>
                {(layout?.options || []).length > 0 && (
                  <Menu position="top-start" withinPortal>
                    <Menu.Target>
                      <Button variant="light" color="gold" c="var(--vt-badge-ink)" rightSection={<ChevronUp size={14} />} disabled={!selectedRow}>
                        Options
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {layout.options.map((o) => (
                        <Menu.Item
                          key={o.name}
                          onClick={async () => {
                            if (o.name === 'Attach Seva') return setPanel('attach-seva')
                            if (o.name === 'Send Mail for Approval') return sendApproval(selectedId)
                            if (o.name === 'Approve') {
                              const approved = selectedRow.Authorised === 'Y'
                              const ok = await confirm({
                                title: approved ? 'Revoke approval?' : 'Approve this record?',
                                message: approved ? `'${selectedRow[meta.code_col]}' is already approved. Do you want to revoke it?` : `Do you want to approve '${selectedRow[meta.code_col]}'?`,
                                confirmLabel: approved ? 'Revoke' : 'Approve',
                                tone: 'warning',
                              })
                              if (!ok) return
                              try {
                                await mastersApi.approveMasterRow(docId, selectedId, !approved)
                                await queryClient.invalidateQueries({ queryKey: ['master', docId] })
                                refetch()
                              } catch (err) {
                                notifications.show({ message: err?.response?.data?.detail || 'Could not update approval', color: 'red' })
                              }
                            }
                          }}
                        >
                          {o.label}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </>
            )}
          </Group>
          <Group gap={6} wrap="nowrap">
            {navBtn('First record (Ctrl+Shift+F)', <ChevronFirst size={18} />, () => goto(0), editing || index <= 0)}
            {navBtn('Previous record (Shift+Left)', <ChevronLeft size={18} />, () => goto(index - 1), editing || index <= 0)}
            {navBtn('Find (Ctrl+Shift+S)', <Search size={17} />, () => searchRef.current?.focus(), false)}
            {navBtn('Next record (Shift+Right)', <ChevronRight size={18} />, () => goto(index + 1), editing || index < 0 || index >= rows.length - 1)}
            {navBtn('Last record (Ctrl+Shift+L)', <ChevronLast size={18} />, () => goto(rows.length - 1), editing || index < 0 || index >= rows.length - 1)}
          </Group>
        </Group>
      </div>

      {selectedRow && panel === 'attach-seva' && <AttachSevaModal opened onClose={() => setPanel(null)} docId={panelDocId} sannidhiId={selectedId} sannidhiName={selectedRow[meta.name_col]} />}
      {selectedRow && hasParty && (
        <>
          <AddressesModal opened={panel === 'addresses'} onClose={() => setPanel(null)} docId={panelDocId} rowId={selectedId} party={partyInfo} />
          <ContactsModal opened={panel === 'contacts'} onClose={() => setPanel(null)} docId={panelDocId} rowId={selectedId} party={partyInfo} />
          <AlertsModal opened={panel === 'alerts'} onClose={() => setPanel(null)} docId={panelDocId} rowId={selectedId} party={partyInfo} />
          <ActivitiesModal opened={panel === 'activities'} onClose={() => setPanel(null)} docId={panelDocId} rowId={selectedId} party={partyInfo} />
        </>
      )}
      <Modal opened={copyOpen} onClose={() => setCopyOpen(false)} title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Select the {caption.replace(/ Master$/, '')} to copy</Text>} radius="lg">
        <Select
          searchable
          data-autofocus
          placeholder="Search..."
          data={allRows.map((r) => ({ value: String(r[meta.id_col]), label: `${r[meta.code_col]} - ${r[meta.name_col]}` }))}
          onChange={(v) => {
            const src = allRows.find((r) => String(r[meta.id_col]) === v)
            if (src) {
              // Copy From: take the source's details into a new record; the code and name stay blank to be entered.
              setExtra({ ...Object.fromEntries([...bodyFields.map((f) => f.FldCode), ...coreFields.map((f) => f.code)].map((c) => [c, src[c]])) })
              setForm((f) => ({ ...f, inactive: false, inactiveRmks: '' }))
            }
            setCopyOpen(false)
          }}
        />
      </Modal>

      <style>{`
        .vt-master-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--mantine-spacing-lg); align-items: start; }
        .vt-master-list { max-height: 420px; overflow-y: auto; scrollbar-width: thin; }
        .vt-master-item { display: block; width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; }
        .vt-master-item:hover:not(:disabled) { background: var(--vt-sandal); }
        .vt-master-item[data-active] { background: var(--vt-gold-chip); border-color: var(--vt-line); }
        .vt-master-item:disabled { opacity: 0.6; cursor: not-allowed; }
        @media (min-width: 992px) {
          .vt-master-layout { grid-template-columns: 340px minmax(0, 1fr); }
          .vt-master-list-card { position: sticky; top: 90px; }
          .vt-master-list { max-height: calc(100dvh - 380px); }
        }
      `}</style>
    </Stack>
  )
}
