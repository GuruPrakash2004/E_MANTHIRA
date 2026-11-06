import { useMemo, useRef, useState } from 'react'
import { Button, Group, Modal, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Eye, Printer } from 'lucide-react'
import dayjs from 'dayjs'
import { getCompany } from '../../api/endpoints/company'
import { useAuth } from '../../hooks/useAuth'
import usePrintKey from '../../hooks/usePrintKey'
import { textOf } from '../../utils/reportCells'

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The one printable layout of every report: company name and address, the report title, the period and filter lines, the
 * full table (all rows, not only the ones on screen) with its header repeating on each page, bold total / subtotal rows,
 * and a "printed on" footer. Always light, whatever theme the app is in.
 *   rows with `_kind: 'total' | 'subtotal'` are drawn bold; `groupKey` merges a repeated group cell (first column) with rowSpan.
 */
export function buildReportHtml({ company, title, period, filters, columns, rows, totals, groupKey, landscape, user }) {
  const cols = columns.filter((c) => c.label !== undefined)
  const kind = (r) => r._kind
  const spans = groupKey
    ? rows.map((r, i) => {
        if (kind(r) === 'total' || kind(r) === 'subtotal' || !textOf({ key: groupKey }, r)) return 0
        let n = 1
        while (i + n < rows.length && kind(rows[i + n]) !== 'total' && kind(rows[i + n]) !== 'subtotal' && !textOf({ key: groupKey }, rows[i + n])) n += 1
        return n
      })
    : null
  const cell = (c, r) => esc(textOf(c, r))
  const body = rows
    .map((r, i) => {
      const bold = kind(r) === 'total' || kind(r) === 'subtotal'
      const tds = cols
        .map((c, ci) => {
          if (groupKey && ci === 0 && !bold) {
            if (!spans[i]) return ''
            return `<td rowspan="${spans[i]}" class="grp">${cell(c, r)}</td>`
          }
          return `<td class="${c.num ? 'n' : ''}">${cell(c, r)}</td>`
        })
        .join('')
      return `<tr class="${bold ? 'b' : ''}">${tds}</tr>`
    })
    .join('')
  const totalRow = totals ? `<tr class="b">${cols.map((c) => `<td class="${c.num ? 'n' : ''}">${esc(totals[c.key] ?? '')}</td>`).join('')}</tr>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #1c1b19; background: #fff; margin: 0; padding: 12px; font-size: 11px; }
h1 { font-size: 15px; margin: 0 0 2px; text-align: center; }
.co { text-align: center; font-weight: 700; font-size: 13px; margin-bottom: 2px; }
.sub { text-align: center; margin: 0 0 2px; font-size: 11px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { border: 1px solid #b9a98a; padding: 3px 6px; vertical-align: top; }
th { background: #f1e6cc; text-align: left; font-weight: 700; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
td.grp { vertical-align: middle; font-weight: 600; background: #faf5e8; }
tr.b td { font-weight: 700; background: #f6edd6; }
.foot { margin-top: 10px; font-size: 10px; color: #555; display: flex; justify-content: space-between; }
</style></head><body>
${company ? `<div class="co">${esc(company)}</div>` : ''}
<h1>${esc(title)}</h1>
${period ? `<p class="sub">${esc(period)}</p>` : ''}
${filters ? `<p class="sub">${esc(filters)}</p>` : ''}
<table><thead><tr>${cols.map((c) => `<th class="${c.num ? 'n' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}${totalRow}</tbody></table>
<div class="foot"><span>${rows.length} row(s)</span><span>Printed on ${dayjs().format('DD/MM/YYYY HH:mm')}${user ? ` by ${esc(user)}` : ''}</span></div>
</body></html>`
}

/** Company name + address the way the legacy report header builds it (name, then the address lines run together). */
function useCompanyLine() {
  const { data } = useQuery({ queryKey: ['company'], queryFn: getCompany, staleTime: 10 * 60_000, retry: false })
  if (!data) return ''
  const addr = ['Address1', 'Address2', 'Address3', 'Address4', 'Address5'].map((k) => data[k] || '').join('')
  return `${String(data.CompName || '').trim()}${addr.trim() ? `,  ${addr}` : ''}`
}

/**
 * Preview and Print buttons for any report screen.
 *   title, period, filters   header lines of the printed page
 *   columns, rows            what the screen shows (all rows)
 *   totals                   optional {key: text} total row;  groupKey  merge the first column per group
 *   hotkey                   bind F10 to Print on this screen (one instance per screen)
 */
export default function ReportPrintButtons({ title, period, filters, columns, rows, totals, groupKey, hotkey = false, disabled = false, size = 'sm', landscape }) {
  const company = useCompanyLine()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const frame = useRef(null)
  const empty = disabled || !rows || rows.length === 0
  const wide = landscape ?? columns.length > 7
  const html = useMemo(
    () => (open ? buildReportHtml({ company, title, period, filters, columns, rows, totals, groupKey, landscape: wide, user: user?.user_name || user?.user_code }) : ''),
    [open, company, title, period, filters, columns, rows, totals, groupKey, wide, user]
  )

  function printNow() {
    const doc = buildReportHtml({ company, title, period, filters, columns, rows, totals, groupKey, landscape: wide, user: user?.user_name || user?.user_code })
    const f = document.createElement('iframe')
    f.setAttribute('aria-hidden', 'true')
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    f.onload = () => {
      try {
        f.contentWindow.focus()
        f.contentWindow.print()
      } finally {
        setTimeout(() => f.remove(), 60_000)
      }
    }
    f.srcdoc = doc
    document.body.appendChild(f)
  }
  usePrintKey(hotkey ? () => !empty && printNow() : undefined)

  return (
    <>
      <Button size={size} variant="light" color="kumkum" leftSection={<Eye size={15} />} disabled={empty} onClick={() => setOpen(true)}>
        Preview
      </Button>
      <Button size={size} variant="light" color="kumkum" leftSection={<Printer size={15} />} disabled={empty} onClick={printNow} aria-keyshortcuts={hotkey ? 'F10' : undefined}>
        Print{hotkey ? ' (F10)' : ''}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} size="min(1100px, 96vw)" radius="lg" centered zIndex={400} title={<Text fw={700} size="lg" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>Print preview - {title}</Text>}>
        <iframe ref={frame} title="Report preview" srcDoc={html} style={{ width: '100%', height: '68vh', border: '1px solid var(--vt-line)', borderRadius: 8, background: '#fff' }} />
        <Group justify="flex-end" mt="sm" gap="xs">
          <Button color="kumkum" leftSection={<Printer size={15} />} onClick={printNow}>Print</Button>
          <Button variant="default" onClick={() => setOpen(false)}>Close</Button>
        </Group>
      </Modal>
    </>
  )
}
