import { ArrowUpRight } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import VoucherEntry from './VoucherEntry'

const CFG = {
  docId: 1224,
  kind: 'payments',
  title: 'Payment Voucher',
  subtitle: 'Record money paid out and post it to the ledger',
  dateKey: 'voucher_date',
  dateLabel: 'Voucher date',
  headerPrefix: 'PMTVCH',
  rowId: 'PMTVCHID',
  idKey: 'pmtvch_id',
  noKey: 'pmtvch_no',
  queryKey: 'payment-vouchers',
  list: voucherApi.listPaymentVouchers,
  create: voucherApi.createPaymentVoucher,
  amountSide: 'dr',
  totalLabel: 'Payment amount',
  recentTitle: 'Recent payments',
  emptyTitle: 'No payments yet',
  icon: ArrowUpRight,
  nav: true,
}

export default function PaymentVoucherPage() {
  return <VoucherEntry cfg={CFG} />
}
