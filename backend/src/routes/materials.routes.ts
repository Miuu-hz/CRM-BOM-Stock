import { Router, Request, Response } from 'express'
import prisma from '../db/prisma'

const router = Router()

// Get materials statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const totalMaterials = await prisma.material.count()

    // Get materials with low stock
    const stockItems = await prisma.stockItem.findMany({
      where: {
        materialId: { not: null },
      },
      include: {
        material: true,
      },
    })

    const lowStockCount = stockItems.filter(
      (item) => item.quantity <= item.minStock
    ).length

    // Calculate total inventory value
    const materials = await prisma.material.findMany()
    const totalValue = stockItems.reduce((sum, item) => {
      const material = materials.find((m) => m.id === item.materialId)
      if (material) {
        return sum + item.quantity * Number(material.unitCost)
      }
      return sum
    }, 0)

    res.json({
      success: true,
      data: {
        totalMaterials,
        lowStockCount,
        totalValue: Math.round(totalValue),
        activeItems: stockItems.length,
      },
    })
  } catch (error) {
    console.error('Get materials stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch materials stats' })
  }
})

// Get all materials with stock info
router.get('/', async (req: Request, res: Response) => {
  try {
    const materials = await prisma.material.findMany({
      include: {
        stockItems: true,
        bomItems: {
          include: {
            bom: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Enrich with stock status
    const materialsWithStock = materials.map((material) => {
      const stockItem = material.stockItems[0]
      const currentStock = stockItem?.quantity || 0
      const minStock = material.minStock
      const maxStock = material.maxStock

      let stockStatus = 'NO_STOCK'
      if (stockItem) {
        if (currentStock <= minStock * 0.3) {
          stockStatus = 'CRITICAL'
        } else if (currentStock <= minStock) {
          stockStatus = 'LOW'
        } else if (currentStock >= maxStock) {
          stockStatus = 'OVERSTOCK'
        } else {
          stockStatus = 'ADEQUATE'
        }
      }

      // Count usage in BOMs
      const usedInBOMs = material.bomItems.length

      return {
        ...material,
        currentStock,
        stockStatus,
        usedInBOMs,
        stockItem,
      }
    })

    res.json({
      success: true,
      data: materialsWithStock,
    })
  } catch (error) {
    console.error('Get materials error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch materials' })
  }
})

// Get material by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const material = await prisma.material.findUnique({
      where: { id: req.params.id },
      include: {
        stockItems: {
          include: {
            movements: {
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        },
        bomItems: {
          include: {
            bom: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    })

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
router.post('/', async (req: Request, res: Response) => {
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
    const existing = await prisma.material.findUnique({
      where: { code },
    })

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Material code already exists',
      })
    }

    // Create material
    const material = await prisma.material.create({
      data: {
        code,
        name,
        unit,
        unitCost,
        minStock: minStock || 0,
        maxStock: maxStock || 1000,
      },
    })

    // Create stock item if initial stock provided
    if (initialStock && initialStock > 0) {
      await prisma.stockItem.create({
        data: {
          sku: `STK-${code}`,
          name: `Stock: ${name}`,
          category: 'RAW_MATERIAL',
          materialId: material.id,
          quantity: initialStock,
          unit,
          minStock: minStock || 0,
          maxStock: maxStock || 1000,
          location: 'WAREHOUSE',
          status: initialStock > (minStock || 0) ? 'ADEQUATE' : 'LOW',
        },
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
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { code, name, unit, unitCost, minStock, maxStock } = req.body

    const existing = await prisma.material.findUnique({
      where: { id: req.params.id },
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    // Check for duplicate code (excluding current)
    if (code && code !== existing.code) {
      const duplicate = await prisma.material.findUnique({
        where: { code },
      })
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Material code already exists',
        })
      }
    }

    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: {
        code: code || undefined,
        name: name || undefined,
        unit: unit || undefined,
        unitCost: unitCost !== undefined ? unitCost : undefined,
        minStock: minStock !== undefined ? minStock : undefined,
        maxStock: maxStock !== undefined ? maxStock : undefined,
      },
    })

    // Update related stock items
    if (minStock !== undefined || maxStock !== undefined) {
      await prisma.stockItem.updateMany({
        where: { materialId: req.params.id },
        data: {
          minStock: minStock !== undefined ? minStock : undefined,
          maxStock: maxStock !== undefined ? maxStock : undefined,
        },
      })
    }

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
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.material.findUnique({
      where: { id: req.params.id },
      include: {
        bomItems: true,
        stockItems: true,
      },
    })

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    // Check if used in any BOM
    if (existing.bomItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: Material is used in ${existing.bomItems.length} BOM(s)`,
      })
    }

    // Delete related stock items first
    await prisma.stockItem.deleteMany({
      where: { materialId: req.params.id },
    })

    // Delete material
    await prisma.material.delete({
      where: { id: req.params.id },
    })

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
router.post('/:id/stock', async (req: Request, res: Response) => {
  try {
    const { type, quantity, notes } = req.body

    if (!type || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Type and quantity are required',
      })
    }

    const material = await prisma.material.findUnique({
      where: { id: req.params.id },
      include: { stockItems: true },
    })

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'Material not found',
      })
    }

    let stockItem = material.stockItems[0]

    // Create stock item if doesn't exist
    if (!stockItem) {
      stockItem = await prisma.stockItem.create({
        data: {
          sku: `STK-${material.code}`,
          name: `Stock: ${material.name}`,
          category: 'RAW_MATERIAL',
          materialId: material.id,
          quantity: 0,
          unit: material.unit,
          minStock: material.minStock,
          maxStock: material.maxStock,
          location: 'WAREHOUSE',
          status: 'NO_STOCK',
        },
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
    if (newQuantity <= material.minStock * 0.3) {
      status = 'CRITICAL'
    } else if (newQuantity <= material.minStock) {
      status = 'LOW'
    } else if (newQuantity >= material.maxStock) {
      status = 'OVERSTOCK'
    }

    // Update stock item
    const updatedStock = await prisma.stockItem.update({
      where: { id: stockItem.id },
      data: {
        quantity: newQuantity,
        status,
      },
    })

    // Record movement
    await prisma.stockMovement.create({
      data: {
        stockItemId: stockItem.id,
        type,
        quantity,
        notes,
        createdBy: 'system',
      },
    })

    res.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: {
        material,
        stockItem: updatedStock,
        previousQuantity: stockItem.quantity,
        newQuantity,
      },
    })
  } catch (error) {
    console.error('Adjust stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to adjust stock' })
  }
})

export default router
