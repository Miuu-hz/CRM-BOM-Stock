import { Router, Request, Response } from 'express'
import * as materialRepo from '../repositories/material.repository'
import * as stockRepo from '../repositories/stock.repository'

const router = Router()

// Get materials statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const totalMaterials = materialRepo.countMaterials()
    const stockStats = stockRepo.getStockStats()

    res.json({
      success: true,
      data: {
        totalMaterials,
        lowStockCount: stockStats.lowStockCount,
        totalValue: stockStats.totalValue,
        activeItems: stockStats.totalItems,
      },
    })
  } catch (error) {
    console.error('Get materials stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch materials stats' })
  }
})

// Get all materials with stock info
router.get('/', (req: Request, res: Response) => {
  try {
    const materials = materialRepo.getMaterialsWithStock()
    res.json({
      success: true,
      data: materials,
    })
  } catch (error) {
    console.error('Get materials error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch materials' })
  }
})

// Get material by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const material = materialRepo.getMaterialWithDetails(req.params.id)

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    res.json({
      success: true,
      data: material,
    })
  } catch (error) {
    console.error('Get material error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch material' })
  }
})

// Create material
router.post('/', (req: Request, res: Response) => {
  try {
    const { code, name, unit, unitCost, minStock, maxStock, initialStock } = req.body

    // Validate required fields
    if (!code || !name || !unit || unitCost === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Code, name, unit, and unitCost are required',
      })
    }

    // Check for duplicate code
    const existing = materialRepo.getMaterialByCode(code)
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Material code already exists',
      })
    }

    // Create material
    const material = materialRepo.createMaterial({
      code,
      name,
      unit,
      unitCost,
      minStock: minStock || 0,
      maxStock: maxStock || 1000,
    })

    // Create stock item if initial stock provided
    if (initialStock && initialStock > 0 && material) {
      stockRepo.createStockItem({
        sku: `STK-${code}`,
        name: `Stock: ${name}`,
        category: 'RAW_MATERIAL',
        materialId: material.id,
        quantity: initialStock,
        unit,
        minStock: minStock || 0,
        maxStock: maxStock || 1000,
        location: 'WAREHOUSE',
      })
    }

    res.json({
      success: true,
      message: 'Material created successfully',
      data: material,
    })
  } catch (error) {
    console.error('Create material error:', error)
    res.status(500).json({ success: false, message: 'Failed to create material' })
  }
})

// Update material
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { code, name, unit, unitCost, minStock, maxStock } = req.body

    const existing = materialRepo.getMaterialById(req.params.id)
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    // Check for duplicate code (excluding current)
    if (code && code !== existing.code) {
      const duplicate = materialRepo.getMaterialByCode(code)
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Material code already exists',
        })
      }
    }

    const material = materialRepo.updateMaterial(req.params.id, {
      code,
      name,
      unit,
      unitCost,
      minStock,
      maxStock,
    })

    res.json({
      success: true,
      message: 'Material updated successfully',
      data: material,
    })
  } catch (error) {
    console.error('Update material error:', error)
    res.status(500).json({ success: false, message: 'Failed to update material' })
  }
})

// Delete material
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const result = materialRepo.deleteMaterial(req.params.id)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || 'Material not found',
      })
    }

    res.json({
      success: true,
      message: 'Material deleted successfully',
    })
  } catch (error) {
    console.error('Delete material error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete material' })
  }
})

// Adjust stock for material
router.post('/:id/stock', (req: Request, res: Response) => {
  try {
    const { type, quantity, notes } = req.body

    if (!type || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Type and quantity are required',
      })
    }

    const material = materialRepo.getMaterialById(req.params.id)
    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    let stockItem = stockRepo.getStockItemByMaterialId(req.params.id)

    // Create stock item if doesn't exist
    if (!stockItem) {
      stockItem = stockRepo.createStockItem({
        sku: `STK-${material.code}`,
        name: `Stock: ${material.name}`,
        category: 'RAW_MATERIAL',
        materialId: material.id,
        quantity: 0,
        unit: material.unit,
        minStock: material.minStock,
        maxStock: material.maxStock,
        location: 'WAREHOUSE',
      })
    }

    if (!stockItem) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create stock item',
      })
    }

    const result = stockRepo.recordMovement(stockItem.id, type, quantity, notes)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      })
    }

    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: {
        material,
        stockItem: result.data,
      },
    })
  } catch (error) {
    console.error('Adjust stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to adjust stock' })
  }
})

export default router
