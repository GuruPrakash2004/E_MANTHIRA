import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActionIcon, Button, Card, Group, Modal, Skeleton, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { Building2, CalendarCheck, CalendarPlus, CalendarX, Database, Download, FileDown, FilePlus, FileText, ImageUp, Save, Trash2, X } from 'lucide-react'
import * as attachmentsApi from '../../api/endpoints/attachments'
import * as companyApi from '../../api/endpoints/company'
import * as metaApi from '../../api/endpoints/meta'
import DynamicField from '../../components/DynamicField'
import { isFieldHidden, isFieldMandatory } from '../../utils/docFieldConditions'
import EmptyState from '../../components/ui/EmptyState'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import useDocShortcuts from '../../hooks/useDocShortcuts'
import { isoDate } from '../../utils/format'

const COMPANY_DOC_ID = 17 // DocID 17 = Company; MstComp is a single row (CompID 1)
const COMPANY_ROW_ID = 1
const EMPTY = {
  CompName: '', Address1: '', Address2: '', Address3: '', Address4: '', Address5: '',
  Custcode: '', EMAIL: '', MOBNO: '', PANNO: '', WEB: '', GSTNO: '', CompLoc: '', CINNO: '', TELNO: '', DashBoardLink: '',
}

const fileExt = (name) => (name.includes('.') ? name.split('.').pop().toUpperCase() : '')
const shownName = (name) => name.replace(/^\d+_/, '')

// "Company Info": captions / order / mandatory come from GET /company/layout (backend).
function InfoFields({ fields, form, set }) {
  return (
    <Stack gap="sm" maw={760}>
      {fields.map((f, i) => (
        <TextInput
          key={f.code}
          className={f.required ? 'vt-field-required' : undefined}
          label={f.caption || undefined}
          aria-label={f.caption || `Address line ${i}`}
          required={f.required}
          data-autofocus={i === 0 || undefined}
          value={form[f.code] || ''}
          onChange={(e) => set(f.code, e.currentTarget.value)}
        />
      ))}
    </Stack>
  )
}

// "Additional Fields": the live UtlDocDsgrFlds rows for the Company document, rendered by the shared dynamic-field engine.
function AdditionalFields({ docId, form, set }) {
  const { data } = useQuery({ queryKey: ['doc-fields', String(docId)], queryFn: () => metaApi.getDocFields(docId) })
  const fields = (data?.fields || []).filter((f) => !isFieldHidden(f, form))
  return (
    <Stack gap="sm" maw={760}>
      {fields.map((f) => (
        <DynamicField key={f.FldCode} docId={docId} field={f} value={form[f.FldCode]} onChange={(v) => set(f.FldCode, v)} required={isFieldMandatory(f, form)} />
      ))}
    </Stack>
  )
}

