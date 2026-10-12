import { useConfirm } from '../../components/ui/ConfirmProvider'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Kbd,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  BookOpen,
  Building,
  CalendarDays,
  Database,
  Download,
  FileText,
  FileUp,
  Flame,
  Landmark,
  Layers,
  Orbit,
  Plus,
  Search,
  SquarePen,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as attachmentsApi from '../../api/endpoints/attachments'
import * as mastersApi from '../../api/endpoints/masters'
import * as metaApi from '../../api/endpoints/meta'
import DynamicField from '../../components/DynamicField'
import EmptyState from '../../components/ui/EmptyState'
import StatCard from '../../components/ui/StatCard'
import { isFieldHidden, isFieldMandatory } from '../../utils/docFieldConditions'
import { formatINR } from '../../utils/format'
import { oleColorToCss } from '../../utils/color'
import useDocShortcuts from '../../hooks/useDocShortcuts'

const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const RASHI_DOC_ID = 1279

// One icon per master document (display only).
const MASTER_ICON = { 1255: Landmark, 1265: Flame, 1257: Users, 1258: Star, 1279: Orbit, 1282: Building, 1266: CalendarDays, 1204: BookOpen, 1205: Layers, 1223: Banknote }

// Extra list columns, only where the column is already proven by existing screens (Seva rate from MstSVA.AMT,
// Nakshatra's linked Rashi, Event colour). Any other master shows Code / Name / Status only.
const EXTRA_COLUMNS = {
  1265: [{ key: 'AMT', label: 'Amount', type: 'money' }],
  1258: [{ key: 'RASHIID1', label: 'Rashi', type: 'rashi' }],
  1266: [{ key: 'CLRCODE', label: 'Colour', type: 'colour' }],
}

const EMPTY_FORM = { code: '', name: '', inactive: false, inactiveRmks: '' }
const isInactive = (row) => (row.InActive || 'N').toUpperCase() === 'Y'

/** File attachments panel (UtlAttachFiles), only shown for masters with FileAttachReq='Y', on an existing row. */
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

  const confirm = useConfirm()
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
          Attachments
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

function StatusBadge({ row }) {
  return isInactive(row) ? (
    <Badge color="gray" variant="light">
      Inactive
    </Badge>
  ) : (
    <Badge color="gold" variant="light" c="var(--vt-badge-ink)">
      Active
    </Badge>
  )
}

