import { ArrowLeftRight } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import VoucherEntry from './VoucherEntry'

const KIND = 'credit-notes'
const CFG = {
  docId: 1250,
  kind: KIND,
  title: 'Credit Note',
  subtitle: 'Record a credit to an account and post it to the ledger',
  dateKey: 'voucher_date',
  dateLabel: 'Voucher date',
  headerPrefix: 'CRDNT',
  rowId: 'ID',
  rowNoKey: 'PrintNO',
  idKey: 'voucher_id',
  noKey: 'voucher_no',
  queryKey: 'credit-notes',
  list: (params) => voucherApi.listGenVouchers(KIND, params),
  create: (body) => voucherApi.createGenVoucher(KIND, body),
  update: (id, body) => voucherApi.updateGenVoucher(KIND, id, body),
  cancel: (id, reason) => voucherApi.cancelGenVoucher(KIND, id, reason),
  remove: (id) => voucherApi.deleteGenVoucher(KIND, id),
  amountSide: 'dr',
  totalLabel: 'Credit note amount',
  recentTitle: 'Recent credit notes',
  emptyTitle: 'No credit notes yet',
  icon: ArrowLeftRight,
  nav: true,
}

export default function CreditNotePage() {
  return <VoucherEntry cfg={CFG} />
}
