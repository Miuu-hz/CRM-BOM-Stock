import { Router, Request, Response } from 'express'
import { stockItems, products, materials } from '../db/mockData'

const router = Router()

// Get all stock items
router.get('/', async (req: Request, res: Response) => {
  try {
    const stockWithDetails = stockItems.map((stock) => ({
      ...stock,
      product: stock.productId ? products.find((p) => p.id === stock.productId) : null,
      material: stock.materialId ? materials.find((m) => m.id === stock.materialId) : null,
    }))

    res.json({
      success: true,
      data: stockWithDetails,
    })
  } catch (error) {
    console.error('Get stock items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock items' })
  }
})

// Get stock item by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const stock = stockItems.find((s) => s.id === req.params.id)

    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    res.json({
      success: true,
      data: {
        ...stock,
        product: stock.productId ? products.find((p) => p.id === stock.productId) : null,
        material: stock.materialId
          ? materials.find((m) => m.id === stock.materialId)
          : null,
      },
    })
  } catch (error) {
    console.error('Get stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stock item' })
  }
})

// Create stock item
router.post('/', async (req: Request, res: Response) => {
  try {
    const newStock = {
      id: String(stockItems.length + 1),
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    stockItems.push(newStock)

    res.json({
      success: true,
      message: 'Stock item created successfully',
      data: newStock,
    })
  } catch (error) {
    console.error('Create stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to create stock item' })
  }
})

// Record stock movement
router.post('/movement', async (req: Request, res: Response) => {
  try {
    const { stockItemId, type, quantity } = req.body

    const index = stockItems.findIndex((s) => s.id === stockItemId)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    const stock = stockItems[index]
    let newQuantity = stock.quantity

    if (type === 'IN') {
      newQuantity += quantity
    } else if (type === 'OUT') {
      newQuantity -= quantity
    } else {
      newQuantity = quantity
    }

    // Update status based on new quantity
    let newStatus = stock.status
    if (newQuantity <= stock.minStock * 0.3) {
      newStatus = 'CRITICAL'
    } else if (newQuantity <= stock.minStock) {
      newStatus = 'LOW'
    } else if (newQuantity >= stock.maxStock) {
      newStatus = 'OVERSTOCK'
    } else {
      newStatus = 'ADEQUATE'
    }

    stockItems[index] = {
      ...stock,
      quantity: newQuantity,
      status: newStatus,
      updatedAt: new Date(),
    }

    res.json({
      success: true,
      message: 'Stock movement recorded successfully',
      data: stockItems[index],
    })
  } catch (error) {
    console.error('Record stock movement error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to record stock movement',
    })
  }
})

// Update stock item
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const index = stockItems.findIndex((s) => s.id === req.params.id)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    stockItems[index] = {
      ...stockItems[index],
      ...req.body,
      updatedAt: new Date(),
    }

    res.json({
      success: true,
      message: 'Stock item updated successfully',
      data: stockItems[index],
    })
  } catch (error) {
    console.error('Update stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to update stock item' })
  }
})

// Delete stock item
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const index = stockItems.findIndex((s) => s.id === req.params.id)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Stock item not found',
      })
    }

    stockItems.splice(index, 1)

    res.json({
      success: true,
      message: 'Stock item deleted successfully',
    })
  } catch (error) {
    console.error('Delete stock item error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete stock item' })
  }
})

export default router
