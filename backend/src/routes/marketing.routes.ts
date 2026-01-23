import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { parseMarketingCSV } from '../services/csvParser.service'
import * as marketingRepo from '../repositories/marketing.repository'

const router = Router()

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

    const { shopId, platform } = req.body

    if (!shopId || !platform) {
      return res.status(400).json({
        success: false,
        message: 'Shop ID and platform are required',
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

    // Parse CSV file
    const parsedData = await parseMarketingCSV(req.file.path, platform)

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

    // Store metrics in bulk
    const metricsToInsert = parsedData.metrics.map(metric => ({
      fileId: fileRecord.id,
      shopId,
      date: new Date(metric.date).toISOString(),
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

export default router
