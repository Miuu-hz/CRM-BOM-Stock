import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import * as marketingRepo from '../repositories/marketing.repository'

const router = Router()

// All routes require authentication
router.use(authenticate)

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
