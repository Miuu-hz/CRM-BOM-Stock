import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import BOM from './pages/BOM'
import Stock from './pages/Stock'
import Calculator from './pages/Calculator'
import Marketing from './pages/Marketing'
import PurchaseOrders from './pages/PurchaseOrders'
import WorkOrders from './pages/WorkOrders'
import Login from './pages/Login'

function App() {
  // TODO: Implement proper authentication
  const isAuthenticated = true

  if (!isAuthenticated) {
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
