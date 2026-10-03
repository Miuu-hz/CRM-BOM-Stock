import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate } from '../middleware/auth.middleware'
import { sanitizeFilename } from '../utils/upload'
import { parseMarketingCSV } from '../services/csvParser.service'
import * as marketingRepo from '../repositories/marketing.repository'

const router = Router()

// All routes require authentication
router.use(authenticate)

// Extend Request type to include file from multer
interface MulterRequest extends Request {
  file?: any
}

// Allowed marketing import file types
const MARKETING_EXTS = ['.csv', '.xlsx', '.xls']
const MARKETING_MIMES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])

// ponytail: naive magic-byte check for spreadsheet uploads.
// Upgrade path: use a proper file-type library if more formats are needed.
function isValidMarketingFile(filePath: string, ext: string): boolean {
  if (!MARKETING_EXTS.includes(ext)) return false
  try {
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(8)
    const bytesRead = fs.readSync(fd, buffer, 0, 8, 0)
    fs.closeSync(fd)
    if (bytesRead < 4) return false
    const hex = buffer.toString('hex', 0, bytesRead).toLowerCase()
    if (ext === '.csv') return true
    if (ext === '.xlsx') return hex.startsWith('504b0304') // ZIP
    if (ext === '.xls') return hex.startsWith('d0cf11e0a1b11ae1')
    return false
  } catch {
    return false
  }
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
    const ext = path.extname(file.originalname).toLowerCase()
    const safeExt = MARKETING_EXTS.includes(ext) ? ext : '.csv'
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`
    cb(null, uniqueName)
  },
})

const upload = multer({
  storage,
  fileFilter: (req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (MARKETING_EXTS.includes(ext) && MARKETING_MIMES.has(file.mimetype)) {
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
    const tenantId = req.user!.tenantId
    const { platform, isActive } = req.query

    const platformFilter = platform ? platform.toString().toUpperCase() : undefined
    const isActiveFilter = isActive !== undefined ? isActive === 'true' : undefined

    const shops = marketingRepo.getAllShops(tenantId, platformFilter, isActiveFilter)

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
 * POST /api/marketing/shops
 * เพิ่มร้านค้าใหม่
 */
router.post('/shops', (req: Request, res: Response) => {
  try {
    const { name, platform, shopId } = req.body

    const newShop = marketingRepo.createShop(req.user!.tenantId, {
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
    const tenantId = req.user!.tenantId
    const shop = marketingRepo.getShopById(tenantId, shopId)
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    // Validate file extension and magic bytes before parsing.
    const ext = path.extname(req.file.originalname).toLowerCase()
    if (!isValidMarketingFile(req.file.path, ext)) {
      try { fs.unlinkSync(req.file.path) } catch { /* ignore */ }
      return res.status(400).json({ success: false, message: 'Invalid file format' })
    }

    // Parse CSV file with date range
    const parsedData = await parseMarketingCSV(req.file.path, platform, startDate, endDate)

    // Create file record
    const safeOriginalName = sanitizeFilename(req.file.originalname)
    const fileRecord: any = marketingRepo.createFile(tenantId, {
      shopId,
      fileName: safeOriginalName,
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
      tenantId,
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

    marketingRepo.bulkCreateMetrics(tenantId, metricsToInsert)

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

    const metrics = marketingRepo.getMetrics(req.user!.tenantId, {
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

    const filteredMetrics: any[] = marketingRepo.getMetrics(req.user!.tenantId, {
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

export default router
