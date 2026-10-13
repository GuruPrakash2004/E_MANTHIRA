/** Download rows as a CSV file (opens in Excel). columns: [{ label, key? , value?(row) }]. */
export function downloadCsv(filename, rows, columns) {
  const cell = (v) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = rows.map((r) => columns.map((c) => cell(c.value ? c.value(r) : r[c.key])).join(','))
  const csv = '﻿' + [columns.map((c) => cell(c.label)).join(','), ...lines].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
