// Canned, offline fixtures for "Demo Data" mode — lets a developer click
// through the whole shell (sidebar, dashboard, recent lists, reports
// catalog) without a reachable SQL Server. Pure data + a pure matcher
// function; no imports from api.js, so api.js can safely import this.
//
// Scope, deliberately: GET requests the shell/dashboard actually need are
// mocked with realistic rows; every other GET falls back to an empty-but
// -valid response (every screen in this app already treats "zero rows" as
// a normal state, never a bug — see CLAUDE.md's dynamic-field-engine note).
// POST/PUT/DELETE are never faked as "saved" — demo mode is read-only, and
// resolveMock signals that so api.js can reject with a clear message
// instead of pretending a save worked when nothing was persisted anywhere.

const todayISO = () => new Date().toISOString().slice(0, 10)
const daysAgoISO = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export const DEMO_USER = { user_id: 0, user_code: 'DEMO', user_name: 'Demo Admin', role_id: 1 }
export const DEMO_LOGIN_RESPONSE = {
  access_token: 'demo-mode-token',
  refresh_token: 'demo-mode-refresh',
  user_code: 'DEMO',
  user_name: 'Demo Admin',
  role_id: 1,
  financial_year_id: 1,
}

// Shape matches MstMenu rows as served by GET /meta/menu — caption/type/doc_id
// drive AppShellLayout's grouped sidebar; captions below are picked to hit
// real entries already in AppShellLayout.jsx's CAPTION_ROUTE map so every
// link in demo mode actually goes somewhere real, not a 404.
export const DEMO_MENU = [
  { menu_item_id: 1, caption: 'Seva Entry', type: 'Transactions' },
  { menu_item_id: 2, caption: 'Donation Reciept Entry', type: 'Transactions' },
  { menu_item_id: 3, caption: 'Hall Booking', type: 'Transactions' },
  { menu_item_id: 4, caption: 'Hall Booking Entry', type: 'Transactions' },
  { menu_item_id: 5, caption: 'Panchanga', type: 'Transactions' },
  { menu_item_id: 6, caption: 'Hall Status', type: 'Transactions' },
  { menu_item_id: 7, caption: 'Payment Voucher', type: 'Vouchers' },
  { menu_item_id: 8, caption: 'Receipt Voucher', type: 'Vouchers' },
  { menu_item_id: 9, caption: 'Subsidiary Reports', type: 'Reports' },
  { menu_item_id: 10, caption: 'PDF Generator', type: 'Reports' },
  { menu_item_id: 11, caption: 'Audit Trail', type: 'Utilities' },
  { menu_item_id: 12, caption: 'Display in Browser', type: 'Utilities' },
]

export const DEMO_SEVAS = [
  { SEVAID: 9001, PrintSEVANO: '26SLV09001', KNAME: 'Ramesh Iyengar', MOBNUM: '9900044441', TotalAmt: 250, SEVADate: todayISO(), Cancelled: 'N' },
  { SEVAID: 9002, PrintSEVANO: '26SLV09002', KNAME: 'Lakshmi Narasimhan', MOBNUM: '9845512234', TotalAmt: 500, SEVADate: todayISO(), Cancelled: 'N' },
  { SEVAID: 9003, PrintSEVANO: '26SLV09003', KNAME: 'Venkatesh Prasad', MOBNUM: '9900112233', TotalAmt: 1000, SEVADate: todayISO(), Cancelled: 'N' },
  { SEVAID: 9004, PrintSEVANO: '26SLV09004', KNAME: 'Shruthi Bhat', MOBNUM: '9741122334', TotalAmt: 150, SEVADate: daysAgoISO(1), Cancelled: 'N' },
  { SEVAID: 9005, PrintSEVANO: '26SLV09005', KNAME: 'Gopalakrishna Rao', MOBNUM: '9611223344', TotalAmt: 500, SEVADate: daysAgoISO(1), Cancelled: 'Y' },
  { SEVAID: 9006, PrintSEVANO: '26SLV09006', KNAME: 'Anitha Hegde', MOBNUM: '9880011223', TotalAmt: 100, SEVADate: daysAgoISO(2), Cancelled: 'N' },
]

export const DEMO_DONATIONS = [
  { DONRECID: 7001, PrintDONRECNO: '26SLV07001', DONOR: 'Suresh Kamath', CONTACTNO: '9900887766', TOTAMT: 2000, DONRECDate: todayISO(), Cancelled: 'N' },
  { DONRECID: 7002, PrintDONRECNO: '26SLV07002', DONOR: 'Padma Subramanya', CONTACTNO: '9845123456', TOTAMT: 500, DONRECDate: todayISO(), Cancelled: 'N' },
  { DONRECID: 7003, PrintDONRECNO: '26SLV07003', DONOR: 'Krishna Murthy Trust', CONTACTNO: '9741234567', TOTAMT: 10000, DONRECDate: daysAgoISO(1), Cancelled: 'N' },
  { DONRECID: 7004, PrintDONRECNO: '26SLV07004', DONOR: 'Vidya Shenoy', CONTACTNO: '9611234567', TOTAMT: 1000, DONRECDate: daysAgoISO(3), Cancelled: 'N' },
]

export const DEMO_HALL_BOOKINGS = [
  { HBID: 5001, Cancelled: 'N' },
  { HBID: 5002, Cancelled: 'N' },
  { HBID: 5003, Cancelled: 'Y' },
]

export const DEMO_REPORT_CATALOG = [
  { rpt_id: 1, name: 'Complete Day Summary', group: 'Daily', form_name: 'frmRptCompDaySmry' },
  { rpt_id: 2, name: 'Detailed Collection Report', group: 'Collections', form_name: 'frmRptDtlColn' },
  { rpt_id: 3, name: 'Donation Report', group: 'Donations', form_name: 'frmRptDonation' },
  { rpt_id: 4, name: 'Seva Issue Report', group: 'Sevas', form_name: 'frmRptSevaIssue' },
]

const GET_RULES = [
  { test: (u) => u === '/meta/menu', data: () => DEMO_MENU },
  { test: (u) => /^\/meta\/docs\/.+\/fields$/.test(u), data: () => ({ fields: [] }) },
  { test: (u) => /^\/meta\/prefixes\//.test(u), data: () => ['26SLV'] },
  { test: (u) => u === '/meta/ledgers', data: () => [] },
  { test: (u) => u === '/auth/me', data: () => DEMO_USER },
  { test: (u) => u === '/sevas', data: () => DEMO_SEVAS },
  { test: (u) => u === '/donations', data: () => DEMO_DONATIONS },
  { test: (u) => u === '/halls/bookings', data: () => DEMO_HALL_BOOKINGS },
  { test: (u) => u === '/reports/catalog', data: () => DEMO_REPORT_CATALOG },
  { test: (u) => u === '/audit-log/filters', data: () => ({}) },
  { test: (u) => u === '/audit-log', data: () => [] },
]

/**
 * Pure matcher: returns the mock payload for a GET, or `undefined` if the
 * URL isn't one of the curated fixtures above (caller falls back to a
 * generic empty response — see api.js's `demoFallback`).
 */
export function resolveDemoGet(url) {
  const path = url.split('?')[0]
  const rule = GET_RULES.find((r) => r.test(path))
  return rule ? rule.data() : undefined
}
