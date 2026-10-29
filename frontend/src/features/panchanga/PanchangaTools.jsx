import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core'
import { DateInput } from '../../components/ui/AppDates'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, FileDown, FileUp, Trash2 } from 'lucide-react'
import dayjs from 'dayjs'
import * as panchangaApi from '../../api/endpoints/panchanga'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { downloadXls } from '../../utils/xls'
import { isoDate } from '../../utils/format'

const say = (e, fb) => e?.response?.data?.detail || fb
const heading = (t) => <Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{t}</Text>

/**
 * Import from Excel (legacy frmImportPanchangaData): download the template (PANCHANGADATE, PANCHANGANAME), choose the filled
 * file, Load it to check every row against the Event master, remove the wrong rows if any, then import. Nothing is
 * imported while a row is wrong. Files are Excel 97-2003 (.xls), like every import in the app.
 */
export function PanchangaImportDialog({ opened, onClose }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (opened) { setFile(null); setRows(null) }
  }, [opened])

  const errors = (rows || []).filter((r) => r.error)

  async function template() {
    try {
      const blob = await panchangaApi.importTemplate()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'Panchanga Template.xls'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { notifications.show({ message: say(e, 'Could not download the template'), color: 'red' }) }
  }
  async function load() {
    if (!file) return notifications.show({ message: 'Please select excel file path..', color: 'yellow' })
    setBusy(true)
    try {
      const r = await panchangaApi.importPreview(file)
      setRows(r.rows)
    } catch (e) {
      setRows(null)
      notifications.show({ message: say(e, 'Could not read that file'), color: 'red' })
    } finally { setBusy(false) }
  }
  async function removeWrong() {
    if (!(await confirm({ title: 'Remove erroneous records', message: 'Do you want to Remove ALL Erroneous Records ?', confirmLabel: 'Remove' }))) return
    setRows((rs) => rs.filter((r) => !r.error).map((r, i) => ({ ...r, slno: i + 1 })))
  }
  async function save() {
    setBusy(true)
    try {
      const r = await panchangaApi.importRows(rows.map((x) => ({ date: x.date, name: x.name })))
      notifications.show({ message: r.message, color: 'teal' })
      qc.invalidateQueries({ queryKey: ['panchanga'] })
      onClose()
    } catch (e) { notifications.show({ message: say(e, 'Error during import'), color: 'red' }) } finally { setBusy(false) }
  }

  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" title={heading('Import Panchanga from Excel')}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">Fill the template with one row per Panchanga detail (date and the event name exactly as in the Event master), then load it here to check it.</Text>
        <Group gap="xs" align="center" wrap="wrap">
          <Button variant="default" leftSection={<FileDown size={16} />} onClick={template}>Template</Button>
          <Button variant="light" color="kumkum" leftSection={<FileUp size={16} />} onClick={() => fileRef.current?.click()}>{file ? file.name : 'Select Excel File'}</Button>
          <input ref={fileRef} type="file" accept=".xls" hidden onChange={(e) => { setFile(e.target.files?.[0] || null); setRows(null); e.target.value = '' }} />
          <Button color="kumkum" loading={busy && !rows} disabled={!file} onClick={load}>Load from Excel</Button>
        </Group>
        {rows && (
          <>
            <Group gap="sm">
              <Text size="sm">Total Number of Records Loaded : <b>{rows.length}</b></Text>
              {errors.length > 0 && <Badge color="red" variant="light">{errors.length} with errors</Badge>}
            </Group>
            {errors.length > 0 && (
              <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
                Importing of data is not allowed until all the data is correct. Records shown in red are erroneous.
              </Alert>
            )}
            <ScrollArea h={280} type="auto">
              <Table stickyHeader withColumnBorders>
                <Table.Thead><Table.Tr><Table.Th w={60}>SLNO</Table.Th><Table.Th w={140}>Panchanga Date</Table.Th><Table.Th>Panchanga Name</Table.Th><Table.Th>Errors</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.slno} style={r.error ? { background: 'rgba(200,40,40,0.10)' } : undefined}>
                      <Table.Td>{r.slno}</Table.Td>
                      <Table.Td className="vt-num">{dayjs(r.date).isValid() && /^\d{4}-/.test(r.date) ? dayjs(r.date).format('DD/MM/YYYY') : r.date}</Table.Td>
                      <Table.Td>{r.name}</Table.Td>
                      <Table.Td c="red.8">{r.error}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <Button variant="default" color="red" leftSection={<Trash2 size={16} />} disabled={errors.length === 0} onClick={removeWrong}>Remove erroneous records</Button>
                <Button variant="default" leftSection={<Download size={16} />} onClick={() => downloadXls('Panchanga import check.xls', rows, [{ label: 'SLNO', key: 'slno' }, { label: 'Panchanga Date', key: 'date' }, { label: 'Panchanga Name', key: 'name' }, { label: 'Errors', key: 'error' }])}>Export to excel</Button>
              </Group>
              <Group gap="xs">
                <Button color="kumkum" loading={busy} disabled={errors.length > 0 || rows.length === 0} onClick={save}>Import data to database</Button>
                <Button variant="default" onClick={onClose}>Close</Button>
              </Group>
            </Group>
          </>
        )}
        {!rows && <Group justify="flex-end"><Button variant="default" onClick={onClose}>Close</Button></Group>}
      </Stack>
    </Modal>
  )
}

/** The Rathothsava date block of the Panchanga form: UtlMisc.RathDate with its on / off tick (UtlMisc.BlkBkg). */
export function RathothsavaDialog({ opened, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['panchanga-rath'], queryFn: panchangaApi.getRathothsava, enabled: opened, staleTime: 0 })
  const [day, setDay] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) { setDay(data.date ? dayjs(data.date).toDate() : null); setEnabled(Boolean(data.enabled)) }
  }, [data])
  async function save() {
    setSaving(true)
    try {
      const r = await panchangaApi.saveRathothsava({ day: day ? isoDate(day) : null, enabled })
      notifications.show({ message: r.message, color: 'teal' })
      onClose()
    } catch (e) { notifications.show({ message: say(e, 'Error during save'), color: 'red' }) } finally { setSaving(false) }
  }
  return (
    <Modal opened={opened} onClose={onClose} size="sm" radius="lg" title={heading('Rathothsava Date')}>
      {isLoading ? <Text size="sm" c="dimmed">Loading...</Text> : (
        <Stack gap="sm">
          <Checkbox color="kumkum" label="Rathothsava Date" description="Switches the Rathothsava date on for the temple." checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
          <DateInput label="Date" valueFormat="DD/MM/YYYY" value={day} onChange={setDay} />
          <Group justify="flex-end">
            <Button color="kumkum" loading={saving} onClick={save}>Update</Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
