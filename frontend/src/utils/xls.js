import { notifications } from '@mantine/notifications'
import { api } from '../api/api'

/** Save a Blob as a file download. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Download rows as an Excel 97-2003 (.xls) file — the only spreadsheet format the app exports. The server builds the
 * file (POST /export/xls). columns: [{ label, key? , value?(row) }].
 */
export async function downloadXls(filename, rows, columns) {
  const name = String(filename || 'export').replace(/\.(csv|xlsx?)$/i, '')
  try {
    const blob = await api
      .post(
        '/export/xls',
        { filename: name, sheet: name.slice(0, 31), headers: columns.map((c) => c.label), rows: rows.map((r) => columns.map((c) => (c.value ? c.value(r) : r[c.key]) ?? '')) },
        { responseType: 'blob' },
      )
      .then((r) => r.data)
    saveBlob(blob, `${name}.xls`)
  } catch (e) {
    let msg = 'Could not export to Excel'
    try {
      msg = JSON.parse(await e.response.data.text()).detail || msg
    } catch {
      /* keep the generic message */
    }
    notifications.show({ message: msg, color: 'red' })
  }
}
