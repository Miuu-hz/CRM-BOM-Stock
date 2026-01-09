import { Router, Request, Response } from 'express'
import { boms, products, materials } from '../db/mockData'

const router = Router()

// Get all BOMs
router.get('/', async (req: Request, res: Response) => {
  try {
    const bomsWithDetails = boms.map((bom) => {
      const product = products.find((p) => p.id === bom.productId)
      const bomMaterials = bom.materials.map((m) => ({
        ...m,
        material: materials.find((mat) => mat.id === m.materialId),
      }))

      const totalCost = bomMaterials.reduce((sum, item) => {
        const materialCost = item.material?.unitCost || 0
        return sum + materialCost * Number(item.quantity)
      }, 0)

      return {
        ...bom,
        product,
        materials: bomMaterials,
        totalCost,
      }
    })

    res.json({
      success: true,
      data: bomsWithDetails,
    })
  } catch (error) {
    console.error('Get BOMs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOMs' })
  }
})

// Get BOM by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const bom = boms.find((b) => b.id === req.params.id)

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    const product = products.find((p) => p.id === bom.productId)
    const bomMaterials = bom.materials.map((m) => ({
      ...m,
      material: materials.find((mat) => mat.id === m.materialId),
    }))

    const totalCost = bomMaterials.reduce((sum, item) => {
      const materialCost = item.material?.unitCost || 0
      return sum + materialCost * Number(item.quantity)
    }, 0)

    res.json({
      success: true,
      data: {
        ...bom,
        product,
        materials: bomMaterials,
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
    const newBom = {
      id: String(boms.length + 1),
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    boms.push(newBom)

    res.json({
      success: true,
      message: 'BOM created successfully',
      data: newBom,
    })
  } catch (error) {
    console.error('Create BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to create BOM' })
  }
})

// Update BOM
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const index = boms.findIndex((b) => b.id === req.params.id)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    boms[index] = {
      ...boms[index],
      ...req.body,
      updatedAt: new Date(),
    }

    res.json({
      success: true,
      message: 'BOM updated successfully',
      data: boms[index],
    })
  } catch (error) {
    console.error('Update BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to update BOM' })
  }
})

// Delete BOM
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const index = boms.findIndex((b) => b.id === req.params.id)

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    boms.splice(index, 1)

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
