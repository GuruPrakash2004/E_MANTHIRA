// System-level fixtures: menu tree + rights, UtlDocDsgrFlds-style field metadata, global settings, company and
// financial years, print formats, report catalog / customised reports, bulk-update definitions.
import { iso } from './util'

// ---------------------------------------------------------------- menu
// caption strings match AppShellLayout's CAPTION_ROUTE exactly so every sidebar link goes somewhere real.
const M = (id, caption, type, doc_id = null, group = '') => ({ menu_item_id: id, caption, type, doc_id, form_key: '', group, shortcut: '', rights: '111111111111', can_view: true })
export const DEMO_MENU = [
  M(1, 'Seva Entry', 'Transactions', 1263),
  M(2, 'Donation Reciept Entry', 'Transactions', 1261),
  M(3, 'Hall Booking', 'Transactions', 1281),
  M(4, 'Hall Booking Entry', 'Transactions', 1280),
  M(5, 'Panchanga', 'Transactions'),
  M(6, 'Hall Status', 'Transactions'),
  M(7, 'Payment Voucher', 'Vouchers', 1224),
  M(8, 'Receipt Voucher', 'Vouchers', 1248),
  M(20, 'Sannidhi Master', 'Masters', 1255),
  M(21, 'Seva Master', 'Masters', 1265),
  M(22, 'Gothra Master', 'Masters', 1257),
  M(23, 'Nakshatra Master', 'Masters', 1258),
  M(24, 'Rashi Master', 'Masters', 1279),
  M(25, 'Hall Master', 'Masters', 1282),
  M(26, 'Event Master', 'Masters', 1266),
  M(27, 'Ledger Master', 'Masters', 1204),
  M(28, 'Ledger Group Master', 'Masters', 1205),
  M(29, 'Bank Master', 'Masters', 1223),
  M(40, 'Subsidiary Reports', 'Reports'),
  M(41, 'Customised Reports...', 'Reports'),
  M(42, 'Hall Booking With Voucher Detail Report', 'Reports'),
  M(43, 'PDF Generator', 'Reports'),
  M(50, 'General Ledger', 'Ac-Reports'),
  M(60, 'Display in Browser', 'Utilities'),
  M(61, 'Import from Excel', 'Utilities'),
  M(62, 'Audit Trail', 'Utilities'),
  M(63, 'Global Settings...', 'Utilities'),
  M(64, 'Security', 'Utilities'),
  M(65, 'Bulk Master Update', 'Utilities'),
]

// ---------------------------------------------------------------- UtlDocDsgrFlds
let order = 0
const fld = (docId, code, caption, o = {}) => ({
  DocID: docId, FldCode: code, FldCaption: caption, FldSection: o.section || 'Header', FldOrderBy: (order += 10), FldDataType: o.type || 'Text', FldDataWidth: o.width || 0, FldNumDecimals: o.decimals || 0,
  FldBlnMandatory: o.mandatory ? 'Y' : 'N', FLdBlnHide: o.hideWhen ? 'Y' : 'N', FldHideCompareVal: o.hideWhen?.[0] || '', FldHideOperator: o.hideWhen?.[1] || '', FldHideWithVal: o.hideWhen?.[2] || '',
  FldMndtryCompareVal: o.mandatoryWhen?.[0] || '', FldMndtryOperator: o.mandatoryWhen?.[1] || '', FldMndtryWithVal: o.mandatoryWhen?.[2] || '',
  FldBlnReadOnly: 'N', FldBlnComboData: o.combo ? 'Y' : 'N', FldCmbTblName: o.combo || '', FldNumStringListContent: o.list || '', FldUseDefault: o.def ? 'Y' : 'N', FldDefStdDefault: o.def || '',
})
const PAYMENT_LIST = 'Cash|Cheque|Card|UPI|Online Transfer'

