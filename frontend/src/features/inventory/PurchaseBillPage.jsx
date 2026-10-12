import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Divider, Grid, Group, NumberInput, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import LookupSelect from '../../components/LookupSelect'
import MasterOptionsSelect from './MasterOptionsSelect'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'

const ITEM_DOC_ID = 1114
const UOM_DOC_ID = 1115
const LOCATION_DOC_ID = 1123
const SUPPLIER_DOC_ID = 1121
const DOC_ID = 1271
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'

const FIELD_CODE_MAP = { LOCID: 'loc_id', LEDIDPUR: 'ledid_pur', REFNO: 'ref_no', REFDT: 'ref_date', RMKS: 'remarks' }

const EMPTY_LINE = { item_id: '', uom_id: '', qty: 0, rate: 0 }

/** Purchase Bill (DocID 1271) — confirmed zero real usage, built per explicit request. Records the bill + stock-in; accounting is posted separately via Purchase Voucher. */
export default function PurchaseBillPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ loc_id: '', supp_id: '', ledid_pur: '', ref_no: '', ref_date: null, remarks: '', doc_date: new Date() })
  const [lines, setLines] = useState([{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, refetch } = useQuery({ queryKey: ['purchase-bills', 'recent'], queryFn: () => inventoryApi.listPurchaseBills({ top: 15 }) })
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = Object.fromEntries(Object.entries(FIELD_CODE_MAP).map(([code, key]) => [code, form[key]]))
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }
  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { ...EMPTY_LINE }])
  }
  function removeLine(i) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))
  }

  const totalValue = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0)

  async function onSave() {
    if (!form.loc_id || !form.supp_id) {
      notifications.show({ message: 'Location and Supplier are mandatory', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        loc_id: Number(form.loc_id),
        supp_id: Number(form.supp_id),
        ledid_pur: Number(form.ledid_pur),
        ref_no: form.ref_no,
        ref_date: form.ref_date ? form.ref_date.toISOString().slice(0, 10) : null,
        remarks: form.remarks,
        doc_date: form.doc_date.toISOString().slice(0, 10),
        lines: lines.map((l) => ({ item_id: Number(l.item_id), uom_id: Number(l.uom_id), qty: Number(l.qty), rate: Number(l.rate) })),
      }
      const result = await inventoryApi.createPurchaseBill(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines([{ ...EMPTY_LINE }])
      queryClient.invalidateQueries({ queryKey: ['purchase-bills'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Save failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm">
          <img src={GOPURAM_MARK} alt="" aria-hidden style={{ height: 36, width: 36 }} />
          <div>
            <Title order={2} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Purchase Bill
            </Title>
            <Text size="sm" c="dimmed">
              Record items received from a supplier
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.pb_no}
          </Badge>
        )}
      </Group>

      <Grid>
        <Grid.Col span={8}>
          <Card withBorder radius="lg" p="lg" shadow="sm" style={{ position: 'relative', overflow: 'hidden' }}>
            <div
              aria-hidden
              style={{ position: 'absolute', inset: 0, backgroundImage: `url(${KOLAM_PATTERN})`, backgroundSize: '140px 140px', opacity: 0.03, pointerEvents: 'none' }}
            />
            <Grid style={{ position: 'relative' }}>
              {!hidden('LOCID') && (
                <Grid.Col span={4}>
                  <MasterOptionsSelect docId={LOCATION_DOC_ID} label={caption('LOCID', 'Location')} required={mandatory('LOCID')} value={form.loc_id} onChange={(v) => set('loc_id', v)} />
                </Grid.Col>
              )}
              <Grid.Col span={4}>
                <MasterOptionsSelect docId={SUPPLIER_DOC_ID} label="Supplier" required value={form.supp_id} onChange={(v) => set('supp_id', v)} />
              </Grid.Col>
              <Grid.Col span={4}>
                <DateInput label="Document Date" value={form.doc_date} onChange={(v) => set('doc_date', v)} />
              </Grid.Col>
              {!hidden('LEDIDPUR') && (
                <Grid.Col span={4}>
                  <LookupSelect ledgerPicker label={caption('LEDIDPUR', 'Purchase Ledger')} required={mandatory('LEDIDPUR')} value={form.ledid_pur} onChange={(v) => set('ledid_pur', v)} />
                </Grid.Col>
              )}
              {!hidden('REFNO') && (
                <Grid.Col span={4}>
                  <TextInput label={caption('REFNO', 'Ref No')} required={mandatory('REFNO')} value={form.ref_no} onChange={(e) => set('ref_no', e.currentTarget.value)} />
                </Grid.Col>
              )}
              {!hidden('REFDT') && (
                <Grid.Col span={4}>
                  <DateInput label={caption('REFDT', 'Ref Date')} required={mandatory('REFDT')} value={form.ref_date} onChange={(v) => set('ref_date', v)} />
                </Grid.Col>
              )}
              {!hidden('RMKS') && (
                <Grid.Col span={12}>
                  <TextInput label={caption('RMKS', 'Remarks')} required={mandatory('RMKS')} value={form.remarks} onChange={(e) => set('remarks', e.currentTarget.value)} />
                </Grid.Col>
              )}
            </Grid>

            <Group justify="space-between" mt="md">
              <Text size="sm" fw={600}>
                Items
              </Text>
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                Add Line
              </Button>
            </Group>
            <Table mt="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Item</Table.Th>
                  <Table.Th w={120}>UOM</Table.Th>
                  <Table.Th w={100}>{caption('PBQTY', 'Qty')}</Table.Th>
                  <Table.Th w={100}>{caption('PBRATE', 'Rate')}</Table.Th>
                  <Table.Th w={110}>{caption('PBAMT', 'Amount')}</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <MasterOptionsSelect docId={ITEM_DOC_ID} value={l.item_id} onChange={(v) => updateLine(i, { item_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <MasterOptionsSelect docId={UOM_DOC_ID} value={l.uom_id} onChange={(v) => updateLine(i, { uom_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.qty} onChange={(v) => updateLine(i, { qty: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.rate} onChange={(v) => updateLine(i, { rate: v })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>₹ {((Number(l.qty) || 0) * (Number(l.rate) || 0)).toFixed(2)}</Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" disabled={lines.length <= 1} onClick={() => removeLine(i)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Card mt="lg" radius="md" style={{ background: 'linear-gradient(120deg, #7A1F1F 0%, #5A1414 100%)' }}>
              <Group justify="space-between">
                <Text c="#F4E1A6" fw={600}>
                  Bill Value
                </Text>
                <Title order={3} c="white" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                  ₹ {totalValue.toFixed(2)}
                </Title>
              </Group>
            </Card>

            <Group justify="flex-end" mt="lg">
              <Button size="md" color="kumkum" loading={saving} onClick={onSave}>
                Save
              </Button>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={4}>
          <Card withBorder radius="lg" p="md" shadow="sm">
            <Title order={5} mb="sm" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
              Recent Bills
            </Title>
            <Stack gap={0}>
              {(recent || []).map((r, i) => (
                <div key={r.PBID}>
                  {i > 0 && <Divider my={8} />}
                  <Text size="sm" fw={600}>
                    {r.PrintPBNO}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.PartyName} · ₹{r.PBVALUE}
                  </Text>
                </div>
              ))}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
