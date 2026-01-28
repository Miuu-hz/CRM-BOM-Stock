import { Router, Request, Response } from 'express'
import * as bomRepo from '../repositories/bom.repository'
import * as productRepo from '../repositories/product.repository'

const router = Router()

// Get BOM statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = bomRepo.getBOMStats()
    res.json({
      success: true,
      data: stats,
    })
  } catch (error) {
    console.error('Get BOM stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM stats' })
  }
})

// Get all BOMs
router.get('/', (req: Request, res: Response) => {
  try {
    const boms = bomRepo.getAllBOMs()
    res.json({
      success: true,
      data: boms,
    })
  } catch (error) {
    console.error('Get BOMs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOMs' })
  }
})

// Get BOM by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const bom = bomRepo.getBOMById(req.params.id)

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
    console.error('Get BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch BOM' })
  }
})

// Create BOM
router.post('/', (req: Request, res: Response) => {
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
    const product = productRepo.getProductById(productId)
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      })
    }

    // Check for duplicate version
    const existingBOM = bomRepo.getBOMByProductId(productId)
    if (existingBOM && existingBOM.version === version) {
      return res.status(400).json({
        success: false,
        message: 'BOM with this version already exists for this product',
      })
    }

    const newBom = bomRepo.createBOM({
      productId,
      version,
      status,
      materials,
    })

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
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { version, status, materials } = req.body

    const existingBOM = bomRepo.getBOMById(req.params.id)
    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    const updatedBom = bomRepo.updateBOM(req.params.id, {
      version,
      status,
      materials,
    })

    res.json({
      success: true,
      message: 'BOM updated successfully',
      data: updatedBom,
    })
  } catch (error) {
    console.error('Update BOM error:', error)
    res.status(500).json({ success: false, message: 'Failed to update BOM' })
  }
})

// Delete BOM
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const existingBOM = bomRepo.getBOMById(req.params.id)
    if (!existingBOM) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found',
      })
    }

    bomRepo.deleteBOM(req.params.id)

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
