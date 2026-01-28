import { Router, Request, Response } from 'express'
import {
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
import * as savedBomRepo from '../repositories/saved-bom.repository'

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

/**
 * GET /api/calculator/saved-boms
 * ดูรายการ BOM ที่บันทึกไว้ทั้งหมด
 */
router.get('/saved-boms', (req: Request, res: Response) => {
  try {
    const savedBOMs = savedBomRepo.getAllSavedBOMs()
    res.json({
      success: true,
      data: savedBOMs,
    })
  } catch (error) {
    console.error('Get saved BOMs error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch saved BOMs',
    })
  }
})

/**
 * GET /api/calculator/saved-boms/:id
 * ดู BOM ที่บันทึกไว้ตาม ID
 */
router.get('/saved-boms/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const bom = savedBomRepo.getSavedBOMById(id)

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    res.json({
      success: true,
      data: bom,
    })
  } catch (error) {
    console.error('Get saved BOM error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch saved BOM',
    })
  }
})

/**
 * POST /api/calculator/saved-boms
 * บันทึก BOM ใหม่
 */
router.post('/saved-boms', (req: Request, res: Response) => {
  try {
    const { name, description, materials, operatingCost, scrapValue } = req.body

    // คำนวณต้นทุนก่อนบันทึก
    const bom: BOMItem = {
      id: 'temp',
      productId: 'temp',
      productName: name,
      version: 'v1.0',
      materials: materials as Material[],
      operatingCost: operatingCost || 0,
      scrapValue: scrapValue || 0,
    }

    const costResult = calculateTotalProductionCost(bom)

    const newBOM = savedBomRepo.createSavedBOM({
      name,
      description: description || '',
      materials,
      operatingCost: operatingCost || 0,
      scrapValue: scrapValue || 0,
      totalCost: costResult.totalCost,
    })

    res.json({
      success: true,
      data: newBOM,
      message: 'BOM saved successfully',
    })
  } catch (error) {
    console.error('Save BOM error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to save BOM',
    })
  }
})

/**
 * PUT /api/calculator/saved-boms/:id
 * แก้ไข BOM ที่บันทึกไว้
 */
router.put('/saved-boms/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { name, description, materials, operatingCost, scrapValue } = req.body

    const existing = savedBomRepo.getSavedBOMById(id)
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    // คำนวณต้นทุนใหม่
    const bom: BOMItem = {
      id: 'temp',
      productId: 'temp',
      productName: name,
      version: 'v1.0',
      materials: materials as Material[],
      operatingCost: operatingCost || 0,
      scrapValue: scrapValue || 0,
    }

    const costResult = calculateTotalProductionCost(bom)

    const updatedBOM = savedBomRepo.updateSavedBOM(id, {
      name,
      description: description || existing.description,
      materials,
      operatingCost: operatingCost || 0,
      scrapValue: scrapValue || 0,
      totalCost: costResult.totalCost,
    })

    res.json({
      success: true,
      data: updatedBOM,
      message: 'BOM updated successfully',
    })
  } catch (error) {
    console.error('Update BOM error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update BOM',
    })
  }
})

/**
 * DELETE /api/calculator/saved-boms/:id
 * ลบ BOM ที่บันทึกไว้
 */
router.delete('/saved-boms/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existing = savedBomRepo.getSavedBOMById(id)
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    savedBomRepo.deleteSavedBOM(id)

    res.json({
      success: true,
      message: 'BOM deleted successfully',
    })
  } catch (error) {
    console.error('Delete BOM error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete BOM',
    })
  }
})

export default router
