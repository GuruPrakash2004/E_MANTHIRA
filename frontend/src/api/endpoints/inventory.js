import { get, post, put, del } from '../api'

export const listStockAdjustments = (params) => get('/inventory/stock-adjustments', { params })
export const getStockAdjustment = (id) => get(`/inventory/stock-adjustments/${id}`)
export const updateStockAdjustment = (id, body) => put(`/inventory/stock-adjustments/${id}`, body)
export const createStockAdjustment = (body) => post('/inventory/stock-adjustments', body)
export const deleteStockAdjustment = (id) => del(`/inventory/stock-adjustments/${id}`)

export const listStoreIssues = (params) => get('/inventory/store-issues', { params })
export const getStoreIssue = (id) => get(`/inventory/store-issues/${id}`)
export const updateStoreIssue = (id, body) => put(`/inventory/store-issues/${id}`, body)
export const createStoreIssue = (body) => post('/inventory/store-issues', body)
export const deleteStoreIssue = (id) => del(`/inventory/store-issues/${id}`)

export const listPurchaseBills = (params) => get('/inventory/purchase-bills', { params })
export const purchaseBillNextNo = () => get('/inventory/purchase-bills/next-no')
export const getPurchaseBill = (id) => get(`/inventory/purchase-bills/${id}`)
export const updatePurchaseBill = (id, body) => put(`/inventory/purchase-bills/${id}`, body)
export const getQoh = (itemIds, locId) => get('/inventory/qoh', { params: { item_ids: itemIds.join(','), ...(locId ? { loc_id: locId } : {}) } })
export const searchLineItems = (q) => get('/inventory/line-items', { params: q ? { q } : undefined })
export const createPurchaseBill = (body) => post('/inventory/purchase-bills', body)
export const deletePurchaseBill = (id) => del(`/inventory/purchase-bills/${id}`)

export const listPurchaseVouchers = (params) => get('/inventory/purchase-vouchers', { params })
export const createPurchaseVoucher = (body) => post('/inventory/purchase-vouchers', body)
export const updatePurchaseVoucher = (id, body) => put(`/inventory/purchase-vouchers/${id}`, body)
export const deletePurchaseVoucher = (id) => del(`/inventory/purchase-vouchers/${id}`)

export const listBoms = (params) => get('/inventory/boms', { params })
export const createBom = (body) => post('/inventory/boms', body)
export const getBom = (id) => get(`/inventory/boms/${id}`)
export const updateBom = (id, body) => put(`/inventory/boms/${id}`, body)
export const deleteBom = (id) => del(`/inventory/boms/${id}`)

/** Current Stock Balance report — port of frmRptCurStockBal. */
export const getStockBalance = (params) => get('/inventory/stock-balance', { params })

/** Item Referencer / Where Used report — port of frmRptWhereUsed. */
export const getWhereUsed = (itemId) => get('/inventory/where-used', { params: { item_id: itemId } })

/** Stock Balance Report / Stock Ledger Report — port of frmRptStockBal / frmRptStockLed. */
export const getStockBalanceReport = (params) => get('/inventory/stock-balance-report', { params })
export const getStockLedgerReport = (params) => get('/inventory/stock-ledger-report', { params })

/** Item Quick Referencer / History — port of frmRptStkRef. */
export const referencerItems = (q) => get('/inventory/item-referencer/items', { params: { q } })
export const referencerItem = (id) => get(`/inventory/item-referencer/${id}`)
export const referencerTransactions = (id, params) => get(`/inventory/item-referencer/${id}/transactions`, { params })

/** Stock Ledger / Stock Balance (legacy frmRptStockLed / frmRptStockBal). */
export const stockReportLookups = () => get('/inventory/reports/lookups')
export const stockLedger = (params) => get('/inventory/reports/stock-ledger', { params })
export const stockBalance = (params) => get('/inventory/reports/stock-balance', { params })
export const stockBalanceDocwise = (params) => get('/inventory/reports/stock-balance-docwise', { params })
export const stockRules = () => get('/inventory/stock-rules')
// Add Items (paste item codes / saved item lists)
export const itemLists = () => get('/inventory/item-lists')
export const validateItemCodes = (codes) => post('/inventory/item-lists/validate', { codes })
export const loadItemList = (name) => get(`/inventory/item-lists/${encodeURIComponent(name)}`)
export const saveItemList = (name, remarks, itemIds) => put(`/inventory/item-lists/${encodeURIComponent(name)}`, { remarks, item_ids: itemIds })
export const removeItemList = (name) => del(`/inventory/item-lists/${encodeURIComponent(name)}`)
