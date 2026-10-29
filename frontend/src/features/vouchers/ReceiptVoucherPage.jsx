import { ArrowDownLeft } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import VoucherEntry from './VoucherEntry'

const CFG = {
  docId: 1248,
  kind: 'receipts',
  title: 'Receipt Voucher',
  subtitle: 'Record money received and post it to the ledger',
  dateKey: 'receipt_date',
  dateLabel: 'Receipt date',
  headerPrefix: 'RCPTVCH',
  rowId: 'RCPTVCHID',
  idKey: 'receipt_id',
  noKey: 'receipt_no',
  queryKey: 'receipt-vouchers',
  list: voucherApi.listReceiptVouchers,
  create: voucherApi.createReceiptVoucher,
  update: voucherApi.updateReceiptVoucher,
  cancel: voucherApi.cancelReceiptVoucher,
  remove: voucherApi.deleteReceiptVoucher,
  amountSide: 'cr',
  totalLabel: 'Receipt amount',
  recentTitle: 'Recent receipts',
  emptyTitle: 'No receipts yet',
  icon: ArrowDownLeft,
  nav: true,
}

export default function ReceiptVoucherPage() {
  return <VoucherEntry cfg={CFG} />
}
