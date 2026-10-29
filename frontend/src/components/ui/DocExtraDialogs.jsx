import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Button, Checkbox, Group, Modal, NumberInput, Radio, ScrollArea, Select, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { Download, FileUp, Paperclip, Save, Trash2, X } from 'lucide-react'
import { DateInput } from './AppDates'
import EmptyState from './EmptyState'
import { useConfirm } from './ConfirmProvider'
import { isoDate } from '../../utils/format'
import * as attachmentsApi from '../../api/endpoints/attachments'
import * as docActions from '../../api/endpoints/docActions'

const fail = (err, fb) => notifications.show({ message: err?.response?.data?.detail || fb, color: 'red' })
const heading = (t) => (
  <Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
    {t}
  </Text>
)

/**
 * Attachment (legacy tsbAttachment / frmUtlFileControl): files kept with a saved document in UtlAttachFiles
 * (DocID + record id), the same store the masters' file panel uses. Offered when UtlTransactions.FileAttachReq = 'Y'.
 */
export function AttachmentsDialog({ docId, recordId, onClose }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const key = ['attachments', docId, recordId]
  const { data: files, isLoading } = useQuery({ queryKey: key, queryFn: () => attachmentsApi.listAttachments(docId, recordId) })
  const shown = (n) => String(n || '').replace(/^\d+_/, '')

  async function onUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      await attachmentsApi.uploadAttachment(docId, recordId, file, desc)
      notifications.show({ message: 'File attached', color: 'teal' })
      setDesc('')
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      fail(err, 'Upload failed')
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }
  async function onDelete(f) {
    if (!(await confirm({ title: 'Remove this attachment?', message: `${shown(f.AFileName)} will be removed from this document.`, confirmLabel: 'Remove' }))) return
    try {
      await attachmentsApi.deleteAttachment(docId, recordId, f.AFileName)
      qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      fail(err, 'Could not remove the file')
    }
  }

  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" title={heading('Attachment')}>
      <Stack gap="sm">
        {isLoading ? (
          <Skeleton height={100} radius="md" />
        ) : (files || []).length === 0 ? (
          <EmptyState icon={Paperclip} title="No files attached" hint="Add a file to keep it with this document." />
        ) : (
          <Table.ScrollContainer minWidth={420} mah={280}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>File</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th>Added</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {files.map((f) => (
                  <Table.Tr key={f.AFileName}>
                    <Table.Td>{shown(f.AFileName)}</Table.Td>
                    <Table.Td>{f.FileDesc}</Table.Td>
                    <Table.Td className="vt-num">
                      {f.AddedOn ? dayjs(f.AddedOn).format('DD-MMM-YYYY') : ''} {f.AddedBy}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="kumkum"
                          aria-label={`Download ${shown(f.AFileName)}`}
                          onClick={() => attachmentsApi.downloadAttachment(docId, recordId, f.AFileName).catch((err) => fail(err, 'Could not download the file'))}
                        >
                          <Download size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" aria-label={`Remove ${shown(f.AFileName)}`} onClick={() => onDelete(f)}>
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Group align="flex-end" wrap="nowrap">
          <TextInput style={{ flex: 1 }} label="Description" maxLength={100} value={desc} onChange={(e) => setDesc(e.currentTarget.value)} />
          <Button component="label" color="kumkum" leftSection={<FileUp size={16} />} loading={busy}>
            Add file
            <input type="file" hidden onChange={onUpload} />
          </Button>
        </Group>
        <Group justify="flex-end">
          <Button variant="default" leftSection={<X size={16} />} onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/**
 * Amendment (legacy tsbAmmend: Amendment tick, Amm No, Amm Date). Offered only when the document's switch is on and its
 * header table has the Ammendment / AmmNo / AmmDate columns, so it stays out of the way on a database without them.
 */
export function AmendmentDialog({ docId, recordId, onClose }) {
  const qc = useQueryClient()
  const [on, setOn] = useState(false)
  const [date, setDate] = useState(new Date())
  const [saving, setSaving] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['amendment', docId, recordId], queryFn: () => docActions.getAmendment(docId, recordId) })
  useEffect(() => {
    if (!data?.available) return
    setOn(data.amendment)
    setDate(data.amm_date ? new Date(data.amm_date) : new Date())
  }, [data])

  async function save() {
    setSaving(true)
    try {
      const r = await docActions.setAmendment(docId, recordId, { amendment: on, amm_date: on ? isoDate(date) : null })
      notifications.show({ message: r.message, color: 'teal' })
      qc.invalidateQueries({ queryKey: ['amendment', docId, recordId] })
      onClose()
    } catch (err) {
      fail(err, 'Could not save the amendment')
    } finally {
      setSaving(false)
    }
  }

  // ticking a record that is not yet amended numbers it one higher (the server does the same)
  const shownNo = !on ? 0 : data?.amendment ? data.amm_no : (data?.amm_no || 0) + 1

  return (
    <Modal opened onClose={onClose} size="sm" radius="lg" title={heading('Amendment')}>
      {isLoading ? (
        <Skeleton height={100} radius="md" />
      ) : !data?.available ? (
        <Text size="sm" c="dimmed">
          Amendment is not available for this document.
        </Text>
      ) : (
        <Stack gap="sm">
          <Checkbox color="kumkum" label="Amendment" checked={on} onChange={(e) => setOn(e.currentTarget.checked)} />
          <NumberInput label="Amm No" readOnly className="vt-fld-readonly" hideControls value={shownNo} />
          <DateInput label="Amm Date" valueFormat="DD-MMM-YYYY" value={date} onChange={(v) => v && setDate(v)} disabled={!on} />
          <Group justify="flex-end">
            <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={save}>
              Save
            </Button>
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------------------------------------------ Label Printing
const sayErr = (e, fb) => e?.response?.data?.detail || fb

/**
 * Legacy frmRptLblPrint: pick a label template of the document, load the labels (this record, or the latest records) and
 * print them. "Design" opens the template editor (frmUtlLabelDesign): up to 20 lines of text with {COLUMN} placeholders.
 */
export function LabelPrintDialog({ docId, recordId, onClose }) {
  const confirm = useConfirm()
  const { data: templates = [], refetch } = useQuery({ queryKey: ['label-templates', docId], queryFn: () => docActions.labelTemplates(docId), staleTime: 0 })
  const { data: columns = [] } = useQuery({ queryKey: ['label-columns', docId], queryFn: () => docActions.labelColumns(docId), staleTime: 60_000 })
  const [tid, setTid] = useState(null)
  const [scope, setScope] = useState(recordId ? 'this' : 'recent')
  const [top, setTop] = useState(50)
  const [copies, setCopies] = useState(1)
  const [labels, setLabels] = useState([])
  const [design, setDesign] = useState(null) // { id|null, name, lines[] }
  const [busy, setBusy] = useState(false)
  const lineRef = useRef(null)

  async function load() {
    if (!tid) return notifications.show({ message: 'Template Not found in the list!!', color: 'yellow' })
    if (!copies || copies < 1) return notifications.show({ message: 'Please enter the number of copies.', color: 'yellow' })
    setBusy(true)
    try {
      const r = await docActions.runLabels(docId, { template_id: Number(tid), record_ids: scope === 'this' && recordId ? [recordId] : null, top: Number(top) || 50 })
      setLabels(r.labels)
      if (!r.labels.length) notifications.show({ message: 'No data...', color: 'yellow' })
    } catch (e) { notifications.show({ message: sayErr(e, 'Could not load the labels'), color: 'red' }) } finally { setBusy(false) }
  }
  function print() {
    const w = window.open('', '_blank')
    if (!w) return notifications.show({ message: 'The browser blocked the print window. Allow pop-ups for this site and try again.', color: 'red' })
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const cells = labels.flatMap((l) => Array.from({ length: copies }, () => `<div class="l">${esc(l).replace(/\n/g, '<br>')}</div>`)).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>@page{margin:8mm}body{font-family:Arial,sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.l{border:1px dashed #999;padding:3mm;min-height:22mm;font-size:11pt;page-break-inside:avoid}</style></head><body><div class="g">${cells}</div></body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 250)
  }
  async function saveDesign() {
    setBusy(true)
    try {
      const body = { name: design.name, lines: design.lines }
      const r = design.id === null ? await docActions.addLabelTemplate(docId, body) : await docActions.updateLabelTemplate(docId, design.id, body)
      notifications.show({ message: r.message, color: 'teal' })
      await refetch()
      setTid(String(r.id))
      setDesign(null)
    } catch (e) { notifications.show({ message: sayErr(e, 'Error during save'), color: 'red' }) } finally { setBusy(false) }
  }
  async function removeTemplate() {
    const t = templates.find((x) => String(x.id) === tid)
    if (!t) return
    if (!(await confirm({ title: 'Delete template', message: `Delete the label template ${t.name}?`, confirmLabel: 'Delete' }))) return
    try {
      const r = await docActions.deleteLabelTemplate(docId, t.id)
      notifications.show({ message: r.message, color: 'teal' })
      setTid(null)
      setLabels([])
      refetch()
    } catch (e) { notifications.show({ message: sayErr(e, 'Error during delete'), color: 'red' }) }
  }
  const insertColumn = (c) => setDesign((d) => {
    const i = lineRef.current ?? d.lines.findIndex((l) => !l)
    const at = i < 0 ? 0 : i
    return { ...d, lines: d.lines.map((l, li) => (li === at ? `${l}{${c}}` : l)) }
  })

  return (
    <Modal opened onClose={onClose} size="xl" radius="lg" title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Label Printing</Text>}>
      {design ? (
        <Stack gap="sm">
          <TextInput className="vt-field-required" label="Template Name" required value={design.name} onChange={(e) => setDesign({ ...design, name: e.currentTarget.value })} />
          <Text size="xs" c="dimmed">One label is printed per record. Click a column to add it as {'{COLUMN}'} to the line you are typing in.</Text>
          <Group gap={4} wrap="wrap">
            {columns.map((c) => <Button key={c} size="compact-xs" variant="light" color="kumkum" onClick={() => insertColumn(c)}>{c}</Button>)}
          </Group>
          <Stack gap={4}>
            {design.lines.map((l, i) => (
              <TextInput key={i} size="xs" aria-label={`Label line ${i + 1}`} leftSection={<Text size="10px" c="dimmed">{i + 1}</Text>} maxLength={250} value={l} onFocus={() => { lineRef.current = i }} onChange={(e) => { const v = e.currentTarget.value; setDesign((d) => ({ ...d, lines: d.lines.map((x, xi) => (xi === i ? v : x)) })) }} />
            ))}
          </Stack>
          <Group justify="flex-end">
            <Button color="kumkum" loading={busy} onClick={saveDesign}>Save</Button>
            <Button variant="default" onClick={() => setDesign(null)}>Cancel</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Group align="flex-end" gap="xs" wrap="wrap">
            <Select label="Template" searchable placeholder="Select a template" data={templates.map((t) => ({ value: String(t.id), label: t.name }))} value={tid} onChange={(v) => { setTid(v); setLabels([]) }} style={{ flex: 1, minWidth: 200 }} />
            <Button variant="light" color="kumkum" onClick={() => setDesign({ id: null, name: '', lines: Array(20).fill('') })}>New template</Button>
            <Button variant="light" color="kumkum" disabled={!tid} onClick={() => { const t = templates.find((x) => String(x.id) === tid); setDesign({ id: t.id, name: t.name, lines: [...t.lines, ...Array(20 - t.lines.length).fill('')] }) }}>Design</Button>
            <Button variant="default" color="red" disabled={!tid} onClick={removeTemplate}>Delete</Button>
          </Group>
          <Group align="flex-end" gap="md" wrap="wrap">
            <Radio.Group label="Labels for" value={scope} onChange={setScope}>
              <Group mt={4}>
                {recordId ? <Radio color="kumkum" value="this" label="This record" /> : null}
                <Radio color="kumkum" value="recent" label="Latest records" />
              </Group>
            </Radio.Group>
            {scope === 'recent' && <NumberInput label="How many" min={1} max={5000} hideControls w={100} value={top} onChange={setTop} />}
            <NumberInput label="No of copies" min={1} hideControls w={100} value={copies} onChange={(v) => setCopies(Number(v) || 0)} />
            <Button color="kumkum" loading={busy} onClick={load}>Load</Button>
          </Group>
          <ScrollArea h={260} type="auto">
            {labels.length === 0 ? <Text size="sm" c="dimmed" p="sm">{templates.length === 0 ? 'No label template yet. Press New template to design one.' : 'Pick a template and press Load to see the labels.'}</Text> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {labels.map((l, i) => <div key={i} style={{ border: '1px dashed var(--vt-line)', borderRadius: 8, padding: 8, whiteSpace: 'pre-line', fontSize: 13 }}>{l}</div>)}
              </div>
            )}
          </ScrollArea>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{labels.length ? `${labels.length} label${labels.length === 1 ? '' : 's'} x ${copies} copies` : ''}</Text>
            <Group>
              <Button color="kumkum" disabled={!labels.length} onClick={print}>Print</Button>
              <Button variant="default" onClick={onClose}>Close</Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
