import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import AppShellLayout from './components/AppShellLayout'
import ProtectedRoute from './components/ProtectedRoute'
import NotFoundPage from './components/NotFoundPage'

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const SevaEntryPage = lazy(() => import('./features/seva/SevaEntryPage'))
const HallBookingPage = lazy(() => import('./features/hall/HallBookingPage'))
const HallBookingEntryPage = lazy(() => import('./features/hall/HallBookingEntryPage'))
const MasterPage = lazy(() => import('./features/masters/MasterPage'))
const CompanyMasterPage = lazy(() => import('./features/masters/CompanyMasterPage'))
const DonationReceiptPage = lazy(() => import('./features/donation/DonationReceiptPage'))
const PaymentVoucherPage = lazy(() => import('./features/vouchers/PaymentVoucherPage'))
const JournalVoucherPage = lazy(() => import('./features/vouchers/JournalVoucherPage'))
const ReceiptVoucherPage = lazy(() => import('./features/vouchers/ReceiptVoucherPage'))
const AdminMasterPage = lazy(() => import('./features/settings/AdminMasterPage'))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
const PanchangaPage = lazy(() => import('./features/panchanga/PanchangaPage'))
const HallStatusPage = lazy(() => import('./features/hall/HallStatusPage'))
const DisplayBoardPage = lazy(() => import('./features/display/DisplayBoardPage'))
const StockAdjustmentPage = lazy(() => import('./features/inventory/StockAdjustmentPage'))
const StoreIssuePage = lazy(() => import('./features/inventory/StoreIssuePage'))
const PurchaseBillPage = lazy(() => import('./features/inventory/PurchaseBillPage'))
const PurchaseVoucherPage = lazy(() => import('./features/inventory/PurchaseVoucherPage'))
const BomPage = lazy(() => import('./features/inventory/BomPage'))
const CurrentStockBalancePage = lazy(() => import('./features/inventory/CurrentStockBalancePage'))
const ItemReferencerPage = lazy(() => import('./features/inventory/ItemReferencerPage'))
const StockBalanceReportPage = lazy(() => import('./features/inventory/StockBalanceReportPage'))
const StockLedgerReportPage = lazy(() => import('./features/inventory/StockLedgerReportPage'))
const PdfGeneratorPage = lazy(() => import('./features/reports/PdfGeneratorPage'))
const AuditTrailPage = lazy(() => import('./features/audit/AuditTrailPage'))
const AuditLogPage = lazy(() => import('./features/audit/AuditLogPage'))
const DailySalesPage = lazy(() => import('./features/tradeReports/SalesReports').then((m) => ({ default: m.DailySalesPage })))
const ProductSalesPage = lazy(() => import('./features/tradeReports/SalesReports').then((m) => ({ default: m.ProductSalesPage })))
const ImportFromExcelPage = lazy(() => import('./features/settings/ImportFromExcelPage'))

const StockLevelPage = lazy(() => import('./features/tradeReports/StockLevelPage'))
const StockAgeingPage = lazy(() => import('./features/tradeReports/StockAgeingPage'))
const PartyOutstandingPage = lazy(() => import('./features/tradeReports/PartyOutstandingPage'))
const AuthoriseDocumentsPage = lazy(() => import('./features/utilities/AuthoriseDocumentsPage'))
const ShortCloseDocumentsPage = lazy(() => import('./features/utilities/ShortCloseDocumentsPage'))
const ScreenDocsPage = lazy(() => import('./features/utilities/ScreenDocsPage'))
const NotInWebPage = lazy(() => import('./features/tradeReports/NotInWebPage'))

const ExpenseEntryPage = lazy(() => import('./features/expense/ExpenseEntryPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/display" element={<Suspense fallback={null}><DisplayBoardPage /></Suspense>} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShellLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sevas" element={<SevaEntryPage />} />
          <Route path="/halls" element={<HallBookingPage />} />
          <Route path="/halls/entry" element={<HallBookingEntryPage />} />
          <Route path="/masters/17" element={<CompanyMasterPage />} />
          <Route path="/masters/:docId" element={<MasterPage />} />
          <Route path="/donations" element={<DonationReceiptPage />} />
          <Route path="/expenses" element={<ExpenseEntryPage />} />
          <Route path="/vouchers/payment" element={<PaymentVoucherPage />} />
          <Route path="/vouchers/journal" element={<JournalVoucherPage />} />
          <Route path="/vouchers/receipt" element={<ReceiptVoucherPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/panchanga" element={<PanchangaPage />} />
          <Route path="/halls/status" element={<HallStatusPage />} />
          <Route path="/inventory/stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="/inventory/store-issue" element={<StoreIssuePage />} />
          <Route path="/inventory/purchase-bill" element={<PurchaseBillPage />} />
          <Route path="/inventory/purchase-voucher" element={<PurchaseVoucherPage />} />
          <Route path="/inventory/bom" element={<BomPage />} />
          <Route path="/inventory/stock-balance" element={<CurrentStockBalancePage />} />
          <Route path="/inventory/item-referencer" element={<ItemReferencerPage />} />
          <Route path="/inventory/stock-balance-report" element={<StockBalanceReportPage />} />
          <Route path="/inventory/stock-ledger-report" element={<StockLedgerReportPage />} />
          <Route path="/reports/pdf-generator" element={<PdfGeneratorPage />} />
          <Route path="/reports/stock-level" element={<StockLevelPage />} />
          <Route path="/reports/stock-ageing" element={<StockAgeingPage />} />
          <Route path="/reports/party-outstanding" element={<PartyOutstandingPage />} />
          <Route path="/not-in-web" element={<NotInWebPage />} />
          <Route path="/utilities/authorise" element={<AuthoriseDocumentsPage />} />
          <Route path="/utilities/shortclose" element={<ShortCloseDocumentsPage />} />
          <Route path="/utilities/screen-docs" element={<ScreenDocsPage />} />
          <Route path="/audit-trail" element={<AuditTrailPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/reports/daily-sales" element={<DailySalesPage />} />
          <Route path="/reports/product-sales" element={<ProductSalesPage />} />
          <Route path="/settings/import-excel" element={<ImportFromExcelPage />} />
          <Route path="/settings/admin-master" element={<AdminMasterPage />} />
          {/* Old separate URLs redirect into the consolidated Admin Master tabs. */}
          <Route path="/settings/doc-designer" element={<Navigate to="/settings/admin-master" replace />} />
          <Route path="/settings/menu" element={<Navigate to="/settings/admin-master" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}