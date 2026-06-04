import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
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

// All routes require authentication
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

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

// ==================== Saved BOMs (persisted in DB) ====================

/**
 * GET /api/calculator/saved-boms
 * ดูรายการ BOM ที่บันทึกไว้ทั้งหมด
 */
router.get('/saved-boms', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const presets = db.prepare(
      `SELECT * FROM calculator_presets WHERE tenant_id = ? ORDER BY created_at DESC`
    ).all(tenantId) as any[]

    const result = presets.map((p: any) => {
      const materials = db.prepare(
        `SELECT id, name, quantity, unit_price as unitPrice, unit, sort_order as sortOrder
         FROM calculator_preset_materials WHERE preset_id = ? ORDER BY sort_order`
      ).all(p.id) as any[]
      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        materials,
        operatingCost: p.operating_cost,
        scrapValue: p.scrap_value,
        totalCost: p.total_cost,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }
    })

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Get saved BOMs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch saved BOMs' })
  }
})

/**
 * GET /api/calculator/saved-boms/:id
 * ดู BOM ที่บันทึกไว้ตาม ID
 */
router.get('/saved-boms/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const preset = db.prepare(
      `SELECT * FROM calculator_presets WHERE id = ? AND tenant_id = ?`
    ).get(id, tenantId) as any

    if (!preset) {
      return res.status(404).json({ success: false, message: 'BOM not found' })
    }

    const materials = db.prepare(
      `SELECT id, name, quantity, unit_price as unitPrice, unit, sort_order as sortOrder
       FROM calculator_preset_materials WHERE preset_id = ? ORDER BY sort_order`
    ).all(id) as any[]

    res.json({
      success: true,
      data: {
        id: preset.id,
        name: preset.name,
        description: preset.description || '',
        materials,
        operatingCost: preset.operating_cost,
        scrapValue: preset.scrap_value,
        totalCost: preset.total_cost,
        createdAt: preset.created_at,
        updatedAt: preset.updated_at,
      },
    })
  } catch (error) {
    console.error('Get saved BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch saved BOM' })
  }
})

/**
 * POST /api/calculator/saved-boms
 * บันทึก BOM ใหม่
 */
router.post('/saved-boms', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
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
    const now = new Date().toISOString()
    const presetId = generateId()

    const insertPreset = db.prepare(
      `INSERT INTO calculator_presets (id, tenant_id, name, description, operating_cost, scrap_value, total_cost, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insertPreset.run(presetId, tenantId, name, description || '', operatingCost || 0, scrapValue || 0, costResult.totalCost, now, now)

    const insertMaterial = db.prepare(
      `INSERT INTO calculator_preset_materials (id, preset_id, name, quantity, unit_price, unit, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (let i = 0; i < (materials || []).length; i++) {
      const m = materials[i]
      insertMaterial.run(generateId(), presetId, m.name, m.quantity, m.unitPrice || 0, m.unit || 'pcs', i)
    }

    res.json({
      success: true,
      data: {
        id: presetId,
        name,
        description: description || '',
        materials: materials || [],
        operatingCost: operatingCost || 0,
        scrapValue: scrapValue || 0,
        totalCost: costResult.totalCost,
        createdAt: now,
        updatedAt: now,
      },
      message: 'BOM saved successfully',
    })
  } catch (error) {
    console.error('Save BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to save BOM' })
  }
})

/**
 * PUT /api/calculator/saved-boms/:id
 * แก้ไข BOM ที่บันทึกไว้
 */
router.put('/saved-boms/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    const { name, description, materials, operatingCost, scrapValue } = req.body

    const existing = db.prepare(
      `SELECT id FROM calculator_presets WHERE id = ? AND tenant_id = ?`
    ).get(id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'BOM not found' })
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
    const now = new Date().toISOString()

    db.prepare(
      `UPDATE calculator_presets
       SET name = ?, description = ?, operating_cost = ?, scrap_value = ?, total_cost = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    ).run(name, description || '', operatingCost || 0, scrapValue || 0, costResult.totalCost, now, id, tenantId)

    // Delete old materials and re-insert
    db.prepare(`DELETE FROM calculator_preset_materials WHERE preset_id = ?`).run(id)

    const insertMaterial = db.prepare(
      `INSERT INTO calculator_preset_materials (id, preset_id, name, quantity, unit_price, unit, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (let i = 0; i < (materials || []).length; i++) {
      const m = materials[i]
      insertMaterial.run(generateId(), id, m.name, m.quantity, m.unitPrice || 0, m.unit || 'pcs', i)
    }

    res.json({
      success: true,
      data: {
        id,
        name,
        description: description || '',
        materials: materials || [],
        operatingCost: operatingCost || 0,
        scrapValue: scrapValue || 0,
        totalCost: costResult.totalCost,
        updatedAt: now,
      },
      message: 'BOM updated successfully',
    })
  } catch (error) {
    console.error('Update BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to update BOM' })
  }
})

/**
 * DELETE /api/calculator/saved-boms/:id
 * ลบ BOM ที่บันทึกไว้
 */
router.delete('/saved-boms/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    const existing = db.prepare(
      `SELECT id FROM calculator_presets WHERE id = ? AND tenant_id = ?`
    ).get(id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'BOM not found' })
    }

    // CASCADE will delete materials, but explicit delete is safer
    db.prepare(`DELETE FROM calculator_preset_materials WHERE preset_id = ?`).run(id)
    db.prepare(`DELETE FROM calculator_presets WHERE id = ? AND tenant_id = ?`).run(id, tenantId)

    res.json({ success: true, message: 'BOM deleted successfully' })
  } catch (error) {
    console.error('Delete BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete BOM' })
  }
})

export default router
