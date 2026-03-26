import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate } from '../middleware/auth.middleware'
import { parseMarketingCSV } from '../services/csvParser.service'
import * as marketingRepo from '../repositories/marketing.repository'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

function genId() { return randomUUID().replace(/-/g, '').substring(0, 25) }

// Ensure ad_spends table exists
db.prepare(`CREATE TABLE IF NOT EXISTS ad_spends (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  date TEXT NOT NULL,
  platform TEXT NOT NULL,
  channel TEXT,
  amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run()

const router = Router()

// All routes require authentication
router.use(authenticate)

// Extend Request type to include file from multer
interface MulterRequest extends Request {
  file?: any
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req: any, file: any, cb: any) => {
    const uploadDir = path.join(__dirname, '../../uploads/marketing')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req: any, file: any, cb: any) => {
    // Use short filename to avoid ENAMETOOLONG error with Thai characters
    const ext = path.extname(file.originalname)
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    cb(null, uniqueName)
  },
})

const upload = multer({
  storage,
  fileFilter: (req: any, file: any, cb: any) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowedTypes.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV and Excel files are allowed'))
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
})

/**
 * GET /api/marketing/shops
 * ดึงรายการร้านค้าทั้งหมด
 */
router.get('/shops', (req: Request, res: Response) => {
  try {
    const { platform, isActive } = req.query

    const platformFilter = platform ? platform.toString().toUpperCase() : undefined
    const isActiveFilter = isActive !== undefined ? isActive === 'true' : undefined

    const shops = marketingRepo.getAllShops(platformFilter, isActiveFilter)

    res.json({
      success: true,
      data: shops,
    })
  } catch (error) {
    console.error('Get shops error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shops',
    })
  }
})

/**
 * GET /api/marketing/shops/:id
 * ดึงข้อมูลร้านค้าตาม ID
 */
router.get('/shops/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const shop = marketingRepo.getShopById(id)

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    res.json({
      success: true,
      data: shop,
    })
  } catch (error) {
    console.error('Get shop error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shop',
    })
  }
})

/**
 * POST /api/marketing/shops
 * เพิ่มร้านค้าใหม่
 */
router.post('/shops', (req: Request, res: Response) => {
  try {
    const { name, platform, shopId } = req.body

    const newShop = marketingRepo.createShop({
      name,
      platform: platform.toUpperCase(),
      shopId,
    })

    res.json({
      success: true,
      data: newShop,
      message: 'Shop created successfully',
    })
  } catch (error: any) {
    console.error('Create shop error:', error)

    // Handle unique constraint violation
    if (error.message && error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({
        success: false,
        message: 'Shop already exists for this platform',
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create shop',
    })
  }
})

/**
 * PUT /api/marketing/shops/:id
 * แก้ไขข้อมูลร้านค้า
 */
router.put('/shops/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { name, isActive } = req.body

    const updatedShop = marketingRepo.updateShop(id, { name, isActive })

    if (!updatedShop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    res.json({
      success: true,
      data: updatedShop,
      message: 'Shop updated successfully',
    })
  } catch (error) {
    console.error('Update shop error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update shop',
    })
  }
})

/**
 * DELETE /api/marketing/shops/:id
 * ลบร้านค้า
 */
router.delete('/shops/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result = marketingRepo.deleteShop(id)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    res.json({
      success: true,
      message: 'Shop deleted successfully',
    })
  } catch (error) {
    console.error('Delete shop error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete shop',
    })
  }
})

/**
 * POST /api/marketing/upload
 * อัพโหลดและ parse ไฟล์ CSV/Excel
 */
router.post('/upload', upload.single('file'), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      })
    }

    const { shopId, platform, startDate, endDate } = req.body

    if (!shopId || !platform) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID and platform are required',
      })
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required',
      })
    }

    // Find shop
    const shop = marketingRepo.getShopById(shopId)
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    // Parse CSV file with date range
    const parsedData = await parseMarketingCSV(req.file.path, platform, startDate, endDate)

    // Create file record
    const fileRecord: any = marketingRepo.createFile({
      shopId,
      fileName: req.file.originalname,
      filePath: req.file.path,
      platform: platform.toUpperCase(),
      userName: parsedData.metadata.userName,
      reportStart: parsedData.metadata.reportStart || undefined,
      reportEnd: parsedData.metadata.reportEnd || undefined,
      rowCount: parsedData.rowCount,
    })

    // Get last order number for this shop and date range
    const nextDayStr = new Date(endDate)
    nextDayStr.setDate(nextDayStr.getDate() + 1)
    const lastOrderNumber = marketingRepo.getLastOrderNumber(
      shopId,
      startDate,
      nextDayStr.toISOString().split('T')[0]
    )

    // Store metrics in bulk with sequential order numbers
    const metricsToInsert = parsedData.metrics.map((metric, index) => ({
      fileId: fileRecord.id,
      shopId,
      date: new Date(metric.date).toISOString(),
      orderNumber: lastOrderNumber + index + 1,
      campaignName: metric.campaignName,
      productName: metric.productName,
      sku: metric.sku,
      adStatus: metric.adStatus,
      impressions: metric.impressions,
      clicks: metric.clicks,
      ctr: metric.ctr,
      orders: metric.orders,
      directOrders: metric.directOrders,
      orderRate: metric.orderRate,
      directOrderRate: metric.directOrderRate,
      costPerOrder: metric.costPerOrder,
      directCostPerOrder: metric.directCostPerOrder,
      itemsSold: metric.itemsSold,
      directItemsSold: metric.directItemsSold,
      sales: metric.sales,
      directSales: metric.directSales,
      adCost: metric.adCost,
      roas: metric.roas,
      directRoas: metric.directRoas,
      acos: metric.acos,
      directAcos: metric.directAcos,
      conversionRate: metric.conversionRate,
      extraData: JSON.stringify(metric.extraData),
    }))

    marketingRepo.bulkCreateMetrics(metricsToInsert)

    res.json({
      success: true,
      data: {
        file: fileRecord,
        metricsCount: parsedData.rowCount,
      },
      message: 'File uploaded and processed successfully',
    })
  } catch (error) {
    console.error('Upload error:', error)
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to upload file',
    })
  }
})

/**
 * GET /api/marketing/files
 * ดึงรายการไฟล์ที่อัพโหลด
 */
router.get('/files', (req: Request, res: Response) => {
  try {
    const { shopId, platform } = req.query

    const files = marketingRepo.getAllFiles(
      shopId as string,
      platform as string
    )

    res.json({
      success: true,
      data: files,
    })
  } catch (error) {
    console.error('Get files error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch files',
    })
  }
})

/**
 * GET /api/marketing/metrics
 * ดึงข้อมูล metrics พร้อม filter
 */
router.get('/metrics', (req: Request, res: Response) => {
  try {
    const { shopId, startDate, endDate, platform } = req.query

    // Normalize dates
    let normalizedStartDate = startDate as string
    let normalizedEndDate = endDate as string

    if (startDate) {
      const start = new Date(startDate as string)
      start.setHours(0, 0, 0, 0)
      normalizedStartDate = start.toISOString().split('T')[0]
    }

    if (endDate) {
      const end = new Date(endDate as string)
      end.setHours(23, 59, 59, 999)
      normalizedEndDate = end.toISOString().split('T')[0]
    }

    const metrics = marketingRepo.getMetrics({
      shopId: shopId as string,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      platform: platform as string,
    })

    res.json({
      success: true,
      data: metrics,
    })
  } catch (error) {
    console.error('Get metrics error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch metrics',
    })
  }
})

/**
 * GET /api/marketing/analytics/summary
 * สรุปข้อมูล performance โดยรวม
 */
router.get('/analytics/summary', (req: Request, res: Response) => {
  try {
    const { shopId, startDate, endDate } = req.query

    // Normalize dates
    let normalizedStartDate = startDate as string
    let normalizedEndDate = endDate as string

    if (startDate) {
      const start = new Date(startDate as string)
      start.setHours(0, 0, 0, 0)
      normalizedStartDate = start.toISOString().split('T')[0]
    }

    if (endDate) {
      const end = new Date(endDate as string)
      end.setHours(23, 59, 59, 999)
      normalizedEndDate = end.toISOString().split('T')[0]
    }

    const filteredMetrics: any[] = marketingRepo.getMetrics({
      shopId: shopId as string,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
    })

    // Calculate summary
    const summary = {
      totalImpressions: 0,
      totalClicks: 0,
      totalOrders: 0,
      totalSales: 0,
      totalAdCost: 0,
      avgCTR: 0,
      avgConversionRate: 0,
      totalROAS: 0,
      totalACOS: 0,
      recordCount: filteredMetrics.length,
    }

    if (filteredMetrics.length > 0) {
      filteredMetrics.forEach(m => {
        summary.totalImpressions += Number(m.impressions) || 0
        summary.totalClicks += Number(m.clicks) || 0
        summary.totalOrders += Number(m.orders) || 0
        summary.totalSales += Number(m.sales) || 0
        summary.totalAdCost += Number(m.adCost) || 0
      })

      summary.avgCTR =
        summary.totalImpressions > 0
          ? summary.totalClicks / summary.totalImpressions
          : 0
      summary.avgConversionRate =
        summary.totalClicks > 0
          ? summary.totalOrders / summary.totalClicks
          : 0
      summary.totalROAS =
        summary.totalAdCost > 0
          ? summary.totalSales / summary.totalAdCost
          : 0
      summary.totalACOS =
        summary.totalSales > 0
          ? summary.totalAdCost / summary.totalSales
          : 0
    }

    res.json({
      success: true,
      data: summary,
    })
  } catch (error) {
    console.error('Get analytics summary error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics summary',
    })
  }
})

/**
 * DELETE /api/marketing/files/:id
 * ลบไฟล์และ metrics ที่เกี่ยวข้อง
 */
router.delete('/files/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params

    // Get file info before deleting
    const files: any[] = marketingRepo.getAllFiles()
    const file = files.find((f: any) => f.id === id)

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      })
    }

    // Delete physical file
    if (fs.existsSync(file.filePath)) {
      fs.unlinkSync(file.filePath)
    }

    // Delete from database (CASCADE will delete related metrics)
    marketingRepo.deleteFile(id)

    res.json({
      success: true,
      message: 'File and related metrics deleted successfully',
    })
  } catch (error) {
    console.error('Delete file error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete file',
    })
  }
})

// ─── Ad Spend CRUD ─────────────────────────────────────────────────────────

// GET /marketing/ad-spends
router.get('/ad-spends', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate, platform } = req.query as any
    let sql = 'SELECT * FROM ad_spends WHERE tenant_id = ?'
    const params: any[] = [tenantId]
    if (startDate) { sql += ' AND date >= ?'; params.push(startDate) }
    if (endDate)   { sql += ' AND date <= ?'; params.push(endDate) }
    if (platform)  { sql += ' AND platform = ?'; params.push(platform) }
    sql += ' ORDER BY date DESC'
    const rows = db.prepare(sql).all(...params)
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('Get ad-spends error:', err)
    res.status(500).json({ success: false, message: 'Failed to fetch ad spends' })
  }
})

// POST /marketing/ad-spends
router.post('/ad-spends', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { date, platform, channel, amount, notes } = req.body
    if (!date || !platform || amount == null) {
      return res.status(400).json({ success: false, message: 'date, platform, amount are required' })
    }
    const id = genId()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO ad_spends (id, tenant_id, date, platform, channel, amount, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, date, platform, channel || null, Number(amount), notes || null, now, now)
    const row = db.prepare('SELECT * FROM ad_spends WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: row })
  } catch (err) {
    console.error('Create ad-spend error:', err)
    res.status(500).json({ success: false, message: 'Failed to create ad spend' })
  }
})

// DELETE /marketing/ad-spends/:id
router.delete('/ad-spends/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const existing = db.prepare('SELECT id FROM ad_spends WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' })
    db.prepare('DELETE FROM ad_spends WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('Delete ad-spend error:', err)
    res.status(500).json({ success: false, message: 'Failed to delete' })
  }
})

// GET /marketing/profit-report  —  P&L by date
router.get('/profit-report', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { startDate, endDate } = req.query as any

    // 1. Daily revenue + COGS from invoices
    let invSql = `
      SELECT
        substr(i.invoice_date, 1, 10) as date,
        COALESCE(SUM(i.total_amount), 0) as revenue,
        COALESCE(SUM(
          (SELECT COALESCE(SUM(ii.quantity * COALESCE(si.unit_cost, 0)), 0)
           FROM invoice_items ii
           LEFT JOIN stock_items si ON ii.stock_item_id = si.id
           WHERE ii.invoice_id = i.id)
        ), 0) as cogs
      FROM invoices i
      WHERE i.tenant_id = ?`
    const invParams: any[] = [tenantId]
    if (startDate) { invSql += ' AND substr(i.invoice_date,1,10) >= ?'; invParams.push(startDate) }
    if (endDate)   { invSql += ' AND substr(i.invoice_date,1,10) <= ?'; invParams.push(endDate) }
    invSql += ' GROUP BY substr(i.invoice_date,1,10)'
    const invRows = db.prepare(invSql).all(...invParams) as any[]

    // 2. Daily ad spend from marketing_metrics (CSV uploads)
    let mmSql = `
      SELECT date, COALESCE(SUM(ad_cost), 0) as csv_ad_spend
      FROM marketing_metrics
      WHERE tenant_id = ?`
    const mmParams: any[] = [tenantId]
    if (startDate) { mmSql += ' AND date >= ?'; mmParams.push(startDate) }
    if (endDate)   { mmSql += ' AND date <= ?'; mmParams.push(endDate) }
    mmSql += ' GROUP BY date'
    const mmRows = db.prepare(mmSql).all(...mmParams) as any[]

    // 3. Daily ad spend from manual ad_spends
    let asSql = `
      SELECT date, platform, COALESCE(SUM(amount), 0) as manual_ad_spend
      FROM ad_spends
      WHERE tenant_id = ?`
    const asParams: any[] = [tenantId]
    if (startDate) { asSql += ' AND date >= ?'; asParams.push(startDate) }
    if (endDate)   { asSql += ' AND date <= ?'; asParams.push(endDate) }
    asSql += ' GROUP BY date, platform'
    const asRows = db.prepare(asSql).all(...asParams) as any[]

    // Merge by date
    const byDate: Record<string, any> = {}
    const ensure = (d: string) => {
      if (!byDate[d]) byDate[d] = { date: d, revenue: 0, cogs: 0, csvAdSpend: 0, manualAdSpend: 0, adByPlatform: {} }
    }
    for (const r of invRows) { ensure(r.date); byDate[r.date].revenue = r.revenue; byDate[r.date].cogs = r.cogs }
    for (const r of mmRows)  { ensure(r.date); byDate[r.date].csvAdSpend = r.csv_ad_spend }
    for (const r of asRows)  {
      ensure(r.date)
      byDate[r.date].manualAdSpend += r.manual_ad_spend
      byDate[r.date].adByPlatform[r.platform] = (byDate[r.date].adByPlatform[r.platform] || 0) + r.manual_ad_spend
    }

    const report = Object.values(byDate).map((d: any) => {
      const totalAdSpend = d.csvAdSpend + d.manualAdSpend
      const grossProfit = d.revenue - d.cogs
      const netProfit = grossProfit - totalAdSpend
      const netMargin = d.revenue > 0 ? (netProfit / d.revenue) * 100 : 0
      const roas = totalAdSpend > 0 ? d.revenue / totalAdSpend : 0
      return { ...d, totalAdSpend, grossProfit, netProfit, netMargin, roas }
    }).sort((a: any, b: any) => a.date.localeCompare(b.date))

    res.json({ success: true, data: report })
  } catch (err) {
    console.error('Profit report error:', err)
    res.status(500).json({ success: false, message: 'Failed to generate report' })
  }
})

// ─── Platform Order Fulfillment & Ad Spend JE Approval ──────────────────────

// Create tables
db.prepare(`CREATE TABLE IF NOT EXISTS platform_imports (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, platform TEXT NOT NULL,
  shop_id TEXT, filename TEXT NOT NULL, import_date TEXT NOT NULL,
  total_rows INT DEFAULT 0, matched_rows INT DEFAULT 0, unmatched_rows INT DEFAULT 0,
  total_items_sold INT DEFAULT 0, total_ad_cost REAL DEFAULT 0, total_revenue REAL DEFAULT 0,
  status TEXT DEFAULT 'PENDING',
  notes TEXT, created_by TEXT, created_at TEXT NOT NULL
)`).run()

db.prepare(`CREATE TABLE IF NOT EXISTS platform_import_items (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL, product_name TEXT NOT NULL, ad_status TEXT,
  impressions INT DEFAULT 0, clicks INT DEFAULT 0, orders INT DEFAULT 0,
  items_sold INT DEFAULT 0, direct_items_sold INT DEFAULT 0,
  revenue REAL DEFAULT 0, direct_revenue REAL DEFAULT 0, ad_cost REAL DEFAULT 0,
  roas REAL DEFAULT 0,
  stock_item_id TEXT, stock_item_name TEXT, current_stock INT DEFAULT 0,
  deduct_status TEXT DEFAULT 'PENDING'
)`).run()

db.prepare(`CREATE TABLE IF NOT EXISTS sku_mappings (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  platform_sku TEXT NOT NULL, platform TEXT NOT NULL,
  stock_item_id TEXT NOT NULL, stock_item_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, platform_sku, platform)
)`).run()

db.prepare(`CREATE TABLE IF NOT EXISTS platform_pending_je (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  import_id TEXT, platform TEXT NOT NULL,
  description TEXT NOT NULL, amount REAL NOT NULL,
  import_date TEXT NOT NULL,
  dr_account_id TEXT, cr_account_id TEXT,
  status TEXT DEFAULT 'PENDING',
  journal_entry_id TEXT, notes TEXT,
  reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL
)`).run()

// Helper: generate JV number
function genJVNumber(tenantId: string): string {
  const yr = new Date().getFullYear()
  const c = (db.prepare(`SELECT COUNT(*) as c FROM journal_entries WHERE tenant_id = ? AND strftime('%Y', date) = ?`).get(tenantId, yr.toString()) as any).c
  return `JV-${yr}-${String(c + 1).padStart(5, '0')}`
}

// POST /marketing/platform/preview
router.post('/platform/preview', upload.single('file'), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' })
    const tenantId = req.user!.tenantId
    const { platform, importDate, shopId } = req.body
    if (!platform || !importDate) return res.status(400).json({ success: false, message: 'platform and importDate are required' })

    // Detect if file has metadata header (Shopee full format) or direct data
    const { parseSimplifiedCSV } = await import('../services/csvParser.service')
    const parsed = await parseSimplifiedCSV(req.file.path, importDate, importDate)

    const importId = genId()
    const now = new Date().toISOString()
    const filename = req.file.originalname

    const items: any[] = []
    let matched = 0
    let unmatched = 0
    let totalItemsSold = 0
    let totalAdCost = 0
    let totalRevenue = 0

    for (const row of parsed.metrics) {
      const sku = row.sku || ''
      if (!sku) continue

      let stockItemId: string | null = null
      let stockItemName: string | null = null
      let currentStock = 0
      let matchStatus = 'UNMATCHED'

      // Check sku_mappings first
      const mapping = db.prepare('SELECT * FROM sku_mappings WHERE tenant_id = ? AND platform_sku = ? AND platform = ?').get(tenantId, sku, platform) as any
      if (mapping) {
        const si = db.prepare('SELECT id, name, quantity FROM stock_items WHERE id = ? AND tenant_id = ?').get(mapping.stock_item_id, tenantId) as any
        if (si) {
          stockItemId = si.id
          stockItemName = si.name
          currentStock = si.quantity || 0
          matchStatus = 'MATCHED'
        }
      }

      if (!stockItemId) {
        // Try direct SKU match
        const si = db.prepare('SELECT id, name, quantity FROM stock_items WHERE sku = ? AND tenant_id = ?').get(sku, tenantId) as any
        if (si) {
          stockItemId = si.id
          stockItemName = si.name
          currentStock = si.quantity || 0
          matchStatus = 'MATCHED'
        }
      }

      if (matchStatus === 'MATCHED') matched++
      else unmatched++

      totalItemsSold += row.itemsSold || 0
      totalAdCost += row.adCost || 0
      totalRevenue += row.sales || 0

      items.push({
        sku,
        productName: row.productName || row.campaignName || sku,
        adStatus: row.adStatus || '',
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        orders: row.orders || 0,
        itemsSold: row.itemsSold || 0,
        directItemsSold: row.directItemsSold || 0,
        revenue: row.sales || 0,
        directRevenue: row.directSales || 0,
        adCost: row.adCost || 0,
        roas: row.roas || 0,
        stockItemId,
        stockItemName,
        currentStock,
        matchStatus,
      })
    }

    // Save import record
    db.prepare(`INSERT INTO platform_imports (id, tenant_id, platform, shop_id, filename, import_date, total_rows, matched_rows, unmatched_rows, total_items_sold, total_ad_cost, total_revenue, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
    ).run(importId, tenantId, platform, shopId || null, filename, importDate, items.length, matched, unmatched, totalItemsSold, totalAdCost, totalRevenue, req.user!.email, now)

    // Save items
    for (const item of items) {
      db.prepare(`INSERT INTO platform_import_items (id, import_id, tenant_id, sku, product_name, ad_status, impressions, clicks, orders, items_sold, direct_items_sold, revenue, direct_revenue, ad_cost, roas, stock_item_id, stock_item_name, current_stock, deduct_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`
      ).run(genId(), importId, tenantId, item.sku, item.productName, item.adStatus, item.impressions, item.clicks, item.orders, item.itemsSold, item.directItemsSold, item.revenue, item.directRevenue, item.adCost, item.roas, item.stockItemId, item.stockItemName, item.currentStock)
    }

    res.json({
      success: true,
      data: {
        importId,
        items,
        summary: { totalRows: items.length, matched, unmatched, totalItemsSold, totalAdCost, totalRevenue },
      },
    })
  } catch (err) {
    console.error('Platform preview error:', err)
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Failed to preview' })
  }
})

