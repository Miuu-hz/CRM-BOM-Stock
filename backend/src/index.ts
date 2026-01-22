import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Import routes
import authRoutes from './routes/auth.routes'
import customerRoutes from './routes/customer.routes'
import orderRoutes from './routes/order.routes'
import bomRoutes from './routes/bom.routes'
import stockRoutes from './routes/stock.routes'
import dashboardRoutes from './routes/dashboard.routes'
import calculatorRoutes from './routes/calculator.routes'
import dataRoutes from './routes/data.routes'
import marketingRoutes from './routes/marketing.routes'

const app: Express = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

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
app.use('/api/stock', stockRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/calculator', calculatorRoutes)
app.use('/api/data', dataRoutes)
app.use('/api/marketing', marketingRoutes)

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
