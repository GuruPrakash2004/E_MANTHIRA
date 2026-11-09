import { ActionIcon, Button, Table, Text } from '@mantine/core'
import { Plus, Trash2 } from 'lucide-react'
import DynamicField from './DynamicField'
import useDocFields from '../hooks/useDocFields'
import { useConfirm } from './ui/ConfirmProvider'
import { fieldDefault, fieldListOptions, isFieldHidden, isFieldMandatory } from '../utils/docFieldConditions'

/**
 * The detail (line) grid of a document, drawn from its UtlDocDsgrFlds rows with FldSection = 'Detail': one column
 * per visible field, in FldOrderBy order, with the Designer's caption, widget, list, mandatory and read-only
 * rules. `rows` is an array of `{ FldCode: value }`. Header values are passed as `values` so a column's hide rule
 * can depend on a header field.
 */
export function detailColumns(fields, values, skip = []) {
  return fields
    .filter((f) => f.FldSection === 'Detail' && !skip.includes(f.FldCode) && !isFieldHidden(f, values))
    .sort((a, b) => (Number(a.FldOrderBy) || 0) - (Number(b.FldOrderBy) || 0))
}

/** A blank line carrying the Designer's static defaults. */
export function blankLine(fields) {
  const line = {}
  for (const f of fields.filter((x) => x.FldSection === 'Detail')) {
    const def = fieldDefault(f)
    if (def === undefined) continue
    const list = fieldListOptions(f)
    line[f.FldCode] = (list && list.find((o) => o.toLowerCase() === def.toLowerCase())) || def
  }
  return line
}

/** `{ index: { FldCode: message } }` for every visible mandatory line field left empty. */
export function detailErrors(fields, rows, values, skip = []) {
  const cols = detailColumns(fields, values, skip)
  const errors = {}
  rows.forEach((row, i) => {
    for (const f of cols) {
      if (!isFieldMandatory(f, { ...values, ...row })) continue
      const v = row[f.FldCode]
      if (v === undefined || v === null || String(v).trim() === '' || (f.FldBlnComboData === 'Y' && Number(v) === 0)) {
        errors[i] = { ...(errors[i] || {}), [f.FldCode]: `${f.FldCaption || f.FldCode} is required` }
      }
    }
  })
  // FldBlnChkDuplicate: the same value of that column on two lines
  for (const f of cols.filter((x) => x.FldBlnChkDuplicate === 'Y')) {
    const seen = new Set()
    rows.forEach((row, i) => {
      const v = String(row[f.FldCode] ?? '').trim().toUpperCase()
      if (!v) return
      if (seen.has(v)) errors[i] = { ...(errors[i] || {}), [f.FldCode]: `Duplicate ${f.FldCaption || f.FldCode}` }
      seen.add(v)
    })
  }
  return errors
}

export default function DocDetailGrid({ docId, rows, setRows, values = {}, errors = {}, readOnly = false, skip = [], minRows = 1 }) {
  const confirm = useConfirm()
  const { fields } = useDocFields(docId)
  const cols = detailColumns(fields, values, skip)
  if (!cols.length) return null

  const setCell = (i, code, v) => setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, [code]: v } : r)))

  return (
    <>
      <Table.ScrollContainer minWidth={420}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              {cols.map((f) => {
                // red caption = mandatory, driven by the Designer's flag / condition (same meaning as the captions of the form fields)
                const must = isFieldMandatory(f, values)
                return (
                  <Table.Th key={f.FldCode} style={must ? { color: 'var(--vt-required-ink)' } : undefined}>
                    {f.FldCaption || f.FldCode}
                    {must ? ' *' : ''}
                  </Table.Th>
                )
              })}
              <Table.Th w={48} aria-label="Remove" />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, i) => (
              <Table.Tr key={i}>
                {cols.map((f) => (
                  <Table.Td key={f.FldCode}>
                    <DynamicField
                      docId={docId}
                      field={f}
                      value={row[f.FldCode]}
                      onChange={(v) => setCell(i, f.FldCode, v)}
                      required={isFieldMandatory(f, { ...values, ...row })}
                      locked={readOnly}
                      noSeed
                      compact
                      error={errors[i]?.[f.FldCode]}
                    />
                  </Table.Td>
                ))}
                <Table.Td>
                  {!readOnly && rows.length > minRows && (
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      size={36}
                      aria-label="Remove this line"
                      onClick={async () => {
                        if (await confirm({ title: 'Remove this line?', message: 'It will be removed from this entry. You can add it again before saving.', confirmLabel: 'Remove' })) {
                          setRows((rs) => rs.filter((_, ri) => ri !== i))
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!readOnly && (
        <Button mt="sm" size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={() => setRows((rs) => [...rs, blankLine(fields)])}>
          Add line
        </Button>
      )}
      {!rows.length && (
        <Text size="xs" c="dimmed" mt="xs">
          No lines yet.
        </Text>
      )}
    </>
  )
}
