import { Router, Request, Response } from 'express'
import prisma from '../db/prisma'

const router = Router()

// Get stock statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const totalItems = await prisma.stockItem.count()

    const stockItems = await prisma.stockItem.findMany({
      include: {
        material: true,
        product: true,
      },
    })

    const lowStockCount = stockItems.filter(
      (item) => item.quantity <= item.minStock
    ).length

    const criticalCount = stockItems.filter(
      (item) => item.quantity <= item.minStock * 0.3
    ).length

    // Calculate total value
    const totalValue = stockItems.reduce((sum, item) => {
      if (item.material) {
        return sum + item.quantity * Number(item.material.unitCost)
      }
      return sum
    }, 0)

    res.json({
      success: true,
      data: {
        totalItems,
        lowStockCount,
        criticalCount,
        totalValue: Math.round(totalValue),
      },
    })
  } catch (error) {
    console.error('Get stock stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock stats' })
  }
})

// Get all stock items
router.get('/', async (req: Request, res: Response) => {
  try {
    const stockItems = await prisma.stockItem.findMany({
      include: {
        product: true,
        material: true,
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

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
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const stock = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
      include: {
        product: true,
        material: true,
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

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
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sku, name, category, productId, materialId, quantity, unit, minStock, maxStock, location } = req.body

    if (!sku || !name || !category || !unit) {
      return res.status(400).json({
        success: false,
        message: 'SKU, name, category, and unit are required',
      })
    }

    // Check for duplicate SKU
    const existing = await prisma.stockItem.findUnique({
      where: { sku },
    })

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'SKU already exists',
      })
    }

    // Determine initial status
    let status = 'ADEQUATE'
    const qty = quantity || 0
    const min = minStock || 0
    const max = maxStock || 1000

    if (qty <= min * 0.3) {
      status = 'CRITICAL'
    } else if (qty <= min) {
      status = 'LOW'
    } else if (qty >= max) {
      status = 'OVERSTOCK'
    }

    const stockItem = await prisma.stockItem.create({
      data: {
        sku,
        name,
        category,
        productId: productId || null,
        materialId: materialId || null,
        quantity: qty,
        unit,
        minStock: min,
        maxStock: max,
        location: location || 'WAREHOUSE',
        status,
      },
      include: {
        product: true,
        material: true,
      },
    })

    // Record initial movement if quantity > 0
    if (qty > 0) {
      await prisma.stockMovement.create({
        data: {
          stockItemId: stockItem.id,
          type: 'IN',
          quantity: qty,
          notes: 'Initial stock',
          createdBy: 'system',
        },
      })
    }

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
router.post('/movement', async (req: Request, res: Response) => {
  try {
    const { stockItemId, type, quantity, notes, reference } = req.body

    if (!stockItemId || !type || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Stock item ID, type, and quantity are required',
      })
    }

    const stockItem = await prisma.stockItem.findUnique({
      where: { id: stockItemId },
      include: { material: true },
    })

    if (!stockItem) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    // Calculate new quantity
    let newQuantity = stockItem.quantity
    if (type === 'IN') {
      newQuantity += quantity
    } else if (type === 'OUT') {
      newQuantity -= quantity
      if (newQuantity < 0) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock',
        })
      }
    } else if (type === 'ADJUST') {
      newQuantity = quantity
    }

    // Determine status
    let status = 'ADEQUATE'
    if (newQuantity <= stockItem.minStock * 0.3) {
      status = 'CRITICAL'
    } else if (newQuantity <= stockItem.minStock) {
      status = 'LOW'
    } else if (newQuantity >= stockItem.maxStock) {
      status = 'OVERSTOCK'
    }

    // Update stock item
    const updated = await prisma.stockItem.update({
      where: { id: stockItemId },
      data: {
        quantity: newQuantity,
        status,
      },
      include: {
        product: true,
        material: true,
      },
    })

    // Record movement
    await prisma.stockMovement.create({
      data: {
        stockItemId,
        type,
        quantity,
        notes,
        reference,
        createdBy: 'system',
      },
    })

    res.json({
      success: true,
      message: 'Stock movement recorded successfully',
      data: updated,
    })
  } catch (error) {
    console.error('Record stock movement error:', error)
    res.status(500).json({ success: false, message: 'Failed to record stock movement' })
  }
})

// Update stock item
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, category, minStock, maxStock, location } = req.body

    const existing = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    // Recalculate status if min/max changed
    let status = existing.status
    const min = minStock !== undefined ? minStock : existing.minStock
    const max = maxStock !== undefined ? maxStock : existing.maxStock
    const qty = existing.quantity

    if (qty <= min * 0.3) {
      status = 'CRITICAL'
    } else if (qty <= min) {
      status = 'LOW'
    } else if (qty >= max) {
      status = 'OVERSTOCK'
    } else {
      status = 'ADEQUATE'
    }

    const updated = await prisma.stockItem.update({
      where: { id: req.params.id },
      data: {
        name: name || undefined,
        category: category || undefined,
        minStock: minStock !== undefined ? minStock : undefined,
        maxStock: maxStock !== undefined ? maxStock : undefined,
        location: location || undefined,
        status,
      },
      include: {
        product: true,
        material: true,
      },
    })

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
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    // Delete movements first
    await prisma.stockMovement.deleteMany({
      where: { stockItemId: req.params.id },
    })

    // Delete stock item
    await prisma.stockItem.delete({
      where: { id: req.params.id },
    })

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
router.get('/:id/movements', async (req: Request, res: Response) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

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