export function buildDocFields() {
  order = 0
  const f = {}
  f[1263] = [
    fld(1263, 'SANNIDHIID', 'Sannidhi', { mandatory: true, combo: 'MstSANNIDHI' }),
    fld(1263, 'SVAID', 'Seva', { mandatory: true, combo: 'MstSVA' }),
    fld(1263, 'MOBNUM', 'Mobile Number', { mandatory: true, width: 10 }),
    fld(1263, 'KNAME', 'Devotee Name', { mandatory: true }),
    fld(1263, 'PAYMENT', 'Payment Mode', { list: PAYMENT_LIST, def: 'Cash' }),
    fld(1263, 'BANKNAME', 'Bank Name', { hideWhen: ['#PAYMENT#', '<>', 'Cheque'] }),
    fld(1263, 'CHQNO', 'Cheque No', { hideWhen: ['#PAYMENT#', '<>', 'Cheque'], mandatoryWhen: ['#PAYMENT#', '=', 'Cheque'] }),
    fld(1263, 'CHQDATE', 'Cheque Date', { type: 'Date', hideWhen: ['#PAYMENT#', '<>', 'Cheque'] }),
    fld(1263, 'REFNO', 'Reference No', { hideWhen: ['#PAYMENT#', '=', 'Cash'] }),
    fld(1263, 'PRASADAM', 'Prasadam Required', { list: 'Yes|No', def: 'No' }),
    fld(1263, 'SEVATIME', 'Preferred Seva Time', { list: 'Morning|Noon|Evening' }),
  ]
  f[1261] = [
    fld(1261, 'DONOR', 'Donor Name', { mandatory: true }),
    fld(1261, 'CONTACTNO', 'Contact Number', { mandatory: true, width: 10 }),
    fld(1261, 'PAYMNTMODE', 'Payment Mode', { list: PAYMENT_LIST, def: 'Cash' }),
    fld(1261, 'AMOUNT', 'Amount', { mandatory: true, type: 'Numeric', decimals: 2 }),
    fld(1261, 'CHEQUENO', 'Cheque No', { hideWhen: ['#PAYMNTMODE#', '<>', 'Cheque'] }),
    fld(1261, 'BANKNAME', 'Bank Name', { hideWhen: ['#PAYMNTMODE#', '<>', 'Cheque'] }),
    fld(1261, 'PURPOSE', 'Purpose of Donation', { list: 'General|Annadana|Temple Renovation|Gosala|Vidyadana' }),
    fld(1261, 'RECEIVEDBY', 'Received By'),
  ]
  f[1281] = [
    fld(1281, 'HALLID', 'Name of the Hall / Room', { mandatory: true, combo: 'MstHALL' }),
    fld(1281, 'NMEOFFUNC', 'Name of Function', { mandatory: true }),
    fld(1281, 'CONTACTNO', 'Contact Number', { mandatory: true }),
    fld(1281, 'AMOUNT', 'Hall Charges Amount', { mandatory: true, type: 'Numeric', decimals: 2 }),
    fld(1281, 'GUESTS', 'Expected Guests', { type: 'Numeric' }),
    fld(1281, 'CATERING', 'Catering Arrangement', { list: 'Own|Temple kitchen|Outside caterer' }),
  ]
  f[1280] = [fld(1280, 'NMEOFFUNC', 'Name of Function', { mandatory: true }), fld(1280, 'CONTACTNO', 'Contact Number', { mandatory: true }), fld(1280, 'PAYMNTMODE', 'Payment Mode', { list: PAYMENT_LIST, def: 'Cash' })]
  f[1224] = [
    fld(1224, 'VCHTYP', 'Voucher Type', { list: 'Cash|Bank|Card', def: 'Cash' }),
    fld(1224, 'NARR', 'Narration', { mandatory: true }),
    fld(1224, 'CHQDDNO', 'Cheque /DD No', { section: 'Footer', hideWhen: ['#VCHTYP#', '<>', 'Bank'] }),
    fld(1224, 'CHQDT', 'Cheque Date', { section: 'Footer', type: 'Date', hideWhen: ['#VCHTYP#', '<>', 'Bank'] }),
    fld(1224, 'CHQAMT', 'Cheque/DD Amount', { section: 'Footer', hideWhen: ['#VCHTYP#', '<>', 'Bank'] }),
    fld(1224, 'CHQNO', 'Cheque No', { section: 'Footer', hideWhen: ['#VCHTYP#', '<>', 'Bank'] }),
    fld(1224, 'BANK', 'Bank', { section: 'Footer', combo: 'MstBANK', hideWhen: ['#VCHTYP#', '<>', 'Bank'] }),
    fld(1224, 'CARDNO', 'Card No', { section: 'Footer', hideWhen: ['#VCHTYP#', '<>', 'Card'] }),
    fld(1224, 'CRDAMT', 'Card Amount', { section: 'Footer', type: 'Numeric', decimals: 2, hideWhen: ['#VCHTYP#', '<>', 'Card'] }),
    fld(1224, 'BILLREF', 'Bill / Invoice Reference'),
  ]
  f[1248] = f[1224].map((x) => ({ ...x, DocID: 1248 }))
  f[1268] = [fld(1268, 'LOCID', 'Location', { mandatory: true }), fld(1268, 'RMKS', 'Remarks')]
  f[1270] = [fld(1270, 'LOCID', 'Location', { mandatory: true }), fld(1270, 'RMKS', 'Remarks')]
  f[1271] = [fld(1271, 'LOCID', 'Location', { mandatory: true }), fld(1271, 'LEDIDPUR', 'Purchase Ledger', { mandatory: true, combo: 'MstLED' }), fld(1271, 'RMKS', 'Remarks')]
  f[1272] = [fld(1272, 'NARR', 'Narration')]
  f[1149] = [fld(1149, 'BOMItemID', 'Finished Item', { mandatory: true })]
  return f
}

