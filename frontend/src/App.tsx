import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import BOM from './pages/BOM'
import Stock from './pages/Stock'
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
