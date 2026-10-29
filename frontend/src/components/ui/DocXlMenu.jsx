import { useRef, useState } from 'react'
import { Button, Menu } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { ChevronDown, FileDown, FileSpreadsheet, FileUp } from 'lucide-react'
import { saveBlob } from '../../utils/xls'
import { useConfirm } from './ConfirmProvider'
import * as docActions from '../../api/endpoints/docActions'

/**
 * Doc XL Export / XL Template / XL Import (legacy toolbar tsbDocExport / tsbTemplate / tsbImport) for a document's line
 * grid. The screen shows it only when UtlTransactions.AllowImpExp = 'Y' (useDocRules().allow_imp_exp).
 * `rows` / `setRows` are the screen's lines; an import replaces them, like the legacy grid.
 */
export default function DocXlMenu({ docId, name, rows, setRows, disabled = false }) {
  const confirm = useConfirm()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const fail = (err, fb) => notifications.show({ message: err?.response?.data?.detail || fb, color: 'red' })

  async function run(fn) {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      fail(err, 'The Excel action failed')
    } finally {
      setBusy(false)
    }
  }
  const onExport = () => run(async () => saveBlob(await docActions.xlExport(docId, rows), `${name}.xls`))
  const onTemplate = () => run(async () => saveBlob(await docActions.xlTemplate(docId), `${name} template.xls`))
  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const hasData = rows.some((r) => Object.values(r).some((v) => v !== '' && v !== 0 && v !== null && v !== undefined))
    if (hasData && !(await confirm({ title: 'Replace the lines?', message: 'The lines on screen will be replaced by the rows of the Excel file.', confirmLabel: 'Replace' }))) return
    run(async () => {
      const r = await docActions.xlImport(docId, file)
      setRows(r.rows)
      notifications.show({ message: `XL imported into Grid... (${r.rows.length} row${r.rows.length === 1 ? '' : 's'})`, color: 'teal' })
    })
  }

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button size="xs" variant="light" color="kumkum" leftSection={<FileSpreadsheet size={14} />} rightSection={<ChevronDown size={14} />} loading={busy}>
            Excel
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<FileDown size={14} />} onClick={onExport}>
            Doc XL Export
          </Menu.Item>
          <Menu.Item leftSection={<FileDown size={14} />} onClick={onTemplate}>
            XL Template
          </Menu.Item>
          <Menu.Item leftSection={<FileUp size={14} />} disabled={disabled} onClick={() => input.current?.click()}>
            XL Import
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <input ref={input} type="file" accept=".xls,application/vnd.ms-excel" hidden onChange={onFile} />
    </>
  )
}
