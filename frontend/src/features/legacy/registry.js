// Legacy form name (MstMenu.FrmName, matched case-insensitively) -> web route.
// The menu is matched by FORM name as well as by caption, because clients rename captions and the legacy menu repeats the
// same form under several rows (e.g. 29 "Stock Balance" rows); the form name is what stays the same.
// A screen is wired here once and the sidebar, header search and favourites all pick it up.
export const FORM_ROUTE = {
  'stock balance report': '/inventory/stock-balance-report',
  'stock ledger report': '/inventory/stock-ledger-report',
  frmutlattendance: '/utilities/attendance',
  frmutlattmonth: '/utilities/attendance-monthly',
  frmmstaccountled: '/masters/accounting-ledgers',
  frmmstsanseva: '/masters/sannidhi-sevas',
}

/** The route for a menu row's legacy form name, or null. */
export const routeForForm = (formKey) => FORM_ROUTE[String(formKey || '').trim().toLowerCase()] || null
