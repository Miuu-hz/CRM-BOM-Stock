import { Router, Request, Response } from 'express'
import { products, materials, boms } from '../db/mockData'

const router = Router()

/**
 * GET /api/data/products
 * ดึงรายการสินค้าทั้งหมด
 */
router.get('/products', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: products,
    })
  } catch (error) {
    console.error('Get products error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
    })
  }
})

/**
 * GET /api/data/materials
 * ดึงรายการวัตถุดิบทั้งหมด
 */
router.get('/materials', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: materials,
    })
  } catch (error) {
    console.error('Get materials error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch materials',
    })
  }
})

/**
 * GET /api/data/boms
 * ดึงรายการ BOM ทั้งหมด
 */
router.get('/boms', (req: Request, res: Response) => {
  try {
    // Enrich BOM with product and material details
    const enrichedBOMs = boms.map(bom => {
      const product = products.find(p => p.id === bom.productId)
      const bomMaterials = bom.materials.map(bomMat => {
        const material = materials.find(m => m.id === bomMat.materialId)
        return {
          ...bomMat,
          materialName: material?.name,
          materialCode: material?.code,
          unitCost: material?.unitCost,
        }
      })

      return {
        ...bom,
        productName: product?.name,
        productCode: product?.code,
        materials: bomMaterials,
      }
    })

    res.json({
      success: true,
      data: enrichedBOMs,
    })
  } catch (error) {
    console.error('Get BOMs error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch BOMs',
    })
  }
})

/**
 * GET /api/data/boms/:productId
 * ดึง BOM ของสินค้าเฉพาะ
 */
router.get('/boms/:productId', (req: Request, res: Response) => {
  try {
    const { productId } = req.params
    const bom = boms.find(b => b.productId === productId && b.status === 'ACTIVE')

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found for this product',
      })
    }

    const product = products.find(p => p.id === bom.productId)
    const bomMaterials = bom.materials.map(bomMat => {
      const material = materials.find(m => m.id === bomMat.materialId)
      return {
        ...bomMat,
        materialName: material?.name,
        materialCode: material?.code,
        unitCost: material?.unitCost,
      }
    })

    res.json({
      success: true,
      data: {
        ...bom,
        productName: product?.name,
        productCode: product?.code,
        materials: bomMaterials,
      },
    })
  } catch (error) {
    console.error('Get BOM by product error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch BOM',
    })
  }
})

export default router
