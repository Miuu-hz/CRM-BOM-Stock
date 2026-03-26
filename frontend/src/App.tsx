import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import BOM from './pages/BOM'
import Stock from './pages/Stock'
import Calculator from './pages/Calculator'
import Marketing from './pages/Marketing'
import Sales from './pages/Sales'
import Purchase from './pages/Purchase'
import WorkOrders from './pages/WorkOrders'
import Settings from './pages/Settings'
import { ChartOfAccounts, JournalEntries, FinancialReports } from './pages/Accounting'
import Tax from './pages/Tax'
import Cashier from './pages/Cashier'
import KDS from './pages/KDS'
import POSClearing from './pages/Accounting/POSClearing'

function AppContent() {
  const { user, isReady, showTimeoutWarning, extendSession, logout } = useAuth()

  if (!isReady) {
    return (
      <div className="min-h-screen bg-cyber-dark flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-cyber-primary/30 border-t-cyber-primary rounded-full animate-spin" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <>
    {/* Session timeout warning overlay */}
    {showTimeoutWarning && (
      <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center">
        <div className="bg-cyber-dark border border-yellow-500/50 rounded-xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl">
          <div className="text-yellow-400 text-4xl mb-4">⏱</div>
          <h2 className="text-xl font-bold text-white mb-2">Session กำลังหมดอายุ</h2>
          <p className="text-gray-400 mb-6 text-sm">ไม่มีการใช้งานนานกว่า 30 นาที<br/>ระบบจะ logout อัตโนมัติใน 1 นาที</p>
          <div className="flex gap-3">
            <button
              onClick={extendSession}
              className="flex-1 cyber-btn-primary py-2 text-sm"
            >
              ใช้งานต่อ
            </button>
            <button
              onClick={logout}
              className="flex-1 py-2 text-sm border border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    )}
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/crm" element={<CRM />} />
        <Route path="/bom" element={<BOM />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/purchase" element={<Purchase />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/production" element={<Navigate to="/bom" replace />} />
        <Route path="/settings" element={<Settings />} />

        {/* Accounting Routes */}
        <Route path="/accounting" element={<Navigate to="/accounting/chart-of-accounts" replace />} />
        <Route path="/accounting/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="/accounting/journal-entries" element={<JournalEntries />} />
        <Route path="/accounting/reports" element={<FinancialReports />} />

        {/* Tax Route */}
        <Route path="/tax" element={<Tax />} />

        {/* Cashier & KDS Route */}
        <Route path="/cashier" element={<Cashier />} />
        <Route path="/kds" element={<KDS />} />

        {/* POS Clearing Route */}
        <Route path="/accounting/pos-clearing" element={<POSClearing />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