export const DOC_NAMES = { 1263: 'Seva Entry', 1261: 'Donation Reciept Entry', 1281: 'Hall Booking', 1280: 'Hall Booking Entry', 1224: 'Payment Voucher', 1248: 'Receipt Voucher' }

// ---------------------------------------------------------------- settings / company
const S = (group, name, caption, value, o = {}) => ({ group, name, caption, value, remarks: o.remarks || '', hidden: !!o.hidden, dropdown_list: o.list || '', mandatory: !!o.mandatory, data_type: o.type || '' })
export const DEMO_SETTINGS = [
  S('General', 'TrustNameOnReceipts', 'Trust name printed on receipts', 'Akhila Bharatha Sri Raghavendra Seva Samithi Trust', { mandatory: true }),
  S('General', 'ReceiptFooter', 'Receipt footer text', 'Thank you. Sri Raghavendra Swamy anugraha be with you and your family.'),
  S('General', 'DefaultPaymentMode', 'Default payment mode', 'Cash', { list: PAYMENT_LIST }),
  S('Seva', 'AutoRcptFromSeva', 'Create receipt automatically from Seva', 'Y', { remarks: 'Y posts the receipt and ledger entries when a Seva is saved.' }),
  S('Seva', 'AllowBackDatedSeva', 'Allow back-dated Seva entry', 'N'),
  S('Seva', 'MaxSevaDates', 'Maximum dates per Seva', '12'),
  S('Hall', 'HallGstPercent', 'GST on hall charges (%)', '18'),
  S('Hall', 'DefaultSecurityDeposit', 'Default security deposit', '5000'),
  S('Printing', 'PrintAfterSave', 'Open print dialog after save', 'Y'),
  S('Printing', 'ThermalPrinterName', 'Counter thermal printer', 'EPSON TM-T82 Receipt'),
  S('Printing', 'ReceiptCopies', 'Copies per receipt', '2'),
  S('Display', 'WebDisplayURL', 'Seva display board address', 'http://192.168.1.49/display', { remarks: 'Shown on the counter TV.' }),
  S('Display', 'DisplayRefreshSeconds', 'Display refresh (seconds)', '60'),
  S('Security', 'PasswordExpiryDays', 'Password expiry (days)', '90'),
  S('Security', 'SessionTimeoutMinutes', 'Session timeout (minutes)', '30'),
  S('Security', 'LegacyFlagX', 'Internal flag (hidden from staff)', 'N', { hidden: true }),
]

