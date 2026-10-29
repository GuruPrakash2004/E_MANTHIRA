import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import AppShellLayout from './components/AppShellLayout'
import ProtectedRoute from './components/ProtectedRoute'
import NotFoundPage from './components/NotFoundPage'
import RequireDesignerDoc from './components/RequireDesignerDoc'

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
const CreditNotePage = lazy(() => import('./features/vouchers/CreditNotePage'))
const DebitNotePage = lazy(() => import('./features/vouchers/DebitNotePage'))
const ContraVoucherPage = lazy(() => import('./features/vouchers/ContraVoucherPage'))
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
const SharedDocumentsPage = lazy(() => import('./features/utilities/SharedDocumentsPage'))
const ReminderAlertPage = lazy(() => import('./features/utilities/ReminderAlertPage'))
const LabelPrintingPage = lazy(() => import('./features/utilities/LabelPrintingPage'))
const NotInWebPage = lazy(() => import('./features/tradeReports/NotInWebPage'))

const ExpenseEntryPage = lazy(() => import('./features/expense/ExpenseEntryPage'))
const AssetEntryPage = lazy(() => import('./features/assets/AssetEntryPage'))
const GroupSevaDocPage = lazy(() => import('./features/seva/GroupSevaDocPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/display" element={<Suspense fallback={null}><DisplayBoardPage /></Suspense>} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShellLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sevas" element={<RequireDesignerDoc docId={1263} name="Seva Entry"><SevaEntryPage /></RequireDesignerDoc>} />
          <Route path="/halls" element={<RequireDesignerDoc docId={1281} name="Hall Booking"><HallBookingPage /></RequireDesignerDoc>} />
          <Route path="/halls/entry" element={<RequireDesignerDoc docId={1280} name="Hall Booking Entry"><HallBookingEntryPage /></RequireDesignerDoc>} />
          <Route path="/masters/17" element={<CompanyMasterPage />} />
          <Route path="/masters/:docId" element={<MasterPage />} />
          <Route path="/donations" element={<RequireDesignerDoc docId={1261} name="Donation Receipt"><DonationReceiptPage /></RequireDesignerDoc>} />
          <Route path="/group-seva" element={<RequireDesignerDoc docId={1264} name="Group Seva"><GroupSevaDocPage /></RequireDesignerDoc>} />
          <Route path="/assets" element={<RequireDesignerDoc docId={1262} name="Asset Entry"><AssetEntryPage /></RequireDesignerDoc>} />
          <Route path="/expenses" element={<RequireDesignerDoc docId={1260} name="Expense Entry"><ExpenseEntryPage /></RequireDesignerDoc>} />
          <Route path="/vouchers/payment" element={<RequireDesignerDoc docId={1224} name="Payment Voucher"><PaymentVoucherPage /></RequireDesignerDoc>} />
          <Route path="/vouchers/journal" element={<RequireDesignerDoc docId={1254} name="Journal Voucher"><JournalVoucherPage /></RequireDesignerDoc>} />
          <Route path="/vouchers/credit-note" element={<RequireDesignerDoc docId={1250} name="Credit Note"><CreditNotePage /></RequireDesignerDoc>} />
          <Route path="/vouchers/debit-note" element={<RequireDesignerDoc docId={1252} name="Debit Note"><DebitNotePage /></RequireDesignerDoc>} />
          <Route path="/vouchers/contra" element={<RequireDesignerDoc docId={1253} name="Contra Voucher"><ContraVoucherPage /></RequireDesignerDoc>} />
          <Route path="/vouchers/receipt" element={<RequireDesignerDoc docId={1248} name="Receipt Voucher"><ReceiptVoucherPage /></RequireDesignerDoc>} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/panchanga" element={<PanchangaPage />} />
          <Route path="/halls/status" element={<HallStatusPage />} />
          <Route path="/inventory/stock-adjustment" element={<RequireDesignerDoc docId={1268} name="Stock Adjustment"><StockAdjustmentPage /></RequireDesignerDoc>} />
          <Route path="/inventory/store-issue" element={<RequireDesignerDoc docId={1270} name="Store Issue Note"><StoreIssuePage /></RequireDesignerDoc>} />
          <Route path="/inventory/purchase-bill" element={<RequireDesignerDoc docId={1271} name="Purchase Bill"><PurchaseBillPage /></RequireDesignerDoc>} />
          <Route path="/inventory/purchase-voucher" element={<RequireDesignerDoc docId={1272} name="Purchase Voucher"><PurchaseVoucherPage /></RequireDesignerDoc>} />
          <Route path="/inventory/bom" element={<RequireDesignerDoc docId={1149} name="Bill of Material"><BomPage /></RequireDesignerDoc>} />
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
          <Route path="/utilities/shared-docs" element={<SharedDocumentsPage />} />
          <Route path="/utilities/reminder-alert" element={<ReminderAlertPage />} />
          <Route path="/utilities/label-printing" element={<LabelPrintingPage />} />
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