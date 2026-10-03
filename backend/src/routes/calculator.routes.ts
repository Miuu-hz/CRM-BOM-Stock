import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import {
  calculateRawMaterialCost,
  calculateTotalProductionCost,
  calculateBatchCost,
  Material,
  BOMItem,
} from '../services/costCalculation.service'
import { comparePlatforms, PlatformType } from '../services/platformFees.service'

const router = Router()

// All routes require authentication
router.use(authenticate)

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

export default router