export const DEMO_COMPANY = {
  CompName: 'Akhila Bharatha Sri Raghavendra Seva Samithi Trust', Address1: 'Sri Raghavendra Swamy Mutt Premises', Address2: 'Gavipuram Extension', Address3: 'Basavanagudi', Address4: 'Bengaluru, Karnataka', Address5: 'PIN 560019',
  TELNO: '080-26612345', MOBNO: '9845000001', EMAIL: 'office@sriraghavendramutt.example', WEB: 'www.sriraghavendramutt.example', PANNO: 'AAATA1234F', GSTNO: '29AAATA1234F1Z5', CINNO: 'U85300KA1998NPL012345', Custcode: 'SLV-0042', DashBoardLink: '',
}
export const DEMO_FYS = [
  { yrFdate: '2026-04-01', yrTdate: '2027-03-31', Active: 'Y' },
  { yrFdate: '2025-04-01', yrTdate: '2026-03-31', Active: 'N' },
  { yrFdate: '2024-04-01', yrTdate: '2025-03-31', Active: 'N' },
]
export const DEMO_DB_SETTINGS = { db_engine: 'mssql', db_driver_odbc: 'ODBC Driver 17 for SQL Server', db_server: '192.168.1.49', db_port: 1433, db_name: 'vTmplSLV', db_user: 'sa', db_trust_cert: true, password_set: true }

// ---------------------------------------------------------------- print
const OPTS = {
  1263: [['Seva Receipt A5', 'SevaReceipt_A5.rpt', true], ['Seva Receipt Thermal', 'SevaReceipt_Thermal.rpt', false], ['Seva Receipt with QR', 'SevaReceipt_QR.rpt', false]],
  1261: [['Donation Receipt A5', 'DonationReceipt_A5.rpt', true], ['Donation Receipt 80G', 'DonationReceipt_80G.rpt', false]],
  1281: [['Hall Booking Receipt', 'HallBooking.rpt', true], ['Hall Agreement', 'HallAgreement.rpt', false]],
  1224: [['Payment Voucher', 'PaymentVoucher.rpt', true]],
  1248: [['Receipt Voucher', 'ReceiptVoucher.rpt', true]],
}
export const DEMO_PRINT_OPTIONS_BY_DOC = (docId) =>
  (OPTS[docId] || [['Standard', 'Standard.rpt', true]]).map((o, i) => ({ option_name: o[0], rpt_file: o[1], available: i < 2 || docId !== 1263, default: o[2], preferred: i === 0, direct_printer_name: i === 1 ? 'EPSON TM-T82 Receipt' : null, copies: 1, after_save_action: '' }))
export const DEMO_PRINT_OPTIONS_ALL = Object.entries(OPTS).flatMap(([docId, list]) =>
  list.map((o, i) => ({ DocID: Number(docId), OptionName: o[0], MenuItemCaption: DOC_NAMES[docId] || 'Document', CrptFileName: o[1], DefaultPrint: o[2] ? 'Y' : 'N', DirectPrinterName: i === 1 ? 'EPSON TM-T82 Receipt' : '', NoOfCopies: i === 1 ? 2 : 1, AfterSaveAction: i === 0 ? 'Preview' : '', InActive: 'N' }))
)

