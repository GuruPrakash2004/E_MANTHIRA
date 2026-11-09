import { useMemo, useState } from 'react'
import { ActionIcon, Button, Checkbox, Group, Modal, MultiSelect, NumberInput, Paper, Radio, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import * as printOptionsApi from '../../api/endpoints/printOptions'

// Legacy "Print Option Name" window (FrmUtlPrintOptionname): After Save = P / PP / DNP.
const AFTER_SAVE = [
  { value: 'P', label: 'Print With Prompt' },
  { value: 'PP', label: 'Print Without Prompt' },
  { value: 'DNP', label: 'Do Not Print' },
]
// Print Click / Ctrl + Click / Ctrl+Alt+Click: the letters UtlOption stores.
const CLICK_OPS = [
  { value: 'E', label: 'Email' },
  { value: 'P', label: 'Preview' },
  { value: 'D', label: 'Direct Print' },
  { value: 'M', label: 'Multi Print' },
  { value: 'F', label: 'PDF' },
]
const yes = (v) => String(v || '').trim().toUpperCase() === 'Y'
const t = (v) => String(v ?? '').trim()

// FormulasFld "a;b" + FormulasVal "Tbl.Col;Tbl2.Col2"  <->  grid rows {field, table, value} (legacy splits at the first dot)
function parseFormulaRows(fld, val) {
  const fs = t(fld) ? t(fld).split(';') : []
  const vs = t(val) ? t(val).split(';') : []
  return fs.map((field, i) => {
    const v = vs[i] || ''
    const dot = v.indexOf('.')
    return dot > 0 ? { field, table: v.slice(0, dot), value: v.slice(dot + 1) } : { field, table: v, value: v }
  })
}
function joinFormulaRows(rows) {
  const used = rows.filter((r) => t(r.field))
  const q = (s) => String(s ?? '').replaceAll("'", '`')
  return { formulas_fld: used.map((r) => q(r.field)).join(';'), formulas_val: used.map((r) => `${q(r.table)}.${q(r.value)}`).join(';') }
}

const fromRow = (row) => ({
  option_name: row?.OptionName || '',
  crpt_file_name: t(row?.CrptFileName),
  direct_printer_name: t(row?.DirectPrinterName),
  after_save_action: t(row?.AfterSaveAction) || 'DNP',
  no_of_copies: Number(row?.NoOfCopies) || 1,
  default_print: yes(row?.DefaultPrint),
  in_active: yes(row?.InActive),
  option_order: row?.OptionOrder ?? '',
  sel_formula: t(row?.SelFormula),
  rows: parseFormulaRows(row?.FormulasFld, row?.FormulasVal),
  click_operation: t(row?.ClickOperation).toUpperCase() || 'P',
  ctrl_click_operation: t(row?.CtrlClickOperation).toUpperCase(),
  ctrl_alt_click_operation: t(row?.CtrlAltClickOperation).toUpperCase(),
  wo_auth: yes(row?.blnWOAuth),
  merge_pdf: yes(row?.MergePDF),
  email_multi_rpt_ids: t(row?.emailMultiRptIDS) ? t(row?.emailMultiRptIDS).split(',').map((x) => x.trim()).filter(Boolean) : [],
  folder_loc: t(row?.FolderLoc),
  fld_sel: t(row?.FldSel),
  email_routing: t(row?.EmailRouting).toUpperCase() === 'O' ? 'O' : 'S',
  do_not_attach: yes(row?.DoNotAttach),
  email_subject: row?.EmailSubject || '',
  email_body: row?.EmailBody || '',
  email_footer: row?.EmailFooter || '',
  email_cond: row?.EmailCond || '',
  allow_date_range: yes(row?.AllowDateRange),
  allow_doc_no_range: yes(row?.AllowDocNoRange),
  track_printed: yes(row?.TrackPrinted),
  multi_print_query: t(row?.MultiPrintQuery),
})

/**
 * Add or edit one print format (a UtlOption row), laid out like the legacy "Print Option Name" window: name + Default,
 * After Save, Print Click / Ctrl+Click / Ctrl+Alt+Click, printer, Merge PDF, report file, copies, Multi-Rpt for Email,
 * selection formula, the formula grid, Template and the two Copy From buttons. Email / Multi Print / PDF settings appear
 * when one of the three click boxes uses them, as in the legacy window. `row` = the row being edited, absent for a new one.
 */
export default function PrintOptionDialog({ row, defaultDocId = null, printerData, onClose, onSaved }) {
  const editing = Boolean(row)
  const { data: screens = [] } = useQuery({ queryKey: ['print-screens'], queryFn: printOptionsApi.listPrintScreens, enabled: !editing, staleTime: 60_000 })
  const { data: rptFiles = [] } = useQuery({ queryKey: ['rpt-files'], queryFn: printOptionsApi.listRptFiles, staleTime: 30_000 })
  const { data: allOptions = [] } = useQuery({ queryKey: ['print-options-all'], queryFn: printOptionsApi.listAllPrintOptions, staleTime: 30_000 })
  const [docId, setDocId] = useState(row ? String(row.DocID) : defaultDocId || null)
  const [f, setF] = useState(() => fromRow(row))
  const [busy, setBusy] = useState(false)
  const [copy, setCopy] = useState(null) // { different: bool, doc: string|null, option: string|null }
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const fileData = [...new Set([...(f.crpt_file_name ? [f.crpt_file_name] : []), ...rptFiles])]

  const ops = [f.click_operation, f.ctrl_click_operation, f.ctrl_alt_click_operation]
  const hasEmail = ops.includes('E')
  const hasMulti = ops.includes('M')
  const hasPdf = ops.includes('F')
  const sameDoc = useMemo(() => allOptions.filter((o) => String(o.DocID) === String(docId) && o.OptionName !== (row?.OptionName ?? '')), [allOptions, docId, row])
  const docsWithOptions = useMemo(() => {
    const m = new Map()
    allOptions.forEach((o) => m.set(String(o.DocID), (o.MenuItemCaption || `Doc ${o.DocID}`).trim()))
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [allOptions])

  function setRow(i, k, v) {
    setF((x) => ({ ...x, rows: x.rows.map((r, ri) => (ri === i ? { ...r, [k]: v } : r)) }))
  }

  async function loadTemplate() {
    try {
      const rows = await printOptionsApi.getFormulaTemplate()
      if (!rows.length) return notifications.show({ message: 'This database has no formula template', color: 'yellow' })
      setF((x) => ({ ...x, rows: [...x.rows.filter((r) => t(r.field)), ...rows] }))
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not load the template', color: 'red' })
    }
  }

  // Copy From Existing / Different Transaction: everything is copied except the name, report file and formula typed so far (legacy)
  function applyCopy() {
    const src = allOptions.find((o) => String(o.DocID) === String(copy.doc) && o.OptionName === copy.option)
    if (!src) return
    const next = fromRow(src)
    setF((x) => ({ ...next, option_name: x.option_name, crpt_file_name: x.crpt_file_name, sel_formula: x.sel_formula, default_print: false, option_order: '' }))
    setCopy(null)
  }

  async function save() {
    if (!docId) return notifications.show({ message: 'Choose the screen', color: 'yellow' })
    if (!f.option_name.trim()) return notifications.show({ message: 'Enter the print option name', color: 'yellow' })
    if (!f.click_operation) return notifications.show({ message: 'Invalid Print Click....', color: 'yellow' })
    if (!f.crpt_file_name.trim()) return notifications.show({ message: 'Choose the report file', color: 'yellow' })
    if (hasPdf && !f.folder_loc.trim()) return notifications.show({ message: 'Please select the folder to save PDF files....', color: 'yellow' })
    const body = {
      crpt_file_name: f.crpt_file_name.trim(),
      direct_printer_name: f.direct_printer_name || '',
      after_save_action: f.after_save_action,
      no_of_copies: Number(f.no_of_copies) || 1,
      default_print: f.default_print ? 'Y' : 'N',
      in_active: f.in_active ? 'Y' : 'N',
      option_order: f.option_order === '' ? undefined : Number(f.option_order),
      sel_formula: f.sel_formula,
      ...joinFormulaRows(f.rows),
      click_operation: f.click_operation,
      ctrl_click_operation: f.ctrl_click_operation || '',
      ctrl_alt_click_operation: f.ctrl_alt_click_operation || '',
      wo_auth: f.wo_auth ? 'Y' : 'N',
      merge_pdf: f.merge_pdf ? 'Y' : 'N',
      email_multi_rpt_ids: f.email_multi_rpt_ids.join(','),
      folder_loc: f.folder_loc,
      fld_sel: f.fld_sel,
      email_routing: f.email_routing,
      do_not_attach: f.do_not_attach ? 'Y' : 'N',
      email_subject: f.email_subject,
      email_body: f.email_body,
      email_footer: f.email_footer,
      email_cond: f.email_cond,
      allow_date_range: f.allow_date_range ? 'Y' : 'N',
      allow_doc_no_range: f.allow_doc_no_range ? 'Y' : 'N',
      track_printed: f.track_printed ? 'Y' : 'N',
      multi_print_query: f.multi_print_query,
    }
    setBusy(true)
    try {
      if (editing) await printOptionsApi.updatePrintOption(row.DocID, row.OptionName, body)
      else await printOptionsApi.createPrintOption({ ...body, doc_id: Number(docId), option_name: f.option_name.trim() })
      notifications.show({ message: editing ? 'Print option saved' : 'Print option added', color: 'teal' })
      onSaved()
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not save the print option', color: 'red' })
    } finally {
      setBusy(false)
    }
  }

  const clickSelect = (label, key, required = false) => (
    <Select label={label} className={required ? 'vt-field-required' : undefined} data={CLICK_OPS} value={f[key] || null} onChange={(v) => set(key)(v || '')} clearable={!required} allowDeselect={!required} />
  )

  return (
    <>
      <Modal opened onClose={onClose} size="min(920px, 96vw)" radius="lg" centered title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{`Print Option Name${row?.MenuItemCaption ? ` for ${row.MenuItemCaption}` : ''}`}</Text>}>
        <Stack gap="sm">
          <Group align="flex-end" gap="lg" wrap="wrap">
            {!editing && <Select label="Screen" className="vt-field-required" searchable placeholder="Choose the screen" data={screens.map((s) => ({ value: String(s.doc_id), label: s.caption }))} value={docId} onChange={setDocId} data-autofocus w={260} />}
            <TextInput label="Print Option Name" className="vt-field-required" value={f.option_name} onChange={(e) => set('option_name')(e.currentTarget.value)} readOnly={editing} maxLength={50} w={320} />
            <Checkbox color="kumkum" label="Default" mb={8} checked={f.default_print} onChange={(e) => set('default_print')(e.currentTarget.checked)} />
            <Checkbox color="kumkum" label="Inactive" mb={8} checked={f.in_active} onChange={(e) => set('in_active')(e.currentTarget.checked)} />
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Stack gap="sm">
              <Paper withBorder p="sm" radius="md">
                <Radio.Group label="After Save" value={f.after_save_action} onChange={set('after_save_action')}>
                  <Stack gap={6} mt={6}>
                    {AFTER_SAVE.map((o) => <Radio key={o.value} color="kumkum" value={o.value} label={o.label} />)}
                  </Stack>
                </Radio.Group>
              </Paper>
              <Checkbox color="kumkum" label="Print Without Authorization" checked={f.wo_auth} onChange={(e) => set('wo_auth')(e.currentTarget.checked)} />
              <Checkbox color="kumkum" label="Merge PDF" checked={f.merge_pdf} onChange={(e) => set('merge_pdf')(e.currentTarget.checked)} />
            </Stack>
            <Paper withBorder p="sm" radius="md">
              <Stack gap="xs">
                {clickSelect('Print Click', 'click_operation', true)}
                {clickSelect('Print Ctrl + Click', 'ctrl_click_operation')}
                {clickSelect('Print Ctrl+Alt+Click', 'ctrl_alt_click_operation')}
                <Select label="Printer Name" searchable clearable placeholder="Default printer" data={printerData(f.direct_printer_name)} value={f.direct_printer_name || null} onChange={(v) => set('direct_printer_name')(v || '')} />
              </Stack>
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Stack gap="xs">
              <Select label="Rpt File Name" className="vt-field-required" searchable placeholder="Choose the .rpt file" data={fileData} value={f.crpt_file_name || null} onChange={(v) => set('crpt_file_name')(v || '')} />
              <Group grow>
                <NumberInput label="Number of Copies" min={1} value={f.no_of_copies} onChange={set('no_of_copies')} />
                <NumberInput label="Order" min={1} placeholder="Next" value={f.option_order} onChange={set('option_order')} />
              </Group>
              <TextInput label="Selection Formula" description="For example {TrnHdrSEVA.SEVAID}=" value={f.sel_formula} onChange={(e) => set('sel_formula')(e.currentTarget.value)} maxLength={250} />
            </Stack>
            <MultiSelect label="Multi-Rpt for Email" description="Other print options of this screen sent together as attachments" data={sameDoc.map((o) => o.OptionName)} value={f.email_multi_rpt_ids} onChange={set('email_multi_rpt_ids')} searchable clearable placeholder={sameDoc.length ? 'Pick print options' : 'No other print option on this screen'} />
          </SimpleGrid>

          <div>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={600}>Formula Fields</Text>
              <Group gap="xs">
                <Button size="compact-sm" variant="default" leftSection={<Plus size={14} />} onClick={() => set('rows')([...f.rows, { field: '', table: '', value: '' }])}>Add row</Button>
                {!editing && <Button size="compact-sm" variant="default" onClick={loadTemplate}>Template</Button>}
              </Group>
            </Group>
            <Table.ScrollContainer minWidth={520} mah={220}>
              <Table withTableBorder withColumnBorders verticalSpacing={2}>
                <Table.Thead>
                  <Table.Tr><Table.Th>Formula Field</Table.Th><Table.Th>Table</Table.Th><Table.Th>Formula Value</Table.Th><Table.Th w={40} /></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {f.rows.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">No formula fields. Use Add row or Template.</Text></Table.Td></Table.Tr>}
                  {f.rows.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td><TextInput size="xs" aria-label={`Formula field ${i + 1}`} value={r.field} onChange={(e) => setRow(i, 'field', e.currentTarget.value)} /></Table.Td>
                      <Table.Td><TextInput size="xs" aria-label={`Table ${i + 1}`} value={r.table} onChange={(e) => setRow(i, 'table', e.currentTarget.value)} /></Table.Td>
                      <Table.Td><TextInput size="xs" aria-label={`Formula value ${i + 1}`} value={r.value} onChange={(e) => setRow(i, 'value', e.currentTarget.value)} /></Table.Td>
                      <Table.Td><ActionIcon variant="subtle" color="red" aria-label={`Remove formula row ${i + 1}`} onClick={() => set('rows')(f.rows.filter((_, ri) => ri !== i))}><Trash2 size={15} /></ActionIcon></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </div>

          {hasEmail && (
            <Paper withBorder p="sm" radius="md">
              <Text fw={700} size="sm" mb={6}>Email Settings</Text>
              <Stack gap="xs">
                <Group gap="lg">
                  <Radio.Group value={f.email_routing} onChange={set('email_routing')}>
                    <Group gap="md"><Radio color="kumkum" value="S" label="SMTP" /><Radio color="kumkum" value="O" label="Outlook" /></Group>
                  </Radio.Group>
                  <Checkbox color="kumkum" label="Do not attach print copy" checked={f.do_not_attach} onChange={(e) => set('do_not_attach')(e.currentTarget.checked)} />
                </Group>
                <TextInput label="Subject" value={f.email_subject} onChange={(e) => set('email_subject')(e.currentTarget.value)} maxLength={500} />
                <Textarea label="Body" autosize minRows={2} value={f.email_body} onChange={(e) => set('email_body')(e.currentTarget.value)} maxLength={500} />
                <TextInput label="Footer" value={f.email_footer} onChange={(e) => set('email_footer')(e.currentTarget.value)} maxLength={500} />
                <TextInput label="Condition" value={f.email_cond} onChange={(e) => set('email_cond')(e.currentTarget.value)} maxLength={500} />
              </Stack>
            </Paper>
          )}

          {hasMulti && (
            <Paper withBorder p="sm" radius="md">
              <Text fw={700} size="sm" mb={6}>Multi Print</Text>
              <Group gap="lg" mb="xs">
                <Checkbox color="kumkum" label="Date Filter" checked={f.allow_date_range} onChange={(e) => set('allow_date_range')(e.currentTarget.checked)} />
                <Checkbox color="kumkum" label="Doc No Range" checked={f.allow_doc_no_range} onChange={(e) => set('allow_doc_no_range')(e.currentTarget.checked)} />
                <Checkbox color="kumkum" label="Track Printed" checked={f.track_printed} onChange={(e) => set('track_printed')(e.currentTarget.checked)} />
              </Group>
              <Textarea label="SQL Query" autosize minRows={2} value={f.multi_print_query} onChange={(e) => set('multi_print_query')(e.currentTarget.value)} maxLength={1000} />
            </Paper>
          )}

          {hasPdf && (
            <Paper withBorder p="sm" radius="md">
              <Text fw={700} size="sm" mb={6}>PDF Settings</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput label="Folder Location" className="vt-field-required" description="Folder on the server where the PDF files are saved" value={f.folder_loc} onChange={(e) => set('folder_loc')(e.currentTarget.value)} maxLength={500} />
                <TextInput label="Field Selection" description="Document fields used to name the PDF file" value={f.fld_sel} onChange={(e) => set('fld_sel')(e.currentTarget.value)} maxLength={500} />
              </SimpleGrid>
            </Paper>
          )}

          <Group justify="space-between" mt="xs">
            <Group gap="xs">
              {!editing && docId && <Button variant="default" onClick={() => setCopy({ different: false, doc: docId, option: null })}>Copy From Existing Transaction</Button>}
              {!editing && docId && <Button variant="default" onClick={() => setCopy({ different: true, doc: null, option: null })}>Copy from Different Transaction</Button>}
            </Group>
            <Group>
              <Button variant="default" onClick={onClose}>Cancel</Button>
              <Button color="kumkum" loading={busy} onClick={save}>{editing ? 'Save' : 'Add'}</Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(copy)} onClose={() => setCopy(null)} size="sm" radius="lg" centered title={<Text fw={700}>{copy?.different ? 'Copy from a different transaction' : 'Copy from an existing print option'}</Text>}>
        {copy && (
          <Stack gap="sm">
            {copy.different && <Select label="Document" searchable data={docsWithOptions} value={copy.doc} onChange={(v) => setCopy((c) => ({ ...c, doc: v, option: null }))} />}
            <Select label="Print option" searchable data={allOptions.filter((o) => String(o.DocID) === String(copy.doc)).map((o) => o.OptionName)} value={copy.option} onChange={(v) => setCopy((c) => ({ ...c, option: v }))} disabled={!copy.doc} />
            <Text size="xs" c="dimmed">Everything is copied except the print option name, report file and selection formula you have already entered.</Text>
            <Group justify="flex-end"><Button variant="default" onClick={() => setCopy(null)}>Cancel</Button><Button color="kumkum" disabled={!copy.option} onClick={applyCopy}>Copy</Button></Group>
          </Stack>
        )}
      </Modal>
    </>
  )
}
