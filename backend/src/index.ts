import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

// Initialize SQLite database
import './db/sqlite'

// Import routes
import authRoutes from './routes/auth.routes'
import customerRoutes from './routes/customer.routes'
import orderRoutes from './routes/order.routes'
import bomRoutes from './routes/bom.routes'
import materialsRoutes from './routes/materials.routes'
import stockRoutes from './routes/stock.routes'
import dashboardRoutes from './routes/dashboard.routes'
import calculatorRoutes from './routes/calculator.routes'
import dataRoutes from './routes/data.routes'
import marketingRoutes from './routes/marketing.routes'
import searchRoutes from './routes/search.routes'
import supplierRoutes from './routes/supplier.routes'
import purchaseOrderRoutes from './routes/purchaseOrder.routes'
import purchaseRoutes from './routes/purchase.routes'
import workOrderRoutes from './routes/workOrder.routes'
import activityRoutes from './routes/activity.routes'
import salesRoutes from './routes/sales.routes'
import approvalRoutes from './routes/approval.routes'
import accountsRoutes from './routes/accounts.routes'
import journalRoutes from './routes/journal.routes'
import reportsRoutes from './routes/reports.routes'
import importRoutes from './routes/import.routes'
import customerRecommendationsRoutes from './routes/customerRecommendations.routes'
import taxRoutes from './routes/tax.routes'
import posMenuRoutes from './routes/pos-menu.routes'
import posBillRoutes from './routes/pos-bill.routes'
import posClearingRoutes from './routes/pos-clearing.routes'

const app: Express = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'CRM-BOM-Stock API is running',
    timestamp: new Date().toISOString(),
  })
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/bom', bomRoutes)
app.use('/api/materials', materialsRoutes)
app.use('/api/stock', stockRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/calculator', calculatorRoutes)
app.use('/api/data', dataRoutes)
app.use('/api/marketing', marketingRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/suppliers', supplierRoutes)
app.use('/api/purchase-orders', purchaseOrderRoutes)
app.use('/api/purchase', purchaseRoutes)
app.use('/api/work-orders', workOrderRoutes)
app.use('/api/activities', activityRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/approval', approvalRoutes)
app.use('/api/accounts', accountsRoutes)
app.use('/api/journal', journalRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/import', importRoutes)
app.use('/api/customer-recommendations', customerRecommendationsRoutes)
app.use('/api/tax', taxRoutes)
app.use('/api/pos', posMenuRoutes)
app.use('/api/pos', posBillRoutes)
app.use('/api/pos', posClearingRoutes)

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  })
})

// Error handler
app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error('Error:', err)
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`🌐 API URL: http://localhost:${PORT}/api`)
})

export default app