// ---------------------------------------------------------------- report catalog + customised reports
export const DEMO_REPORT_CATALOG = [
  { rpt_id: 1, name: 'Complete Day Summary', group: 'Daily', form_name: 'frmRptCompDaySmry' },
  { rpt_id: 2, name: 'Detailed Collection Report', group: 'Collections', form_name: 'frmRptDtlColn' },
  { rpt_id: 3, name: 'Donation (Kanike) Report', group: 'Donations', form_name: 'frmRptDonation' },
  { rpt_id: 4, name: 'Seva Issue / Schedule', group: 'Sevas', form_name: 'frmRptSevaIssue' },
  { rpt_id: 5, name: 'Stock Valuation', group: 'Inventory', form_name: 'frmRptStockVal' },
  { rpt_id: 6, name: 'Hall Occupancy Summary', group: 'Hall', form_name: 'frmRptHallOcc' },
]
export const DEMO_CUSTOM_REPORTS = [{ crid: 1, name: 'Devotee list with Gothra and Nakshatra' }, { crid: 2, name: 'Seva income by Sannidhi' }]
export const DEMO_CUSTOM_DEFS = {
  1: { crid: 1, name: DEMO_CUSTOM_REPORTS[0].name, hdr_table: 'TrnHdrSEVA', fields: [
    { table: 'TrnHdrSEVA', code: 'KNAME', caption: 'Devotee', filter_req: true, data_type: 'TEXT' }, { table: 'TrnHdrSEVA', code: 'MOBNUM', caption: 'Mobile', filter_req: false, data_type: 'TEXT' },
    { table: 'MstGOTHRA', code: 'GOTHRANAME', caption: 'Gothra', filter_req: false, data_type: 'TEXT' }, { table: 'MstNAKSHATRA', code: 'NAKSHATRANAME', caption: 'Nakshatra', filter_req: false, data_type: 'TEXT' },
    { table: 'TrnHdrSEVA', code: 'SEVADate', caption: 'Seva Date', filter_req: true, data_type: 'DATE' },
  ] },
  2: { crid: 2, name: DEMO_CUSTOM_REPORTS[1].name, hdr_table: 'TrnHdrSEVA', fields: [
    { table: 'MstSANNIDHI', code: 'SANNIDHINAME', caption: 'Sannidhi', filter_req: true, data_type: 'TEXT' }, { table: 'MstSVA', code: 'SVANAME', caption: 'Seva', filter_req: false, data_type: 'TEXT' },
    { table: 'TrnHdrSEVA', code: 'TotalAmt', caption: 'Amount', filter_req: false, data_type: 'NUMERIC' },
  ] },
}

// ---------------------------------------------------------------- bulk update
export const DEMO_BULK_DEFS = [
  { row_id: 1, doc_name: 'Seva Master (amounts)', table: 'MstSVA', key_field: 'SVAID', columns: [
    { name: 'SVAID', visible: true, editable: false, data_type: 'NUMERIC' }, { name: 'SVACODE', visible: true, editable: false, data_type: 'TEXT' }, { name: 'SVANAME', visible: true, editable: false, data_type: 'TEXT' },
    { name: 'AMT', visible: true, editable: true, data_type: 'NUMERIC' }, { name: 'InActive', visible: true, editable: true, data_type: 'TEXT' },
  ], filters: [{ name: 'SVANAME' }] },
  { row_id: 2, doc_name: 'Gothra Master (active flag)', table: 'MstGOTHRA', key_field: 'GOTHRAID', columns: [
    { name: 'GOTHRAID', visible: true, editable: false, data_type: 'NUMERIC' }, { name: 'GOTHRANAME', visible: true, editable: false, data_type: 'TEXT' }, { name: 'InActive', visible: true, editable: true, data_type: 'TEXT' },
  ], filters: [{ name: 'GOTHRANAME' }] },
]
export const BULK_TABLE_DOC = { MstSVA: 1265, MstGOTHRA: 1257 }

export const today = iso(0)
