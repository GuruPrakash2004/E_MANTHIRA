import { useState } from 'react'
import { Button, Checkbox, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import * as printOptionsApi from '../../api/endpoints/printOptions'

const AFTER_SAVE_ACTIONS = [
  { value: 'P', label: 'Print' },
  { value: 'PP', label: 'Preview' },
  { value: 'DNP', label: 'Do Not Print' },
]

/**
 * Add or edit one print format (a UtlOption row). `row` = the row being edited, absent for a new one; the screen and the
 * format name are the row's key, so they can only be chosen when adding.
 */
export default function PrintOptionDialog({ row, printerData, onClose, onSaved }) {
  const editing = Boolean(row)
  const { data: screens = [] } = useQuery({ queryKey: ['print-screens'], queryFn: printOptionsApi.listPrintScreens, enabled: !editing, staleTime: 60_000 })
  const { data: rptFiles = [] } = useQuery({ queryKey: ['rpt-files'], queryFn: printOptionsApi.listRptFiles, staleTime: 30_000 })
  const [f, setF] = useState({
    doc_id: row ? String(row.DocID) : null,
    option_name: row?.OptionName || '',
    crpt_file_name: (row?.CrptFileName || '').trim(),
    direct_printer_name: (row?.DirectPrinterName || '').trim(),
    after_save_action: (row?.AfterSaveAction || '').trim() || 'DNP',
    no_of_copies: row?.NoOfCopies || 1,
    default_print: row?.DefaultPrint === 'Y',
    in_active: row?.InActive === 'Y',
    option_order: row?.OptionOrder ?? '',
    sel_formula: (row?.SelFormula || '').trim(),
    formulas_fld: (row?.FormulasFld || '').trim(),
    formulas_val: (row?.FormulasVal || '').trim(),
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const fileData = [...new Set([...(f.crpt_file_name ? [f.crpt_file_name] : []), ...rptFiles])]

  async function save() {
    if (!f.doc_id) return notifications.show({ message: 'Choose the screen', color: 'yellow' })
    if (!f.option_name.trim()) return notifications.show({ message: 'Enter the format name', color: 'yellow' })
    if (!f.crpt_file_name.trim()) return notifications.show({ message: 'Choose the report file', color: 'yellow' })
    const body = {
      crpt_file_name: f.crpt_file_name.trim(),
      direct_printer_name: f.direct_printer_name || '',
      after_save_action: f.after_save_action,
      no_of_copies: Number(f.no_of_copies) || 1,
      default_print: f.default_print ? 'Y' : 'N',
      in_active: f.in_active ? 'Y' : 'N',
      option_order: f.option_order === '' ? undefined : Number(f.option_order),
      sel_formula: f.sel_formula,
      formulas_fld: f.formulas_fld,
      formulas_val: f.formulas_val,
    }
    setBusy(true)
    try {
      if (editing) await printOptionsApi.updatePrintOption(row.DocID, row.OptionName, body)
      else await printOptionsApi.createPrintOption({ ...body, doc_id: Number(f.doc_id), option_name: f.option_name.trim() })
      notifications.show({ message: editing ? 'Print option saved' : 'Print option added', color: 'teal' })
      onSaved()
    } catch (e) {
      notifications.show({ message: e?.response?.data?.detail || 'Could not save the print option', color: 'red' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} size="lg" radius="lg" centered title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>{editing ? 'Edit Print Option' : 'Add Print Option'}</Text>}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {editing ? (
            <TextInput label="Screen" value={row.MenuItemCaption || `Doc ${row.DocID}`} readOnly />
          ) : (
            <Select label="Screen" className="vt-field-required" searchable placeholder="Choose the screen" data={screens.map((s) => ({ value: String(s.doc_id), label: s.caption }))} value={f.doc_id} onChange={set('doc_id')} data-autofocus />
          )}
          <TextInput label="Format" className="vt-field-required" value={f.option_name} onChange={(e) => set('option_name')(e.currentTarget.value)} readOnly={editing} maxLength={50} />
          <Select label="Report File" className="vt-field-required" searchable placeholder="Choose the .rpt file" data={fileData} value={f.crpt_file_name || null} onChange={(v) => set('crpt_file_name')(v || '')} />
          <Select label="Direct Printer" searchable clearable placeholder="Default printer" data={printerData(f.direct_printer_name)} value={f.direct_printer_name || null} onChange={(v) => set('direct_printer_name')(v || '')} />
          <Select label="After Save" data={AFTER_SAVE_ACTIONS} value={f.after_save_action} onChange={(v) => v && set('after_save_action')(v)} allowDeselect={false} />
          <NumberInput label="Copies" min={1} value={f.no_of_copies} onChange={set('no_of_copies')} />
          <NumberInput label="Order" min={1} placeholder="Next" value={f.option_order} onChange={set('option_order')} />
          <Group gap="lg" align="flex-end" pb={6}>
            <Checkbox color="kumkum" label="Default" checked={f.default_print} onChange={(e) => set('default_print')(e.currentTarget.checked)} />
            <Checkbox color="kumkum" label="Inactive" checked={f.in_active} onChange={(e) => set('in_active')(e.currentTarget.checked)} />
          </Group>
        </SimpleGrid>
        <TextInput label="Selection Formula" description="For example {TrnHdrDONREC.DONRECID}=" value={f.sel_formula} onChange={(e) => set('sel_formula')(e.currentTarget.value)} maxLength={250} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Textarea label="Formula Fields" description="Names, separated by ;" autosize minRows={2} value={f.formulas_fld} onChange={(e) => set('formulas_fld')(e.currentTarget.value)} maxLength={250} />
          <Textarea label="Formula Values" description="Values, separated by ;" autosize minRows={2} value={f.formulas_val} onChange={(e) => set('formulas_val')(e.currentTarget.value)} maxLength={250} />
        </SimpleGrid>
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="kumkum" loading={busy} onClick={save}>{editing ? 'Save' : 'Add'}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
