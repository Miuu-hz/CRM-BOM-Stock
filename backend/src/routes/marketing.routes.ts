import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { parseMarketingCSV } from '../services/csvParser.service'
import { shops, marketingFiles, marketingMetrics } from '../db/mockData'

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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, uniqueSuffix + '-' + file.originalname)
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

    let filteredShops = [...shops]

    if (platform) {
      filteredShops = filteredShops.filter(
        s => s.platform === platform.toString().toUpperCase()
      )
    }

    if (isActive !== undefined) {
      filteredShops = filteredShops.filter(
        s => s.isActive === (isActive === 'true')
      )
    }

    res.json({
      success: true,
      data: filteredShops,
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
    const shop = shops.find(s => s.id === id)

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

    // Check if shop already exists
    const existingShop = shops.find(
      s => s.platform === platform && s.shopId === shopId
    )

    if (existingShop) {
      return res.status(400).json({
        success: false,
        message: 'Shop already exists for this platform',
      })
    }

    const newShop = {
      id: String(shops.length + 1),
      name,
      platform: platform.toUpperCase(),
      shopId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    shops.push(newShop)

    res.json({
      success: true,
      data: newShop,
      message: 'Shop created successfully',
    })
  } catch (error) {
    console.error('Create shop error:', error)
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

    const shopIndex = shops.findIndex(s => s.id === id)

    if (shopIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    shops[shopIndex] = {
      ...shops[shopIndex],
      name: name || shops[shopIndex].name,
      isActive: isActive !== undefined ? isActive : shops[shopIndex].isActive,
      updatedAt: new Date(),
    }

    res.json({
      success: true,
      data: shops[shopIndex],
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
    const shopIndex = shops.findIndex(s => s.id === id)

    if (shopIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    shops.splice(shopIndex, 1)

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
    const shop = shops.find(s => s.id === shopId)
    if (!shop) {
      return res.status(404).json({
        success: false,
        message: 'Shop not found',
      })
    }

    // Parse CSV file
    const parsedData = await parseMarketingCSV(req.file.path, platform)

    // Create file record
    const fileRecord = {
      id: String(marketingFiles.length + 1),
      shopId,
      fileName: req.file.originalname,
      filePath: req.file.path,
      platform: platform.toUpperCase(),
      userName: parsedData.metadata.userName,
      reportStart: parsedData.metadata.reportStart
        ? new Date(parsedData.metadata.reportStart)
        : null,
      reportEnd: parsedData.metadata.reportEnd
        ? new Date(parsedData.metadata.reportEnd)
        : null,
      rowCount: parsedData.rowCount,
      uploadedAt: new Date(),
    }

    marketingFiles.push(fileRecord)

    // Store metrics
    parsedData.metrics.forEach(metric => {
      marketingMetrics.push({
        id: String(marketingMetrics.length + 1),
        fileId: fileRecord.id,
        shopId,
        date: new Date(metric.date),
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
        createdAt: new Date(),
      })
    })

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

    let filteredFiles = [...marketingFiles]

    if (shopId) {
      filteredFiles = filteredFiles.filter(f => f.shopId === shopId)
    }

    if (platform) {
      filteredFiles = filteredFiles.filter(
        f => f.platform === platform.toString().toUpperCase()
      )
    }

    // Sort by upload date descending
    filteredFiles.sort(
      (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
    )

    res.json({
      success: true,
      data: filteredFiles,
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

    let filteredMetrics = [...marketingMetrics]

    if (shopId) {
      filteredMetrics = filteredMetrics.filter(m => m.shopId === shopId)
    }

    if (startDate) {
      const start = new Date(startDate as string)
      start.setHours(0, 0, 0, 0) // Set to start of day
      filteredMetrics = filteredMetrics.filter(m => {
        const metricDate = new Date(m.date)
        metricDate.setHours(0, 0, 0, 0)
        return metricDate >= start
      })
    }

    if (endDate) {
      const end = new Date(endDate as string)
      end.setHours(23, 59, 59, 999) // Set to end of day
      filteredMetrics = filteredMetrics.filter(m => {
        const metricDate = new Date(m.date)
        return metricDate <= end
      })
    }

    if (platform) {
      const shopIds = shops
        .filter(s => s.platform === platform.toString().toUpperCase())
        .map(s => s.id)
      filteredMetrics = filteredMetrics.filter(m =>
        shopIds.includes(m.shopId)
      )
    }

    // Sort by date descending
    filteredMetrics.sort((a, b) => b.date.getTime() - a.date.getTime())

    res.json({
      success: true,
      data: filteredMetrics,
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

    let filteredMetrics = [...marketingMetrics]

    if (shopId) {
      filteredMetrics = filteredMetrics.filter(m => m.shopId === shopId)
    }

    if (startDate) {
      const start = new Date(startDate as string)
      start.setHours(0, 0, 0, 0)
      filteredMetrics = filteredMetrics.filter(m => {
        const metricDate = new Date(m.date)
        metricDate.setHours(0, 0, 0, 0)
        return metricDate >= start
      })
    }

    if (endDate) {
      const end = new Date(endDate as string)
      end.setHours(23, 59, 59, 999)
      filteredMetrics = filteredMetrics.filter(m => {
        const metricDate = new Date(m.date)
        return metricDate <= end
      })
    }

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
        summary.totalImpressions += m.impressions
        summary.totalClicks += m.clicks
        summary.totalOrders += m.orders
        summary.totalSales += parseFloat(m.sales.toString())
        summary.totalAdCost += parseFloat(m.adCost.toString())
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
    const fileIndex = marketingFiles.findIndex(f => f.id === id)

    if (fileIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      })
    }

    const file = marketingFiles[fileIndex]

    // Delete physical file
    if (fs.existsSync(file.filePath)) {
      fs.unlinkSync(file.filePath)
    }

    // Remove from array
    marketingFiles.splice(fileIndex, 1)

    // Remove related metrics
    const metricsToRemove = marketingMetrics.filter(m => m.fileId === id)
    metricsToRemove.forEach(metric => {
      const idx = marketingMetrics.findIndex(m => m.id === metric.id)
      if (idx !== -1) {
        marketingMetrics.splice(idx, 1)
      }
    })

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