export default function MasterPage() {
  const { docId } = useParams()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'code', dir: 'asc' })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [extra, setExtra] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['master', docId, search],
    queryFn: () => mastersApi.listMaster(docId, search ? { search } : undefined),
  })
  const { data: fieldsData } = useQuery({
    queryKey: ['doc-fields', docId],
    queryFn: () => metaApi.getDocFields(docId),
  })
  const extraCols = EXTRA_COLUMNS[Number(docId)] || []
  const needsRashi = extraCols.some((c) => c.type === 'rashi')
  const { data: rashiData } = useQuery({ queryKey: ['master', String(RASHI_DOC_ID), ''], queryFn: () => mastersApi.listMaster(RASHI_DOC_ID), enabled: needsRashi })
  const rashiName = (id) => {
    const m = rashiData?.meta
    return m ? rashiData.rows.find((r) => r[m.id_col] === Number(id))?.[m.name_col] || '' : ''
  }

  useEffect(() => {
    setSearch('')
    setStatusFilter('all')
    setSort({ key: 'code', dir: 'asc' })
  }, [docId])

  const meta = data?.meta
  // The legacy list includes the ID-0 "none" placeholder row; it is not a real record, so it is not shown here.
  const allRows = useMemo(() => (data?.rows || []).filter((r) => !meta || r[meta.id_col] !== 0), [data, meta])
  const counts = useMemo(() => ({ total: allRows.length, active: allRows.filter((r) => !isInactive(r)).length, inactive: allRows.filter(isInactive).length }), [allRows])
  const rows = useMemo(() => {
    if (!meta) return []
    const filtered = allRows.filter((r) => (statusFilter === 'all' ? true : statusFilter === 'active' ? !isInactive(r) : isInactive(r)))
    const col = sort.key === 'name' ? meta.name_col : meta.code_col
    const sorted = [...filtered].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? ''), undefined, { numeric: true, sensitivity: 'base' }))
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [allRows, meta, statusFilter, sort])

  // Live values keyed by legacy FldCode, for evaluating conditional hide/mandatory rules exactly like the dynamic
  // transaction-screen engine (useDocFields + docFieldConditions); `extra` is already keyed by FldCode.
  const codeValues = { [meta?.code_col]: form.code, [meta?.name_col]: form.name, ...extra }
  const extraFields = (fieldsData?.fields || []).filter((f) => f.FldCode !== meta?.code_col && f.FldCode !== meta?.name_col && !isFieldHidden(f, codeValues))

  function setExtraField(code, value) {
    setExtra((e) => ({ ...e, [code]: value }))
  }
  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setExtra({})
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(row) {
    setEditingId(row[meta.id_col])
    setForm({
      code: row[meta.code_col] || '',
      name: row[meta.name_col] || '',
      inactive: isInactive(row),
      inactiveRmks: row.InActiveRmks || '',
    })
    setExtra(Object.fromEntries(extraFields.map((f) => [f.FldCode, row[f.FldCode]])))
    setFormError('')
    setModalOpen(true)
  }

  async function onSave() {
    if (!meta) return
    setSaving(true)
    setFormError('')
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
      const detail = err?.response?.data?.detail
      const status = err?.response?.status
      // Validation problems (blank code/name, duplicate code, missing remarks) are shown inside the dialog next to the form.
      if (detail && [409, 422].includes(status)) setFormError(detail)
      else notifications.show({ message: detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const confirm = useConfirm()
  async function onDelete(row) {
    if (!meta) return
    if (!(await confirm({ title: 'Delete this record?', message: `${row[meta.name_col]} will be deleted. This cannot be undone.`, confirmLabel: 'Delete' }))) return
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

  const Icon = MASTER_ICON[Number(docId)] || Database
  const caption = meta?.caption || 'Master'
  const filtering = Boolean(search) || statusFilter !== 'all'

  function extraCell(row, c) {
    const v = row[c.key]
    if (c.type === 'money') return <span className="vt-num">{v != null ? formatINR(v) : ''}</span>
    if (c.type === 'rashi') return rashiName(v) || <Text span c="dimmed">-</Text>
    if (c.type === 'colour') {
      const css = oleColorToCss(v)
      return css ? (
        <span role="img" aria-label={`Colour ${css}`} title={css} style={{ width: 28, height: 18, borderRadius: 6, background: css, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)', display: 'inline-block', verticalAlign: 'middle' }} />
      ) : (
        <Text span c="dimmed">
          -
        </Text>
      )
    }
    return v
  }

  const sortHead = (id, children) => {
    const active = sort.key === id
    return (
      <Table.Th key={id} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <UnstyledButton onClick={() => toggleSort(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'inherit', fontWeight: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', color: 'inherit' }}>
          {children}
          {active ? sort.dir === 'asc' ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden /> : <ArrowUpDown size={13} aria-hidden style={{ opacity: 0.45 }} />}
        </UnstyledButton>
      </Table.Th>
    )
  }

  const actions = (row) => (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      <ActionIcon variant="subtle" color="kumkum" size={36} aria-label={`Edit ${row[meta.name_col]}`} onClick={() => openEdit(row)}>
        <SquarePen size={17} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="red" size={36} aria-label={`Delete ${row[meta.name_col]}`} onClick={() => onDelete(row)}>
        <Trash2 size={17} />
      </ActionIcon>
    </Group>
  )

  return (
    <Stack gap="lg" className="vt-rise">
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        <Group gap="sm" wrap="nowrap">
          <div aria-hidden style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg, var(--vt-g1), var(--vt-g2d))', color: '#F4E1A6', boxShadow: '0 4px 12px rgba(122,31,31,0.25)' }}>
            <Icon size={24} />
          </div>
          <div>
            <Title order={2}>{caption}</Title>
            <Text size="sm" c="dimmed">
              {isLoading ? 'Loading records' : `${counts.total} record${counts.total === 1 ? '' : 's'}`}
            </Text>
          </div>
        </Group>
        <Group gap="sm">
          <Group gap={6} visibleFrom="sm" c="dimmed">
            <Kbd size="xs">Alt+N</Kbd>
          </Group>
          <Button leftSection={<Plus size={16} />} color="kumkum" onClick={openAdd} disabled={!meta}>
            Add new
          </Button>
        </Group>
      </Group>

      <Group gap="xs" hiddenFrom="sm" aria-label="Summary">
        <Badge size="lg" variant="light" color="gray" tt="none">
          {counts.total} total
        </Badge>
        <Badge size="lg" variant="light" color="gold" c="var(--vt-badge-ink)" tt="none">
          {counts.active} active
        </Badge>
        <Badge size="lg" variant="light" color="gray" tt="none">
          {counts.inactive} inactive
        </Badge>
      </Group>
      <SimpleGrid cols={3} visibleFrom="sm">
        <StatCard label="Total records" value={counts.total} icon={Database} loading={isLoading} />
        <StatCard label="Active" value={counts.active} icon={Icon} tone="dark" loading={isLoading} />
        <StatCard label="Inactive" value={counts.inactive} icon={X} loading={isLoading} />
      </SimpleGrid>

      <Card withBorder p="lg">
        <Group justify="space-between" mb="md" gap="sm" wrap="wrap">
          <TextInput
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
            style={{ flex: '1 1 260px', maxWidth: 380 }}
          />
          <SegmentedControl
            aria-label="Status filter"
            color="kumkum"
            value={statusFilter}
            onChange={setStatusFilter}
            data={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </Group>

        {isLoading ? (
          <Stack gap="xs">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={44} radius="md" />
            ))}
          </Stack>
        ) : rows.length === 0 ? (
          filtering ? (
            <EmptyState
              icon={Search}
              title="No matching records"
              hint="Try a different word, or clear the search and filter."
              action={
                <Button
                  variant="default"
                  size="xs"
                  mt="xs"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('all')
                  }}
                >
                  Clear search and filter
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Icon}
              title={`No ${caption.toLowerCase()} records yet`}
              hint="Add the first one to start using it across the app."
              action={
                <Button size="xs" color="kumkum" mt="xs" leftSection={<Plus size={14} />} onClick={openAdd}>
                  Add the first record
                </Button>
              }
            />
          )
        ) : (
          <>
            <Box visibleFrom="sm">
              <Table.ScrollContainer minWidth={520}>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      {sortHead('code', 'Code')}
                      {sortHead('name', 'Name')}
                      {extraCols.map((c) => (
                        <Table.Th key={c.key} ta={c.type === 'money' ? 'right' : undefined}>
                          {c.label}
                        </Table.Th>
                      ))}
                      <Table.Th>Status</Table.Th>
                      <Table.Th w={96} aria-label="Actions" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((row) => (
                      <Table.Tr key={row[meta.id_col]}>
                        <Table.Td className="vt-num" c="dimmed">
                          {row[meta.code_col]}
                        </Table.Td>
                        <Table.Td>
                          <UnstyledButton onClick={() => openEdit(row)} style={{ fontWeight: 600, textAlign: 'left' }} aria-label={`Edit ${row[meta.name_col]}`}>
                            {row[meta.name_col]}
                          </UnstyledButton>
                        </Table.Td>
                        {extraCols.map((c) => (
                          <Table.Td key={c.key} ta={c.type === 'money' ? 'right' : undefined}>
                            {extraCell(row, c)}
                          </Table.Td>
                        ))}
                        <Table.Td>
                          <StatusBadge row={row} />
                        </Table.Td>
                        <Table.Td>{actions(row)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Box>

            {/* phones: one card per record */}
            <Stack gap="xs" hiddenFrom="sm">
              {rows.map((row) => (
                <Group key={row[meta.id_col]} justify="space-between" wrap="nowrap" p="sm" style={{ border: '1px solid var(--vt-line)', borderRadius: 12, background: 'var(--vt-surface)' }}>
                  <UnstyledButton onClick={() => openEdit(row)} style={{ minWidth: 0, flex: 1, textAlign: 'left' }} aria-label={`Edit ${row[meta.name_col]}`}>
                    <Text fw={600} truncate>
                      {row[meta.name_col]}
                    </Text>
                    <Group gap={8} mt={2}>
                      <Text size="xs" c="dimmed" className="vt-num">
                        {row[meta.code_col]}
                      </Text>
                      <StatusBadge row={row} />
                      {extraCols.map((c) => (
                        <Text key={c.key} size="xs" component="span">
                          {extraCell(row, c)}
                        </Text>
                      ))}
                    </Group>
                  </UnstyledButton>
                  {actions(row)}
                </Group>
              ))}
            </Stack>

            {filtering && (
              <Text size="xs" c="dimmed" mt="sm">
                Showing {rows.length} of {counts.total}
              </Text>
            )}
          </>
        )}
      </Card>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        size="lg"
        radius="lg"
        title={
          <Group gap="sm" wrap="nowrap">
            <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 28, width: 28 }} />
            <Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              {editingId ? `Edit ${meta?.caption}` : `Add ${meta?.caption}`}
            </Text>
          </Group>
        }
      >
        <Stack>
          {formError && (
            <Alert color="red" variant="light" role="alert">
              {formError}
            </Alert>
          )}
          <Grid>
            <Grid.Col span={{ base: 12, sm: 5 }}>
              <TextInput data-autofocus label={`${meta?.short_form || ''} Code`} required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.currentTarget.value }))} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 7 }}>
              <TextInput label={`${meta?.short_form || ''} Name`} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.currentTarget.value }))} />
            </Grid.Col>
            {extraFields.map((f) => (
              <Grid.Col span={{ base: 12, sm: 6 }} key={f.FldCode}>
                <DynamicField docId={docId} field={f} value={extra[f.FldCode]} onChange={(v) => setExtraField(f.FldCode, v)} required={isFieldMandatory(f, codeValues)} />
              </Grid.Col>
            ))}
          </Grid>
          <Switch
            color="kumkum"
            label="Inactive"
            description="Inactive records stay in the list but are not offered in dropdowns."
            checked={form.inactive}
            onChange={(e) => setForm((f) => ({ ...f, inactive: e.currentTarget.checked }))}
          />
          {form.inactive && (
            <Textarea label="Inactive Remarks" required autosize minRows={2} value={form.inactiveRmks} onChange={(e) => setForm((f) => ({ ...f, inactiveRmks: e.currentTarget.value }))} />
          )}
          {editingId && meta?.file_attach_req && <AttachmentsSection docId={docId} rowId={editingId} />}
          <Group justify="space-between" mt="sm">
            <Group gap={6} c="dimmed">
              <Kbd size="xs">Alt+S</Kbd>
              <Text size="xs">to save</Text>
            </Group>
            <Group>
              <Button variant="default" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button color="kumkum" loading={saving} onClick={onSave}>
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
