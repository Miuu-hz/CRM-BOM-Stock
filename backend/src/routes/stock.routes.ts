import { Router, Request, Response } from 'express'
import * as stockRepo from '../repositories/stock.repository'

const router = Router()

// Get stock statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = stockRepo.getStockStats()
    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    console.error('Get stock stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock stats' })
  }
})

// Get all stock items
router.get('/', (req: Request, res: Response) => {
  try {
    const stockItems = stockRepo.getAllStockItems()
    res.json({
      success: true,
      data: stockItems,
    })
  } catch (error) {
    console.error('Get stock items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock items' })
  }
})

// Get stock item by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const stock = stockRepo.getStockItemById(req.params.id)

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    res.json({
      success: true,
      data: stock,
    })
  } catch (error) {
    console.error('Get stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock item' })
  }
})

// Create stock item
router.post('/', (req: Request, res: Response) => {
  try {
    const { sku, name, category, productId, materialId, quantity, unit, minStock, maxStock, location } = req.body

    if (!sku || !name || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: 'SKU, name, category, and unit are required',
      })
    }

    // Check for duplicate SKU
    const existing = stockRepo.getStockItemBySku(sku)
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists',
      })
    }

    const stockItem = stockRepo.createStockItem({
      sku,
      name,
      category,
      productId,
      materialId,
      quantity: quantity || 0,
      unit,
      minStock,
      maxStock,
      location,
    })

    res.json({
      success: true,
      message: 'Stock item created successfully',
      data: stockItem,
    })
  } catch (error) {
    console.error('Create stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to create stock item' })
  }
})

// Record stock movement
router.post('/movement', (req: Request, res: Response) => {
  try {
    const { stockItemId, type, quantity, notes, reference } = req.body

    if (!stockItemId || !type || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Stock item ID, type, and quantity are required',
      })
    }

    const result = stockRepo.recordMovement(stockItemId, type, quantity, notes, reference)

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      })
    }

    res.json({
      success: true,
      message: 'Stock movement recorded successfully',
      data: result.data,
    })
  } catch (error) {
    console.error('Record stock movement error:', error)
    res.status(500).json({ success: false, message: 'Failed to record stock movement' })
  }
})

// Update stock item
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, category, minStock, maxStock, location } = req.body

    const updated = stockRepo.updateStockItem(req.params.id, {
      name,
      category,
      minStock,
      maxStock,
      location,
    })

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    res.json({
      success: true,
      message: 'Stock item updated successfully',
      data: updated,
    })
  } catch (error) {
    console.error('Update stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to update stock item' })
  }
})

// Delete stock item
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const existing = stockRepo.getStockItemById(req.params.id)
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    stockRepo.deleteStockItem(req.params.id)

    res.json({
      success: true,
      message: 'Stock item deleted successfully',
    })
  } catch (error) {
    console.error('Delete stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete stock item' })
  }
})

// Get movements for a stock item
router.get('/:id/movements', (req: Request, res: Response) => {
  try {
    const movements = stockRepo.getRecentMovements(req.params.id, 50)
    res.json({
      success: true,
      data: movements,
    })
  } catch (error) {
    console.error('Get movements error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch movements' })
  }
})

export default router
