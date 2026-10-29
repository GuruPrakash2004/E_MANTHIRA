import { ArrowUpRight } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import VoucherEntry from './VoucherEntry'

const CFG = {
  docId: 1254,
  kind: 'journals',
  title: 'Journal Voucher',
  subtitle: 'Adjust balances between ledger accounts (non-cash entries)',
  dateKey: 'voucher_date',
  dateLabel: 'Voucher date',
  headerPrefix: 'JNRVCH',
  rowId: 'JNRVCHID',
  idKey: 'jnrvch_id',
  noKey: 'jnrvch_no',
  queryKey: 'journal-vouchers',
  list: voucherApi.listJournalVouchers,
  create: voucherApi.createJournalVoucher,
  update: voucherApi.updateJournalVoucher,
  cancel: voucherApi.cancelJournalVoucher,
  remove: voucherApi.deleteJournalVoucher,
  amountSide: 'dr',
  totalLabel: 'Journal amount',
  recentTitle: 'Recent journals',
  emptyTitle: 'No journals yet',
  icon: ArrowUpRight,
  nav: true,
}

export default function JournalVoucherPage() {
  return <VoucherEntry cfg={CFG} />
}
