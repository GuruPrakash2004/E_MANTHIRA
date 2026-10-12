import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './features/auth/LoginPage'
import DashboardPage from './features/dashboard/DashboardPage'
import AppShellLayout from './components/AppShellLayout'
import ProtectedRoute from './components/ProtectedRoute'
import SevaEntryPage from './features/seva/SevaEntryPage'
import HallBookingPage from './features/hall/HallBookingPage'
import HallBookingEntryPage from './features/hall/HallBookingEntryPage'
import MasterPage from './features/masters/MasterPage'
import DonationReceiptPage from './features/donation/DonationReceiptPage'
import PaymentVoucherPage from './features/vouchers/PaymentVoucherPage'
import ReceiptVoucherPage from './features/vouchers/ReceiptVoucherPage'
import AdminMasterPage from './features/settings/AdminMasterPage'
import ReportsPage from './features/reports/ReportsPage'
import PanchangaPage from './features/panchanga/PanchangaPage'
import HallStatusPage from './features/hall/HallStatusPage'
import DisplayBoardPage from './features/display/DisplayBoardPage'
import StockAdjustmentPage from './features/inventory/StockAdjustmentPage'
import StoreIssuePage from './features/inventory/StoreIssuePage'
import PurchaseBillPage from './features/inventory/PurchaseBillPage'
import PurchaseVoucherPage from './features/inventory/PurchaseVoucherPage'
import BomPage from './features/inventory/BomPage'
import CurrentStockBalancePage from './features/inventory/CurrentStockBalancePage'
import ItemReferencerPage from './features/inventory/ItemReferencerPage'
import StockBalanceReportPage from './features/inventory/StockBalanceReportPage'
import StockLedgerReportPage from './features/inventory/StockLedgerReportPage'
import PdfGeneratorPage from './features/reports/PdfGeneratorPage'
import AuditTrailPage from './features/audit/AuditTrailPage'
import ImportFromExcelPage from './features/settings/ImportFromExcelPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/display" element={<DisplayBoardPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShellLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sevas" element={<SevaEntryPage />} />
          <Route path="/halls" element={<HallBookingPage />} />
          <Route path="/halls/entry" element={<HallBookingEntryPage />} />
          <Route path="/masters/:docId" element={<MasterPage />} />
          <Route path="/donations" element={<DonationReceiptPage />} />
          <Route path="/vouchers/payment" element={<PaymentVoucherPage />} />
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
          <Route path="/audit-trail" element={<AuditTrailPage />} />
          <Route path="/settings/import-excel" element={<ImportFromExcelPage />} />
          <Route path="/settings/admin-master" element={<AdminMasterPage />} />
          {/* Old separate URLs redirect into the consolidated Admin Master tabs. */}
          <Route path="/settings/doc-designer" element={<Navigate to="/settings/admin-master" replace />} />
          <Route path="/settings/menu" element={<Navigate to="/settings/admin-master" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