function CompanyImageTab() {
  const queryClient = useQueryClient()
  const inputRef = useRef(null)
  const { data: src, isLoading } = useQuery({
    queryKey: ['company-image'],
    queryFn: async () => {
      try {
        return URL.createObjectURL(await companyApi.getCompanyImage())
      } catch {
        return null // no picture stored: show the e-Mandira lockup instead
      }
    },
  })
  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await companyApi.setCompanyImage(file)
      notifications.show({ message: 'Image updated', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['company-image'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not update the image', color: 'red' })
    }
  }
  return (
    <Stack gap="md">
      <div style={{ borderRadius: 16, border: '1px solid var(--vt-line)', background: 'var(--vt-sandal)', minHeight: 280, display: 'grid', placeItems: 'center', padding: 16 }}>
        {isLoading ? (
          <Skeleton height={240} width="100%" radius="md" />
        ) : (
          <img src={src || '/brand/lockup-transparent.png'} alt="Company picture" style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain' }} />
        )}
      </div>
      <Group justify="flex-end">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg" hidden onChange={onPick} />
        <Button variant="light" color="kumkum" leftSection={<ImageUp size={16} />} onClick={() => inputRef.current?.click()}>
          Change Image
        </Button>
      </Group>
    </Stack>
  )
}

function DocumentsTab() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const inputRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const { data: files = [] } = useQuery({ queryKey: ['attachments', COMPANY_DOC_ID, COMPANY_ROW_ID], queryFn: () => attachmentsApi.listAttachments(COMPANY_DOC_ID, COMPANY_ROW_ID) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['attachments', COMPANY_DOC_ID, COMPANY_ROW_ID] })

  async function onAdd(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await attachmentsApi.uploadAttachment(COMPANY_DOC_ID, COMPANY_ROW_ID, file, '')
      notifications.show({ message: 'Document added', color: 'teal' })
      refresh()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Upload failed', color: 'red' })
    }
  }
  async function onRemove() {
    if (!selected) return
    if (!(await confirm({ title: 'Remove this document?', message: `${shownName(selected)} will be removed from the Company documents.`, confirmLabel: 'Remove' }))) return
    try {
      await attachmentsApi.deleteAttachment(COMPANY_DOC_ID, COMPANY_ROW_ID, selected)
      setSelected(null)
      notifications.show({ message: 'Document removed', color: 'teal' })
      refresh()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not remove', color: 'red' })
    }
  }
  function onExport() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = ['File Type,File Name,Remarks', ...files.map((f) => [fileExt(f.AFileName), shownName(f.AFileName), f.FileDesc || f.ADescription || ''].map(esc).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'company-documents.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Stack gap="md">
      <Table.ScrollContainer minWidth={520}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={110}>File Type</Table.Th>
              <Table.Th>File Name</Table.Th>
              <Table.Th>Remarks</Table.Th>
              <Table.Th w={56} aria-label="Download" />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {files.map((f) => (
              <Table.Tr key={f.AFileName} onClick={() => setSelected(f.AFileName)} style={{ cursor: 'pointer', background: selected === f.AFileName ? 'var(--vt-gold-chip)' : undefined }} aria-selected={selected === f.AFileName}>
                <Table.Td>{fileExt(f.AFileName)}</Table.Td>
                <Table.Td>
                  <Group gap={8} wrap="nowrap">
                    <FileText size={16} color="var(--vt-accent)" aria-hidden />
                    <Text size="sm" truncate>{shownName(f.AFileName)}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>{f.FileDesc || f.ADescription || ''}</Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="kumkum" size={32} aria-label={`Download ${shownName(f.AFileName)}`} onClick={(e) => { e.stopPropagation(); attachmentsApi.downloadAttachment(COMPANY_DOC_ID, COMPANY_ROW_ID, f.AFileName) }}>
                    <Download size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {files.length === 0 && <EmptyState icon={FileText} title="No documents yet" hint="Add important trust documents here so they can be shared from one place." />}
      <Group justify="flex-end" gap="xs">
        <input ref={inputRef} type="file" hidden onChange={onAdd} />
        <Button color="kumkum" leftSection={<FilePlus size={16} />} onClick={() => inputRef.current?.click()}>Add</Button>
        <Button variant="light" color="red" leftSection={<Trash2 size={16} />} disabled={!selected} onClick={onRemove}>Remove</Button>
        <Button variant="default" leftSection={<FileDown size={16} />} disabled={files.length === 0} onClick={onExport}>Export To Excel</Button>
      </Group>
      <Text size="xs" c="dimmed">Click a row to select it, or use the download icon to open the file. Important documents can be shared easily from this screen, and frequently accessed documents need not be searched every time.</Text>
    </Stack>
  )
}

function FinancialYearsTab() {
  const confirm = useConfirm()
  const { data: years = [], refetch } = useQuery({ queryKey: ['company-fy'], queryFn: companyApi.listFinancialYears })
  const [selected, setSelected] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newFrom, setNewFrom] = useState(null)
  const [newTo, setNewTo] = useState(null)
  const fy = years.find((y) => y.yrFdate === selected)
  const fmt = (d) => dayjs(d).format('DD/MM/YYYY')
  const fail = (err, fallback) => notifications.show({ message: err?.response?.data?.detail || fallback, color: 'red' })

  async function onSetActive() {
    if (!fy || fy.Active === 'Y') return
    if (!(await confirm({ title: 'Change the active financial year?', message: `${fmt(fy.yrFdate)} becomes the active financial year for the whole app.`, confirmLabel: 'Make active', tone: 'warning' }))) return
    try {
      await companyApi.setActiveFinancialYear(isoDate(fy.yrFdate))
      notifications.show({ message: 'Active financial year updated', color: 'teal' })
      refetch()
    } catch (err) { fail(err, 'Could not set active year') }
  }
  async function onRemove() {
    if (!fy) return
    if (!(await confirm({ title: 'Remove this financial year?', message: `${fmt(fy.yrFdate)} to ${fmt(fy.yrTdate)} will be removed. This cannot be undone.`, confirmLabel: 'Remove' }))) return
    try {
      await companyApi.removeFinancialYear(isoDate(fy.yrFdate))
      setSelected(null)
      notifications.show({ message: 'Financial year removed', color: 'teal' })
      refetch()
    } catch (err) { fail(err, 'Could not remove the financial year') }
  }
  async function onCreate() {
    if (!newFrom || !newTo) return
    if (dayjs(newTo).isBefore(dayjs(newFrom))) return notifications.show({ message: 'The end date must be after the start date', color: 'red' })
    try {
      await companyApi.addFinancialYear(isoDate(newFrom), isoDate(newTo))
      notifications.show({ message: 'Financial year added', color: 'teal' })
      setCreateOpen(false)
      setNewFrom(null)
      setNewTo(null)
      refetch()
    } catch (err) { fail(err, 'Could not add financial year') }
  }

  return (
    <Stack gap="md">
      <Table.ScrollContainer minWidth={420}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>From date</Table.Th><Table.Th>To date</Table.Th><Table.Th>Active</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {years.map((y) => (
              <Table.Tr key={y.yrFdate} onClick={() => setSelected(y.yrFdate)} style={{ cursor: 'pointer', background: selected === y.yrFdate ? 'var(--vt-gold-chip)' : undefined }} aria-selected={selected === y.yrFdate}>
                <Table.Td className="vt-num">{fmt(y.yrFdate)}</Table.Td>
                <Table.Td className="vt-num">{fmt(y.yrTdate)}</Table.Td>
                <Table.Td fw={y.Active === 'Y' ? 700 : 400}>{y.Active === 'Y' ? 'Y' : 'N'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {years.length === 0 && <EmptyState icon={CalendarCheck} title="No financial years yet" hint="Use Create Financial Year to add one." />}
      <Group justify="flex-end" gap="xs" wrap="wrap">
        <Button variant="light" color="kumkum" leftSection={<CalendarCheck size={16} />} disabled={!fy || fy.Active === 'Y'} onClick={onSetActive}>Set Active Financial Year</Button>
        <Tooltip label="Stock carry forward is not available in the web app yet"><Button variant="default" leftSection={<Database size={16} />} disabled data-disabled>Stock Carry Forward</Button></Tooltip>
        <Button color="kumkum" leftSection={<CalendarPlus size={16} />} onClick={() => setCreateOpen(true)}>Create Financial Year</Button>
        <Button variant="light" color="red" leftSection={<CalendarX size={16} />} disabled={!fy || fy.Active === 'Y'} onClick={onRemove}>Remove Financial Year</Button>
      </Group>
      <Text size="xs" c="dimmed">The active year filters every list and document number in the app. The active year cannot be removed.</Text>

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Create Financial Year</Text>} radius="lg">
        <Stack>
          <DateInput data-autofocus label="From date" valueFormat="DD/MM/YYYY" value={newFrom} onChange={setNewFrom} />
          <DateInput label="To date" valueFormat="DD/MM/YYYY" value={newTo} onChange={setNewTo} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button color="kumkum" disabled={!newFrom || !newTo} onClick={onCreate}>Create</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}

export default function CompanyMasterPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState('info')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['company'], queryFn: companyApi.getCompany })
  const { data: layout } = useQuery({ queryKey: ['company-layout'], queryFn: companyApi.getCompanyLayout })

  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data })
  }, [data])
  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  async function onSave() {
    if (!String(form.CompName || '').trim()) return notifications.show({ message: 'Company name should not be blank!', color: 'red' })
    setSaving(true)
    try {
      await companyApi.updateCompany(form)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }
  const onClose = () => navigate('/')
  useDocShortcuts({ onSave, onClose, onCancel: onClose })

  const editable = tab === 'info' || tab === 'additional'

  return (
    <Stack gap="lg" className="vt-rise" pb={72}>
      <Group gap="sm" wrap="nowrap">
        <div aria-hidden style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg, var(--vt-g1), var(--vt-g2d))', color: '#F4E1A6', boxShadow: '0 4px 12px rgba(122,31,31,0.25)' }}>
          <Building2 size={24} />
        </div>
        <div>
          <Title order={2}>Company Master</Title>
          <Text size="sm" c="dimmed">{form.CompName || 'Trust details printed on receipts and reports'}</Text>
        </div>
      </Group>

      <Card withBorder p="lg">
        <Tabs value={tab} onChange={setTab} color="kumkum" keepMounted={false}>
          <Tabs.List mb="lg" style={{ flexWrap: 'wrap' }}>
            <Tabs.Tab value="info">Company Info</Tabs.Tab>
            <Tabs.Tab value="additional">Additional Fields</Tabs.Tab>
            <Tabs.Tab value="fy">Financial Year(s)</Tabs.Tab>
            <Tabs.Tab value="images">Images</Tabs.Tab>
            <Tabs.Tab value="documents">Documents</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="info">
            {isLoading || !layout ? <Skeleton height={260} radius="md" /> : <InfoFields fields={layout.info_fields} form={form} set={set} />}
          </Tabs.Panel>
          <Tabs.Panel value="additional">
            {isLoading || !layout ? <Skeleton height={260} radius="md" /> : <AdditionalFields docId={layout.doc_id} form={form} set={set} />}
          </Tabs.Panel>
          <Tabs.Panel value="fy"><FinancialYearsTab /></Tabs.Panel>
          <Tabs.Panel value="images"><CompanyImageTab /></Tabs.Panel>
          <Tabs.Panel value="documents"><DocumentsTab /></Tabs.Panel>
        </Tabs>
      </Card>

      {/* Action bar, pinned to the bottom like the legacy form's footer: Backup / Companies on the left, Save / Close on the right. */}
      <div style={{ position: 'sticky', bottom: 12, zIndex: 5 }}>
        <Group justify="space-between" p="sm" style={{ borderRadius: 16, border: '1px solid var(--vt-line)', background: 'var(--vt-surface)', boxShadow: '0 6px 20px rgba(43,9,9,0.12)' }}>
          <Group gap="xs">
            <Tooltip label="Database backup is not available in the web app yet"><Button variant="default" disabled data-disabled>Backup</Button></Tooltip>
            <Tooltip label="Switching between companies is not available in the web app yet"><Button variant="default" disabled data-disabled>Companies...</Button></Tooltip>
          </Group>
          <Group gap="xs">
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} disabled={!editable} onClick={onSave}>Save</Button>
            <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>Close</Button>
          </Group>
        </Group>
      </div>
    </Stack>
  )
}
