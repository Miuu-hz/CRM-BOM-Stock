import { Router, Request, Response } from 'express'
import prisma from '../db/prisma'

const router = Router()

// Get BOM statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const totalBOMs = await prisma.bOM.count()
    const activeBOMs = await prisma.bOM.count({
      where: { status: 'ACTIVE' },
    })
    const totalMaterials = await prisma.material.count()

    // Calculate average cost per unit
    const boms = await prisma.bOM.findMany({
      include: {
        materials: {
          include: {
            material: true,
          },
        },
      },
    })

    let totalCost = 0
    for (const bom of boms) {
      for (const item of bom.materials) {
        totalCost += Number(item.quantity) * Number(item.material.unitCost)
      }
    }
    const avgCostPerUnit = boms.length > 0 ? Math.round(totalCost / boms.length) : 0

    res.json({
      success: true,
      data: {
        totalBOMs,
        activeBOMs,
        totalMaterials,
        avgCostPerUnit,
      },
    })
  } catch (error) {
    console.error('Get BOM stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM stats' })
  }
})

// Get all BOMs
router.get('/', async (req: Request, res: Response) => {
  try {
    const boms = await prisma.bOM.findMany({
      include: {
        product: true,
        materials: {
          include: {
            material: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })

    // Calculate total cost for each BOM
    const bomsWithCost = boms.map((bom) => {
      const totalCost = bom.materials.reduce((sum: number, item: typeof bom.materials[0]) => {
        return sum + Number(item.quantity) * Number(item.material.unitCost)
      }, 0)

      return {
        ...bom,
        totalCost,
      }
    })

    res.json({
      success: true,
      data: bomsWithCost,
    })
  } catch (error) {
    console.error('Get BOMs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOMs' })
  }
})

// Get BOM by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const bom = await prisma.bOM.findUnique({
      where: { id: req.params.id },
      include: {
        product: true,
        materials: {
          include: {
            material: true,
          },
        },
      },
    })

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    const totalCost = bom.materials.reduce((sum: number, item: typeof bom.materials[0]) => {
      return sum + Number(item.quantity) * Number(item.material.unitCost)
    }, 0)

    res.json({
      success: true,
      data: {
        ...bom,
        totalCost,
      },
    })
  } catch (error) {
    console.error('Get BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM' })
  }
})

// Create BOM
router.post('/', async (req: Request, res: Response) => {
  try {
    const { productId, version, status = 'DRAFT', materials } = req.body

    // Validate required fields
    if (!productId || !version) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and version are required',
      })
    }

    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      })
    }

    // Check for duplicate version
    const existingBOM = await prisma.bOM.findFirst({
      where: {
        productId,
        version,
      },
    })

    if (existingBOM) {
      return res.status(400).json({
        success: false,
        message: 'BOM with this version already exists for this product',
      })
    }

    // Create BOM with materials
    const newBom = await prisma.bOM.create({
      data: {
        productId,
        version,
        status,
        materials: materials
          ? {
              create: materials.map(
                (m: { materialId: string; quantity: number; unit: string }) => ({
                  materialId: m.materialId,
                  quantity: m.quantity,
                  unit: m.unit,
                })
              ),
            }
          : undefined,
      },
      include: {
        product: true,
        materials: {
          include: {
            material: true,
          },
        },
      },
    })

    const totalCost = newBom.materials.reduce((sum: number, item: typeof newBom.materials[0]) => {
      return sum + Number(item.quantity) * Number(item.material.unitCost)
    }, 0)

    res.json({
      success: true,
      message: 'BOM created successfully',
      data: {
        ...newBom,
        totalCost,
      },
    })
  } catch (error) {
    console.error('Create BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to create BOM' })
  }
})

// Update BOM
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { version, status, materials } = req.body

    // Check if BOM exists
    const existingBOM = await prisma.bOM.findUnique({
      where: { id: req.params.id },
    })

    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    // If materials are being updated, delete existing and create new
    if (materials) {
      await prisma.bOMItem.deleteMany({
        where: { bomId: req.params.id },
      })
    }

    const updatedBom = await prisma.bOM.update({
      where: { id: req.params.id },
      data: {
        version: version || undefined,
        status: status || undefined,
        materials: materials
          ? {
              create: materials.map(
                (m: { materialId: string; quantity: number; unit: string }) => ({
                  materialId: m.materialId,
                  quantity: m.quantity,
                  unit: m.unit,
                })
              ),
            }
          : undefined,
      },
      include: {
        product: true,
        materials: {
          include: {
            material: true,
          },
        },
      },
    })

    const totalCost = updatedBom.materials.reduce((sum: number, item: typeof updatedBom.materials[0]) => {
      return sum + Number(item.quantity) * Number(item.material.unitCost)
    }, 0)

    res.json({
      success: true,
      message: 'BOM updated successfully',
      data: {
        ...updatedBom,
        totalCost,
      },
    })
  } catch (error) {
    console.error('Update BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to update BOM' })
  }
})

// Delete BOM
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    // Check if BOM exists
    const existingBOM = await prisma.bOM.findUnique({
      where: { id: req.params.id },
    })

    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    // Delete BOM items first
    await prisma.bOMItem.deleteMany({
      where: { bomId: req.params.id },
    })

    // Delete BOM
    await prisma.bOM.delete({
      where: { id: req.params.id },
    })

    res.json({
      success: true,
      message: 'BOM deleted successfully',
    })
  } catch (error) {
    console.error('Delete BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete BOM' })
  }
})

export default router
