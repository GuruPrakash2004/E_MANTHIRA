import { useEffect, useState } from 'react'
import { Button, Card, Checkbox, Grid, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { Save, Search, ListChecks, PencilRuler } from 'lucide-react'
import UtilityBanner from '../../components/ui/UtilityBanner'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { SectionCard } from '../../components/ui/EntryParts'
import EmptyState from '../../components/ui/EmptyState'
import { notifications } from '@mantine/notifications'
import { useQuery } from '@tanstack/react-query'
import * as bulkUpdateApi from '../../api/endpoints/bulkUpdate'

/**
 * Bulk Master/Transaction Update — port of the legacy utility
 * (UtlMstTrnBulkUpdate): pick a definition, filter to the rows you want,
 * edit the one/two editable columns across all of them, save in one go.
 * Real usage in this client's data is almost entirely bulk-marking
 * TrnHdrSEVA.PRASADA across many sevas at once.
 */
export default function BulkUpdateTab() {
  const confirm = useConfirm()
  const [rowId, setRowId] = useState('')
  const [filterValues, setFilterValues] = useState({})
  const [rows, setRows] = useState(null)
  const [edited, setEdited] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: definitions } = useQuery({ queryKey: ['bulk-update-defs'], queryFn: bulkUpdateApi.listDefinitions })
  const { data: definition } = useQuery({
    queryKey: ['bulk-update-def', rowId],
    queryFn: () => bulkUpdateApi.getDefinition(rowId),
    enabled: Boolean(rowId),
  })

  useEffect(() => {
    setFilterValues({})
    setRows(null)
    setEdited({})
  }, [rowId])

  const visibleCols = (definition?.columns || []).filter((c) => c.visible)
  const editableCols = (definition?.columns || []).filter((c) => c.editable)

  async function onSearch() {
    setLoading(true)
    try {
      const data = await bulkUpdateApi.searchRows(rowId, filterValues)
      setRows(data)
      setEdited({})
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Search failed', color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  function setCellValue(keyVal, colName, value) {
    setEdited((e) => ({ ...e, [keyVal]: { ...e[keyVal], [colName]: value } }))
  }

  async function onSave() {
    const keyField = definition.key_field
    const changedRows = Object.entries(edited)
      .filter(([, patch]) => Object.keys(patch).length > 0)
      .map(([keyVal, patch]) => ({ [keyField]: isNaN(Number(keyVal)) ? keyVal : Number(keyVal), ...patch }))
    if (changedRows.length === 0) {
      notifications.show({ message: 'No changes to save', color: 'yellow' })
      return
    }
    const n = changedRows.length
    if (!(await confirm({ title: `Update ${n} record${n === 1 ? '' : 's'}?`, message: `The changes will be written to ${n} record${n === 1 ? '' : 's'} at once.`, confirmLabel: 'Update', tone: 'warning' }))) return
    setSaving(true)
    try {
      const result = await bulkUpdateApi.saveRows(rowId, changedRows)
      notifications.show({ message: result.message, color: 'teal' })
      onSearch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack>
      <UtilityBanner
        title="Bulk Master Update"
        subtitle="Change a column across many records at once."
        heading={definition?.doc_name || 'Choose a definition'}
        sub="Bulk update"
        facts={[
          { label: 'definitions', value: definitions ? definitions.length : '-' },
          { label: 'records loaded', value: rows ? rows.length : 0 },
        ]}
        emblem={<PencilRuler size={60} color="#F4E1A6" strokeWidth={1.4} />}
      />
      <SectionCard title="What to update" hint="Pick a definition, narrow down the records, then edit the columns that allow it.">
        <Select
          label="Bulk update definition"
          placeholder="Choose what to bulk-update"
          data={(definitions || []).map((d) => ({ value: String(d.row_id), label: `${d.doc_name} (${d.table})` }))}
          value={rowId}
          onChange={setRowId}
        />
        {definition?.filters?.length > 0 && (
          <Grid mt="md">
            {definition.filters.map((f) => (
              <Grid.Col span={{ base: 12, sm: 6, md: 3 }} key={f.name}>
                <TextInput
                  label={f.name}
                  value={filterValues[f.name] || ''}
                  onChange={(e) => setFilterValues((v) => ({ ...v, [f.name]: e.currentTarget.value }))}
                />
              </Grid.Col>
            ))}
          </Grid>
        )}
        <Group justify="flex-end" mt="md">
          <Button leftSection={<Search size={16} />} color="kumkum" loading={loading} disabled={!rowId} onClick={onSearch}>
            Search
          </Button>
        </Group>
      </SectionCard>

      {!rows && <EmptyState icon={ListChecks} title="Nothing loaded yet" hint="Choose a definition and press Search to list the records." />}

      {rows && (
        <Card withBorder p="lg">
          <Text size="sm" c="dimmed" mb="sm">
            {rows.length} record{rows.length === 1 ? '' : 's'}
            {Object.keys(edited).length > 0 && `, ${Object.keys(edited).length} changed`}
          </Text>
          <Table.ScrollContainer minWidth={640} mah="65dvh">
          <Table highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                {visibleCols.map((c) => (
                  <Table.Th key={c.name}>{c.name}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={visibleCols.length}>
                    <Text c="dimmed" ta="center" py="md">
                      No matching rows.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {rows.map((r) => {
                const keyVal = r[definition.key_field]
                return (
                  <Table.Tr key={keyVal}>
                    {visibleCols.map((c) => {
                      const isEditable = editableCols.some((e) => e.name === c.name)
                      const currentValue = edited[keyVal]?.[c.name] ?? r[c.name]
                      if (!isEditable) {
                        return <Table.Td key={c.name}>{String(r[c.name] ?? '')}</Table.Td>
                      }
                      if (c.data_type === 'TEXT' && (currentValue === 'Y' || currentValue === 'N' || currentValue === 'Yes' || currentValue === 'No')) {
                        const truthy = currentValue === 'Y' || currentValue === 'Yes'
                        const yesForm = currentValue === 'Yes' || currentValue === 'No'
                        return (
                          <Table.Td key={c.name}>
                            <Checkbox
                              color="kumkum"
                              aria-label={`${c.name}, ${keyVal}`}
                              checked={truthy}
                              onChange={(e) => setCellValue(keyVal, c.name, e.currentTarget.checked ? (yesForm ? 'Yes' : 'Y') : yesForm ? 'No' : 'N')}
                            />
                          </Table.Td>
                        )
                      }
                      return (
                        <Table.Td key={c.name}>
                          <TextInput size="xs" aria-label={`${c.name}, ${keyVal}`} value={currentValue ?? ''} onChange={(e) => setCellValue(keyVal, c.name, e.currentTarget.value)} />
                        </Table.Td>
                      )
                    })}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
          </Table.ScrollContainer>
          {rows.length > 0 && (
            <Group justify="flex-end" mt="md">
              <Button color="kumkum" leftSection={<Save size={16} />} loading={saving} onClick={onSave}>
                Save changes
              </Button>
            </Group>
          )}
        </Card>
      )}
    </Stack>
  )
}
