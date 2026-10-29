import { ArrowLeftRight } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import VoucherEntry from './VoucherEntry'

const KIND = 'debit-notes'
const CFG = {
  docId: 1252,
  kind: KIND,
  title: 'Debit Note',
  subtitle: 'Record a debit to an account and post it to the ledger',
  dateKey: 'voucher_date',
  dateLabel: 'Voucher date',
  headerPrefix: 'DBTNT',
  rowId: 'ID',
  rowNoKey: 'PrintNO',
  idKey: 'voucher_id',
  noKey: 'voucher_no',
  queryKey: 'debit-notes',
  list: (params) => voucherApi.listGenVouchers(KIND, params),
  create: (body) => voucherApi.createGenVoucher(KIND, body),
  update: (id, body) => voucherApi.updateGenVoucher(KIND, id, body),
  cancel: (id, reason) => voucherApi.cancelGenVoucher(KIND, id, reason),
  remove: (id) => voucherApi.deleteGenVoucher(KIND, id),
  amountSide: 'dr',
  totalLabel: 'Debit note amount',
  recentTitle: 'Recent debit notes',
  emptyTitle: 'No debit notes yet',
  icon: ArrowLeftRight,
  nav: true,
}

export default function DebitNotePage() {
  return <VoucherEntry cfg={CFG} />
}