// GET /marketing/platform/imports
router.get('/platform/imports', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare('SELECT * FROM platform_imports WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId)
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch imports' })
  }
})

// GET /marketing/platform/imports/:importId
router.get('/platform/imports/:importId', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const imp = db.prepare('SELECT * FROM platform_imports WHERE id = ? AND tenant_id = ?').get(req.params.importId, tenantId) as any
    if (!imp) return res.status(404).json({ success: false, message: 'Import not found' })
    const items = db.prepare('SELECT * FROM platform_import_items WHERE import_id = ? AND tenant_id = ?').all(req.params.importId, tenantId)
    res.json({ success: true, data: { ...imp, items } })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch import' })
  }
})

// POST /marketing/platform/confirm/:importId
router.post('/platform/confirm/:importId', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const now = new Date().toISOString()

    const imp = db.prepare('SELECT * FROM platform_imports WHERE id = ? AND tenant_id = ?').get(req.params.importId, tenantId) as any
    if (!imp) return res.status(404).json({ success: false, message: 'Import not found' })
    if (imp.status !== 'PENDING') return res.status(400).json({ success: false, message: 'Import already processed' })

    const items = db.prepare('SELECT * FROM platform_import_items WHERE import_id = ? AND tenant_id = ?').all(req.params.importId, tenantId) as any[]

    let deducted = 0
    let skipped = 0
    let insufficient = 0

    for (const item of items) {
      if (!item.stock_item_id) {
        db.prepare('UPDATE platform_import_items SET deduct_status = ? WHERE id = ?').run('SKIPPED', item.id)
        skipped++
        continue
      }

      const si = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.stock_item_id, tenantId) as any
      if (!si) {
        db.prepare('UPDATE platform_import_items SET deduct_status = ? WHERE id = ?').run('SKIPPED', item.id)
        skipped++
        continue
      }

      const qty = item.items_sold || 0
      if (qty > 0) {
        const prevStock = si.quantity || 0
        const newQty = Math.max(0, prevStock - qty)
        db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ?').run(newQty, now, item.stock_item_id)

        const movId = genId()
        db.prepare(`INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)`
        ).run(movId, tenantId, item.stock_item_id, qty, imp.id, `Platform sale: ${imp.platform} import ${imp.id}`, now, req.user!.email)

        const deductStatus = prevStock > 0 ? 'DEDUCTED' : 'INSUFFICIENT'
        if (deductStatus === 'DEDUCTED') deducted++
        else insufficient++
        db.prepare('UPDATE platform_import_items SET deduct_status = ? WHERE id = ?').run(deductStatus, item.id)
      } else {
        db.prepare('UPDATE platform_import_items SET deduct_status = ? WHERE id = ?').run('SKIPPED', item.id)
        skipped++
      }
    }

    // Create pending JE for total ad cost
    if (imp.total_ad_cost > 0) {
      const jeId = genId()
      const desc = `ค่าโฆษณา ${imp.platform} วันที่ ${imp.import_date} (Import: ${imp.filename})`
      db.prepare(`INSERT INTO platform_pending_je (id, tenant_id, import_id, platform, description, amount, import_date, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      ).run(jeId, tenantId, imp.id, imp.platform, desc, imp.total_ad_cost, imp.import_date, now)
    }

    db.prepare('UPDATE platform_imports SET status = ? WHERE id = ?').run('CONFIRMED', imp.id)

    res.json({ success: true, data: { deducted, skipped, insufficient, totalAdCost: imp.total_ad_cost } })
  } catch (err) {
    console.error('Platform confirm error:', err)
    res.status(500).json({ success: false, message: 'Failed to confirm import' })
  }
})

// POST /marketing/platform/sku-mapping
router.post('/platform/sku-mapping', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { platformSku, platform, stockItemId } = req.body
    if (!platformSku || !platform || !stockItemId) return res.status(400).json({ success: false, message: 'platformSku, platform, stockItemId required' })

    const si = db.prepare('SELECT id, name FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!si) return res.status(404).json({ success: false, message: 'Stock item not found' })

    const now = new Date().toISOString()
    db.prepare(`INSERT OR REPLACE INTO sku_mappings (id, tenant_id, platform_sku, platform, stock_item_id, stock_item_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(genId(), tenantId, platformSku, platform, stockItemId, si.name, now)

    // Update pending import items with this SKU
    db.prepare(`UPDATE platform_import_items SET stock_item_id = ?, stock_item_name = ?
      WHERE tenant_id = ? AND sku = ? AND deduct_status = 'PENDING'`
    ).run(stockItemId, si.name, tenantId, platformSku)

    // Also update parent import matched/unmatched counts for affected imports
    const affectedImports = db.prepare(`
      SELECT DISTINCT import_id FROM platform_import_items
      WHERE tenant_id = ? AND sku = ? AND deduct_status = 'PENDING'
    `).all(tenantId, platformSku) as any[]

    for (const ai of affectedImports) {
      const matchedCount = (db.prepare('SELECT COUNT(*) as c FROM platform_import_items WHERE import_id = ? AND stock_item_id IS NOT NULL').get(ai.import_id) as any).c
      const unmatchedCount = (db.prepare('SELECT COUNT(*) as c FROM platform_import_items WHERE import_id = ? AND stock_item_id IS NULL').get(ai.import_id) as any).c
      db.prepare('UPDATE platform_imports SET matched_rows = ?, unmatched_rows = ? WHERE id = ?').run(matchedCount, unmatchedCount, ai.import_id)
    }

    res.json({ success: true, data: { platformSku, platform, stockItemId, stockItemName: si.name } })
  } catch (err) {
    console.error('SKU mapping error:', err)
    res.status(500).json({ success: false, message: 'Failed to save SKU mapping' })
  }
})

