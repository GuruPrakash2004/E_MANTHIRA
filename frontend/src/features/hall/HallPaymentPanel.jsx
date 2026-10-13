import { useState } from 'react'
import { ActionIcon, Badge, Button, Divider, Group, Modal, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { Receipt, Trash2 } from 'lucide-react'
import dayjs from 'dayjs'
import { useConfirm } from '../../components/ui/ConfirmProvider'
import { formatINR } from '../../utils/format'
import { notifications } from '@mantine/notifications'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as hallApi from '../../api/endpoints/hall'
import LookupSelect from '../../components/LookupSelect'
import useDocFields from '../../hooks/useDocFields'
import { isFieldMandatory, fieldCaption } from '../../utils/docFieldConditions'

const DOC_ID = 1281
const PAY_MODES = ['Cash', 'UPI', 'Cheque', 'Card']
const RECEIPT_TYPES = ['ADV', 'Partial', 'Final']

/**
 * Hall Booking's Advance/Partial/Final payment flow — the backend
 * (hall_service.add_payment / get, already validated earlier this session)
 * existed with no frontend UI at all until now. Opens for one hb_id, shows
 * the booking summary + payments timeline, and submits new payments.
 */
export default function HallPaymentPanel({ hbId, onClose }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [amount, setAmount] = useState(0)
  const [mode, setMode] = useState('Cash')
  const [reference, setReference] = useState('')
  const [receiptType, setReceiptType] = useState('ADV')
  const [ledgerId, setLedgerId] = useState('')
  const [cashBankLedgerId, setCashBankLedgerId] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: booking, refetch } = useQuery({
    queryKey: ['hall-booking', hbId],
    queryFn: () => hallApi.getBooking(hbId),
    enabled: Boolean(hbId),
  })

  const balance = Number(booking?.BALAMT) || 0
  const isFinalAmount = Math.abs(Number(amount) - balance) < 0.005

  // UtlDocDsgrFlds (DocID 1281): PAYMNTMODE/REFNO/LEDGER/LEDID are the
  // advance-payment fields on this doc — same codes `add_payment()` writes
  // server-side. PAYMNTMODE specifically is the ADV stage's own payment-mode
  // column (Partial writes PAYMODE2, Final writes PAYMODE — different
  // columns the metadata has no REFNO-mandatory rule tied to), so it's only
  // populated here when receiptType is actually 'ADV' — otherwise REFNO's
  // `#PAYMNTMODE#='UPI'` rule would incorrectly fire for Partial/Final too,
  // which the backend does not enforce (hall.py's add_payment() is
  // explicitly ADV-only for this check).
  const { byCode: fieldMeta } = useDocFields(DOC_ID)
  const codeValues = { PAYMNTMODE: receiptType === 'ADV' ? mode : '', REFNO: reference, LEDGER: ledgerId, LEDID: cashBankLedgerId }
  const mandatory = (code) => isFieldMandatory(fieldMeta[code], codeValues)
  const caption = (code, fallback) => fieldCaption(fieldMeta[code], fallback)

  async function onDeleteReceipt(r) {
    if (!(await confirm({ title: 'Delete this receipt?', message: `Receipt No. ${r.PrintRCPTVCHNO} will be deleted and the booking balance restored.`, confirmLabel: 'Delete' }))) return
    try {
      await hallApi.deleteReceipt(hbId, r.RCPTVCHID)
      notifications.show({ message: 'Receipt Deleted!', color: 'teal' })
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
      refetch()
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Could not delete the receipt', color: 'red' })
    }
  }

  async function onSubmit() {
    if (Number(amount) <= 0) {
      notifications.show({ message: 'Receipt Amt cannot be Zero!', color: 'red' })
      return
    }
    if (Number(amount) > balance + 0.005) {
      notifications.show({ message: 'Receipt Amt cannot be greater than Pending Amt!', color: 'red' })
      return
    }
    if (isFinalAmount && receiptType !== 'Final') {
      notifications.show({ message: 'Receipt type should be Final if balance amt is completely selected!', color: 'red' })
      return
    }
    if (receiptType === 'Final' && !isFinalAmount) {
      notifications.show({ message: 'Receipt Amt should be equal to pending amt if receipt type is Final.', color: 'red' })
      return
    }
    if (mandatory('REFNO') && !reference.trim()) {
      notifications.show({ message: `${caption('REFNO', 'Reference Number')} is mandatory for ${mode} payment`, color: 'red' })
      return
    }
    if (!ledgerId || !cashBankLedgerId) {
      notifications.show({ message: 'Ledger name cannot be blank!', color: 'red' })
      return
    }
    setSaving(true)
    try {
      const result = await hallApi.addPayment(hbId, {
        amount: Number(amount),
        mode,
        reference: reference || null,
        receipt_type: receiptType,
        ledger_id: Number(ledgerId),
        cash_bank_ledger_id: Number(cashBankLedgerId),
      })
      notifications.show({ message: `Receipt ${result.receipt_no} recorded`, color: 'teal' })
      setAmount(0)
      setReference('')
      refetch()
      queryClient.invalidateQueries({ queryKey: ['hall-bookings'] })
    } catch (err) {
      notifications.show({ message: err?.response?.data?.detail || 'Payment failed', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened={Boolean(hbId)} onClose={onClose} size="lg" radius="lg" title={null}>
      {booking && (
        <Stack>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={4} style={{ fontFamily: 'Marcellus, Georgia, serif' }}>
                {booking.PrintHBNO}
              </Title>
              <Text size="sm" c="dimmed">
                {booking.HALLNAME || `Hall #${booking.HALLID}`} · {booking.NMEOFFUNC}
              </Text>
            </div>
            <Badge size="lg" color={balance > 0 ? 'orange' : 'teal'} radius="sm">
              {balance > 0 ? `Balance ₹${balance.toFixed(2)}` : 'Fully paid'}
            </Badge>
          </Group>

          <Group gap="xl">
            <Text size="sm">
              Net Pay: <b>₹{Number(booking.NETPAY || 0).toFixed(2)}</b>
            </Text>
            <Text size="sm">
              Advance: <b>₹{Number(booking.ADV || 0).toFixed(2)}</b>
            </Text>
          </Group>

          <Divider label="Receipt Info" labelPosition="left" />
          <Group gap="xl" wrap="wrap">
            <Text size="sm">
              Total Amt: <b>{formatINR(booking.NETPAY || 0)}</b>
            </Text>
            <Text size="sm">
              Receipt Amt: <b>{formatINR((booking.receipts || []).filter((r) => r.Cancelled !== 'Y').reduce((t, r) => t + Number(r.TOTDR || 0), 0))}</b>
            </Text>
            <Text size="sm">
              Pending Amt: <b>{formatINR(booking.BALAMT || 0)}</b>
            </Text>
          </Group>
          <Table.ScrollContainer minWidth={520}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Receipt No</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Voucher type</Table.Th>
                  <Table.Th>Narration</Table.Th>
                  <Table.Th w={48} aria-label="Delete" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(booking.receipts || []).length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text size="xs" c="dimmed" ta="center" py="sm">
                        No payments recorded yet
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {(booking.receipts || []).map((r) => (
                  <Table.Tr key={r.RCPTVCHID} style={{ opacity: r.Cancelled === 'Y' ? 0.5 : 1 }}>
                    <Table.Td>{r.PrintRCPTVCHNO}</Table.Td>
                    <Table.Td className="vt-num">{r.RCPTVCHDate ? dayjs(r.RCPTVCHDate).format('DD/MM/YYYY') : ''}</Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={r.RCPTTYPE === 'Final' ? 'teal' : 'saffron'}>
                        {r.RCPTTYPE || '-'}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right" className="vt-num">
                      {formatINR(r.TOTDR || 0)}
                    </Table.Td>
                    <Table.Td>{r.VCHTYP}</Table.Td>
                    <Table.Td>{r.NARR}</Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" size={32} aria-label={`Delete receipt ${r.PrintRCPTVCHNO}`} onClick={() => onDeleteReceipt(r)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          {balance > 0 && (
            <>
              <Divider label="Record a Payment" labelPosition="left" />
              <Group grow>
                <NumberInput label="Amount" value={amount} onChange={setAmount} decimalScale={2} max={balance} />
                <Select label={caption('PAYMNTMODE', 'Mode')} data={PAY_MODES} value={mode} onChange={setMode} />
              </Group>
              <Group grow>
                <Select label="Receipt Type" data={RECEIPT_TYPES} value={receiptType} onChange={setReceiptType} />
                <TextInput
                  label={caption('REFNO', 'Reference No')}
                  required={mandatory('REFNO')}
                  value={reference}
                  onChange={(e) => setReference(e.currentTarget.value)}
                />
              </Group>
              <Group grow>
                <LookupSelect docId={DOC_ID} field="LEDGER" label={caption('LEDGER', 'Income Ledger')} required={mandatory('LEDGER')} value={ledgerId} onChange={setLedgerId} />
                <LookupSelect docId={DOC_ID} field="LEDID" label={caption('LEDID', 'Cash / Bank Account')} required={mandatory('LEDID')} value={cashBankLedgerId} onChange={setCashBankLedgerId} />
              </Group>
              <Group justify="flex-end">
                <Button leftSection={<Receipt size={16} />} color="kumkum" loading={saving} onClick={onSubmit}>
                  Record Payment
                </Button>
              </Group>
            </>
          )}
        </Stack>
      )}
    </Modal>
  )
}
