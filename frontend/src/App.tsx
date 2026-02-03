import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import BOM from './pages/BOM'
import Stock from './pages/Stock'
import Calculator from './pages/Calculator'
import Marketing from './pages/Marketing'
import PurchaseOrders from './pages/PurchaseOrders'
import WorkOrders from './pages/WorkOrders'
import Settings from './pages/Settings'
import Login from './pages/Login'

function AppContent() {
  const { user, isReady } = useAuth()
  
  // รอให้ auth พร้อมก่อน render อะไรก็ตาม
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
  
  if (!user) {
    return <Login />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/crm" element={<CRM />} />
        <Route path="/bom" element={<BOM />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/marketing" element={<Marketing />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
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