// GET /marketing/platform/sku-mappings
router.get('/platform/sku-mappings', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare('SELECT * FROM sku_mappings WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId)
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch SKU mappings' })
  }
})

// GET /marketing/platform/pending-je
router.get('/platform/pending-je', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare(`SELECT * FROM platform_pending_je WHERE tenant_id = ? AND status = 'PENDING' ORDER BY created_at DESC`).all(tenantId)
    res.json({ success: true, data: rows })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch pending JEs' })
  }
})

// POST /marketing/platform/approve-je/:id
router.post('/platform/approve-je/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { drAccountId, crAccountId, notes } = req.body
    if (!drAccountId || !crAccountId) return res.status(400).json({ success: false, message: 'drAccountId and crAccountId required' })

    const pje = db.prepare('SELECT * FROM platform_pending_je WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pje) return res.status(404).json({ success: false, message: 'Pending JE not found' })
    if (pje.status !== 'PENDING') return res.status(400).json({ success: false, message: 'JE already processed' })

    const now = new Date().toISOString()
    const dateStr = now.split('T')[0]
    const entryId = genId()
    const jvNumber = genJVNumber(tenantId)

    // Create journal entry
    db.prepare(`INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id, description, total_debit, total_credit, is_auto_generated, is_posted, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'AD_SPEND', ?, ?, ?, ?, 0, 1, ?, ?, ?)`
    ).run(entryId, tenantId, jvNumber, dateStr, pje.id, pje.description, pje.amount, pje.amount, req.user!.email, now, now)

    // DR: ค่าโฆษณา (expense)
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 1, ?, ?, 0)`
    ).run(genId(), tenantId, entryId, drAccountId, pje.description, pje.amount)

    // CR: เจ้าหนี้/เงินสด
    db.prepare(`INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 2, ?, 0, ?)`
    ).run(genId(), tenantId, entryId, crAccountId, pje.description, pje.amount)

    db.prepare('UPDATE platform_pending_je SET status = ?, journal_entry_id = ?, notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run('APPROVED', entryId, notes || null, req.user!.email, now, pje.id)

    res.json({ success: true, data: { journalEntryId: entryId, entryNumber: jvNumber } })
  } catch (err) {
    console.error('Approve JE error:', err)
    res.status(500).json({ success: false, message: 'Failed to approve JE' })
  }
})

// POST /marketing/platform/reject-je/:id
router.post('/platform/reject-je/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { notes } = req.body

    const pje = db.prepare('SELECT * FROM platform_pending_je WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pje) return res.status(404).json({ success: false, message: 'Pending JE not found' })
    if (pje.status !== 'PENDING') return res.status(400).json({ success: false, message: 'JE already processed' })

    const now = new Date().toISOString()
    db.prepare('UPDATE platform_pending_je SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run('REJECTED', notes || null, req.user!.email, now, pje.id)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject JE' })
  }
})

export default router
