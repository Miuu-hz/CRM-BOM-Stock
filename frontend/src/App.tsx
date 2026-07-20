import { ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { canViewMenu } from './config/menuPermissions'
import Login from './pages/Login'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import BOM from './pages/BOM'
import Stock from './pages/Stock'
import SubconStock from './pages/SubconStock'
import Calculator from './pages/Calculator'
import Marketing from './pages/Marketing'
import Sales from './pages/Sales'
import Purchase from './pages/Purchase'
import WorkOrders from './pages/WorkOrders'
import QC from './pages/QC'
import Settings from './pages/Settings'
import { ChartOfAccounts, JournalEntries, FinancialReports, PhopyBoard, PeriodClosing, BudgetVsActual } from './pages/Accounting'
import Tax from './pages/Tax'
import Cashier from './pages/Cashier'
import KDS from './pages/KDS'
import POSClearing from './pages/Accounting/POSClearing'
import { UserManagement } from './pages/Users'
import MasterPanel from './pages/MasterPanel'
import ApprovalInbox from './pages/ApprovalInbox'

// Blocks direct-URL access to a route whose menu is restricted in
// menuPermissions.ts (e.g. typing /users into the address bar as a USER).
// Sidebar visibility alone doesn't stop that; this reads the same template.
function Guard({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useAuth()
  if (!canViewMenu(user?.role, path)) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppContent() {
  const { t } = useTranslation()
  const { user, isMaster, isReady, showTimeoutWarning, extendSession, logout } = useAuth()

  if (!isReady) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-phopy-indigo/30 border-t-phopy-indigo rounded-full animate-spin" />
          <p className="text-[var(--fg-3)]">{t('loading')}</p>
        </div>
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <>
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/crm" element={<CRM />} />
        <Route path="/bom" element={<BOM />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/stock/subcontractors" element={<SubconStock />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/purchase" element={<Purchase />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/qc" element={<QC />} />
        <Route path="/production" element={<Navigate to="/bom" replace />} />
        <Route path="/settings" element={<Settings />} />

        {/* Accounting Routes */}
        <Route path="/accounting" element={<Navigate to="/accounting/chart-of-accounts" replace />} />
        <Route path="/accounting/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="/accounting/journal-entries" element={<JournalEntries />} />
        <Route path="/accounting/period-closing" element={<PeriodClosing />} />
        <Route path="/accounting/budget-vs-actual" element={<BudgetVsActual />} />
        <Route path="/accounting/reports" element={<FinancialReports />} />

        {/* Tax Route */}
        <Route path="/tax" element={<Tax />} />

        {/* Cashier & KDS Route */}
        <Route path="/cashier" element={<Cashier />} />
        <Route path="/kds" element={<KDS />} />

        {/* POS Clearing Route */}
        <Route path="/accounting/pos-clearing" element={<POSClearing />} />
        <Route path="/accounting/phopy-board" element={<PhopyBoard />} />

        <Route path="/users" element={<Guard path="/users"><UserManagement /></Guard>} />
        <Route path="/approvals" element={<Guard path="/approvals"><ApprovalInbox /></Guard>} />

        {/* Master Panel */}
        {isMaster && <Route path="/master" element={<MasterPanel />} />}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>

    {/* Session timeout warning overlay */}
    {showTimeoutWarning && (
      <div className="fixed inset-0 z-50 bg-[var(--fg-1)]/70 flex items-center justify-center">
        <div className="bg-[var(--surface)] border border-[var(--warning)]/40 rounded-xl p-8 max-w-sm w-full mx-4 text-center shadow-3">
          <div className="flex justify-center mb-4">
            <Clock className="w-10 h-10 text-[var(--warning)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--fg-1)] mb-2">{t('session.expiringTitle')}</h2>
          <p className="text-[var(--fg-3)] mb-6 text-sm" dangerouslySetInnerHTML={{ __html: t('session.expiringMessage') }} />
          <div className="flex gap-3">
            <button
              onClick={extendSession}
              className="flex-1 phopy-btn-primary py-2 text-sm"
            >
              {t('session.extend')}
            </button>
            <button
              onClick={logout}
              className="flex-1 py-2 text-sm border border-[var(--border-strong)] rounded-lg text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:border-[var(--border-strong)] transition-colors"
            >
              {t('session.logout')}
            </button>
          </div>
        </div>
      </div>
    )}
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
