import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Divider, Grid, Group, NumberInput, Select, Stack, Table, Text, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { Plus, Trash2 } from 'lucide-react'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as inventoryApi from '../../api/endpoints/inventory'
import LookupSelect from '../../components/LookupSelect'
import useDocFields from '../../hooks/useDocFields'
import { isFieldHidden, isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'

const DOC_ID = 1272
const GOPURAM_MARK = '/illustrations/gopuram-mark.svg'
const KOLAM_PATTERN = '/illustrations/kolam.svg'
const EMPTY_LINES = [
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
  { ac_led_id: '', dr_amt: 0, cr_amt: 0 },
]

/**
 * Purchase Voucher (DocID 1272) — confirmed zero real usage, built per
 * explicit request. Standalone Dr/Cr grid, same shape as Payment/Receipt
 * Voucher; optionally links to a Purchase Bill (which then gets its VCHID
 * filled in) via the Bill No field.
 */
export default function PurchaseVoucherPage() {
  const queryClient = useQueryClient()
  const [voucherDate, setVoucherDate] = useState(new Date())
  const [crPeriod, setCrPeriod] = useState(0)
  const [pbId, setPbId] = useState('')
  const [lines, setLines] = useState(EMPTY_LINES)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  const { data: recent, refetch } = useQuery({ queryKey: ['purchase-vouchers', 'recent'], queryFn: () => inventoryApi.listPurchaseVouchers({ top: 15 }) })
  const { data: bills } = useQuery({ queryKey: ['purchase-bills', 'unvouchered'], queryFn: () => inventoryApi.listPurchaseBills({ top: 100 }) })
  const unvoucheredBills = (bills || []).filter((b) => !b.VCHID)
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = { CRPERIOD: crPeriod }
  const hidden = (code) => isFieldHidden(fieldMeta[code], codeValues)
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  function updateLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setLines((ls) => [...ls, { ac_led_id: '', dr_amt: 0, cr_amt: 0 }])
  }
  function removeLine(i) {
    setLines((ls) => (ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls))
  }

  const totalDr = lines.reduce((s, l) => s + (Number(l.dr_amt) || 0), 0)
  const totalCr = lines.reduce((s, l) => s + (Number(l.cr_amt) || 0), 0)
  const balanced = Math.round(totalDr * 100) === Math.round(totalCr * 100) && totalDr > 0

  async function onSave() {
    if (!balanced) {
      notifications.show({ message: 'Debit and Credit totals are NOT matching!', color: 'red' })
      return
    }
    if (lines.some((l) => !l.ac_led_id)) {
      notifications.show({ message: 'Every line needs an account head', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const body = {
        voucher_date: voucherDate.toISOString().slice(0, 10),
        cr_period: Number(crPeriod) || 0,
        pb_id: pbId ? Number(pbId) : null,
        lines: lines
          .filter((l) => Number(l.dr_amt) || Number(l.cr_amt))
          .map((l) => ({ ac_led_id: Number(l.ac_led_id), dr_amt: Number(l.dr_amt) || 0, cr_amt: Number(l.cr_amt) || 0 })),
      }
      const result = await inventoryApi.createPurchaseVoucher(body)
      setLastSaved(result)
      notifications.show({ message: 'Data saved successfully!', color: 'teal' })
      setLines(EMPTY_LINES)
      setPbId('')
      queryClient.invalidateQueries({ queryKey: ['purchase-vouchers'] })
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
              Purchase Voucher
            </Title>
            <Text size="sm" c="dimmed">
              Post the accounting for a purchase, optionally linked to a bill
            </Text>
          </div>
        </Group>
        {lastSaved && (
          <Badge color="teal" size="lg" radius="sm">
            Saved {lastSaved.purvch_no}
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
              <Grid.Col span={4}>
                <DateInput label="Voucher Date" value={voucherDate} onChange={setVoucherDate} />
              </Grid.Col>
              {!hidden('CRPERIOD') && (
                <Grid.Col span={4}>
                  <NumberInput label={caption('CRPERIOD', 'Credit Period (days)')} required={mandatory('CRPERIOD')} value={crPeriod} onChange={setCrPeriod} />
                </Grid.Col>
              )}
              <Grid.Col span={4}>
                <Select
                  label="Link Purchase Bill (optional)"
                  placeholder="Standalone voucher"
                  clearable
                  data={unvoucheredBills.map((b) => ({ value: String(b.PBID), label: `${b.PrintPBNO} — ${b.PartyName}` }))}
                  value={pbId || null}
                  onChange={(v) => setPbId(v || '')}
                />
              </Grid.Col>
            </Grid>

            <Group justify="space-between" mt="md">
              <Text size="sm" fw={600}>
                Account Heads
              </Text>
              <Button size="xs" variant="light" color="kumkum" leftSection={<Plus size={14} />} onClick={addLine}>
                Add Line
              </Button>
            </Group>
            <Table mt="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Account Head</Table.Th>
                  <Table.Th w={140}>Debit</Table.Th>
                  <Table.Th w={140}>Credit</Table.Th>
                  <Table.Th w={40}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <LookupSelect ledgerPicker label="" value={l.ac_led_id} onChange={(v) => updateLine(i, { ac_led_id: v })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.dr_amt} onChange={(v) => updateLine(i, { dr_amt: v, cr_amt: v ? 0 : l.cr_amt })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput value={l.cr_amt} onChange={(v) => updateLine(i, { cr_amt: v, dr_amt: v ? 0 : l.dr_amt })} decimalScale={2} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="subtle" disabled={lines.length <= 2} onClick={() => removeLine(i)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {!balanced && (
              <Text size="xs" c="red" mt={4}>
                Debit and Credit totals are NOT matching!
              </Text>
            )}

            <Card mt="lg" radius="md" style={{ background: 'linear-gradient(120deg, #7A1F1F 0%, #5A1414 100%)' }}>
              <Group justify="space-between">
                <Text c="#F4E1A6" fw={600}>
                  Total Dr / Cr
                </Text>
                <Title order={3} c="white" style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                  ₹ {totalDr.toFixed(2)} / ₹ {totalCr.toFixed(2)}
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
              Recent Vouchers
            </Title>
            <Stack gap={0}>
              {(recent || []).map((r, i) => (
                <div key={r.PURVCHID}>
                  {i > 0 && <Divider my={8} />}
                  <Text size="sm" fw={600}>
                    {r.PrintPURVCHNO}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Credit period {r.CRPERIOD} days
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
