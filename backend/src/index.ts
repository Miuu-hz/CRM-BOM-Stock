import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

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
import purchaseRequestRoutes from './routes/purchase-request.routes'
import customerRecommendationsRoutes from './routes/customerRecommendations.routes'
import taxRoutes from './routes/tax.routes'
import posMenuRoutes from './routes/pos-menu.routes'
import posBillRoutes from './routes/pos-bill.routes'
import posClearingRoutes from './routes/pos-clearing.routes'
import kdsRoutes from './routes/kds.routes'
import lineBotRoutes from './routes/line-bot.routes'
import settingsRoutes from './routes/settings.routes'
import { agentRoutes, startWorker } from './agent'
import analyticsRoutes from './analytics/routes'

const app: Express = express()
const PORT = process.env.PORT || 5000

// Trust the first reverse proxy (nginx / Cloudflare).
// Required so express-rate-limit reads the real client IP from X-Forwarded-For
// instead of the proxy's IP. Set to the number of proxies in front of this server.
app.set('trust proxy', 1)

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // allow loading images from same-origin uploads
}))

// Agent webhook routes must be BEFORE global rate limiter and body parser
// Paperclip sends raw JSON; we parse it inline in the webhook handler.
app.use('/api/agent', express.json({ limit: '1mb' }))
app.use('/api/agent', agentRoutes)

// ── Global rate limiter ─────────────────────────────────────────────────────
// Apply to all API routes. Stricter limits can be added per-route if needed.
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,                // 200 requests per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  // Skip rate limiting for health checks and agent webhooks
  skip: (req) => req.path === '/api/health' || req.path.startsWith('/api/agent/webhook'),
})
app.use('/api', globalLimiter)

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}))
// Webhook needs raw body for LINE signature validation
app.use('/api/line/webhook', express.raw({ type: 'application/json' }))

// Import routes receive parsed Excel/CSV arrays — allow up to 10 MB only for that prefix.
// Must be registered BEFORE the 1 MB global limit so body-parser skips re-parsing.
app.use('/api/import', express.json({ limit: '10mb' }))
app.use('/api/import', express.urlencoded({ extended: true, limit: '10mb' }))

// All other routes: 1 MB is more than enough for any normal API payload.
// Keeping this low prevents a single large request from blocking the Node.js event loop.
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

// Register the rest of LINE bot routes (config, test)
app.use('/api/line', lineBotRoutes)

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
app.use('/api/purchase-requests', purchaseRequestRoutes)
app.use('/api/customer-recommendations', customerRecommendationsRoutes)
app.use('/api/tax', taxRoutes)
app.use('/api/pos', posMenuRoutes)
app.use('/api/pos', posBillRoutes)
app.use('/api/pos', posClearingRoutes)
app.use('/api/pos/kds', kdsRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/analytics', analyticsRoutes)

// Serve frontend (production) — must be after all API routes
const frontendDist = path.join(__dirname, '../../frontend/dist')
app.use(express.static(frontendDist))
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

// Error handler
app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error('Error:', err)
  const status = err.status || 500
  // Only expose err.message for deliberate 4xx errors raised by our own code.
  // Server errors (5xx) must never leak DB schema, constraint names, or stack traces.
  const isClientError = status >= 400 && status < 500
  res.status(status).json({
    success: false,
    message: isClientError ? (err.message || 'Bad request') : 'Internal server error',
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`🌐 API URL: http://localhost:${PORT}/api`)
  startWorker()
})

export default app
