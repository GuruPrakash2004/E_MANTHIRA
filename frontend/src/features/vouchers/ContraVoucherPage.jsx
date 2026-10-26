import { ArrowLeftRight } from 'lucide-react'
import * as voucherApi from '../../api/endpoints/voucher'
import VoucherEntry from './VoucherEntry'

const KIND = 'contra'
const CFG = {
  docId: 1253,
  kind: KIND,
  title: 'Contra Voucher',
  subtitle: 'Move money between cash and bank accounts',
  dateKey: 'voucher_date',
  dateLabel: 'Voucher date',
  headerPrefix: 'CNTVCH',
  rowId: 'ID',
  rowNoKey: 'PrintNO',
  idKey: 'voucher_id',
  noKey: 'voucher_no',
  queryKey: 'contra-vouchers',
  list: (params) => voucherApi.listGenVouchers(KIND, params),
  create: (body) => voucherApi.createGenVoucher(KIND, body),
  amountSide: 'dr',
  totalLabel: 'Contra amount',
  recentTitle: 'Recent contra vouchers',
  emptyTitle: 'No contra vouchers yet',
  icon: ArrowLeftRight,
  nav: true,
}

export default function ContraVoucherPage() {
  return <VoucherEntry cfg={CFG} />
}
