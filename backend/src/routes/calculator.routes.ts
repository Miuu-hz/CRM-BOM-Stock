import { Router, Request, Response } from 'express'
import {
  calculateRawMaterialCost,
  calculateTotalProductionCost,
  calculateBatchCost,
  Material,
  BOMItem,
} from '../services/costCalculation.service'
import {
  calculatePlatformFees,
  calculateProfit,
  comparePlatforms,
  calculateTargetPrice,
  PlatformType,
  SaleOrder,
} from '../services/platformFees.service'

const router = Router()

/**
 * POST /api/calculator/production-cost
 * คำนวณต้นทุนการผลิต
 */
router.post('/production-cost', (req: Request, res: Response) => {
  try {
    const { materials, operatingCost, scrapValue, quantity } = req.body

    const bom: BOMItem = {
      id: 'temp',
      productId: 'temp',
      productName: 'temp',
      version: 'v1.0',
      materials: materials as Material[],
      operatingCost: operatingCost || 0,
      scrapValue: scrapValue || 0,
    }

    let result

    if (quantity && quantity > 1) {
      result = calculateBatchCost(bom, quantity)
    } else {
      result = calculateTotalProductionCost(bom)
    }

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Production cost calculation error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to calculate production cost',
    })
  }
})

/**
 * POST /api/calculator/platform-fees
 * คำนวณค่าธรรมเนียม Platform
 */
router.post('/platform-fees', (req: Request, res: Response) => {
  try {
    const order: SaleOrder = req.body

    const result = calculatePlatformFees(order)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Platform fees calculation error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to calculate platform fees',
    })
  }
})

/**
 * POST /api/calculator/profit
 * คำนวณกำไรสุทธิ
 */
router.post('/profit', (req: Request, res: Response) => {
  try {
    const { order, productionCost } = req.body

    const result = calculateProfit(order as SaleOrder, productionCost)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Profit calculation error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to calculate profit',
    })
  }
})

/**
 * POST /api/calculator/compare-platforms
 * เปรียบเทียบกำไรระหว่าง Platforms
 */
router.post('/compare-platforms', (req: Request, res: Response) => {
  try {
    const {
      sellingPrice,
      quantity,
      productionCost,
      platforms,
    } = req.body

    const result = comparePlatforms(
      sellingPrice,
      quantity,
      productionCost,
      platforms as PlatformType[]
    )

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Platform comparison error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to compare platforms',
    })
  }
})

/**
 * POST /api/calculator/target-price
 * คำนวณราคาขายที่เหมาะสมเพื่อให้ได้กำไรตามเป้า
 */
router.post('/target-price', (req: Request, res: Response) => {
  try {
    const {
      productionCost,
      targetProfitMargin,
      platform,
      quantity,
    } = req.body

    const targetPrice = calculateTargetPrice(
      productionCost,
      targetProfitMargin,
      platform as PlatformType,
      quantity
    )

    res.json({
      success: true,
      data: {
        targetPrice,
        productionCost,
        targetProfitMargin,
        platform,
      },
    })
  } catch (error) {
    console.error('Target price calculation error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to calculate target price',
    })
  }
})

/**
 * GET /api/calculator/platform-configs
 * ดูค่าธรรมเนียมมาตรฐานของแต่ละ Platform
 */
router.get('/platform-configs', (req: Request, res: Response) => {
  try {
    const { PLATFORM_FEE_CONFIGS } = require('../services/platformFees.service')

    res.json({
      success: true,
      data: PLATFORM_FEE_CONFIGS,
    })
  } catch (error) {
    console.error('Platform configs error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch platform configs',
    })
  }
})

export default router
