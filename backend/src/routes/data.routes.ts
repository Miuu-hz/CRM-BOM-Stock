import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

/**
 * GET /api/data/products
 * ดึงรายการสินค้าทั้งหมด
 */
router.get('/products', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const products = db.prepare(`
      SELECT * FROM products 
      WHERE tenant_id = ?
      ORDER BY name ASC
    `).all(tenantId)

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
    const tenantId = req.user!.tenantId
    
    const materials = db.prepare(`
      SELECT * FROM materials 
      WHERE tenant_id = ?
      ORDER BY name ASC
    `).all(tenantId)

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
    const tenantId = req.user!.tenantId
    
    const boms = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      JOIN products p ON b.product_id = p.id
      WHERE b.tenant_id = ?
      ORDER BY b.updated_at DESC
    `).all(tenantId) as any[]

    // Enrich BOM with calculated data
    const enrichedBOMs = boms.map((bom) => {
      const bomMaterials = db.prepare(`
        SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost
        FROM bom_items bi
        JOIN materials m ON bi.material_id = m.id
        WHERE bi.bom_id = ?
      `).all(bom.id) as any[]

      const totalCost = bomMaterials.reduce((sum, mat) => {
        return sum + Number(mat.quantity) * Number(mat.unit_cost)
      }, 0)

      return {
        ...bom,
        productName: bom.product_name,
        productCode: bom.product_code,
        materials: bomMaterials,
        totalCost,
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
    const tenantId = req.user!.tenantId
    const { productId } = req.params

    const bom = db.prepare(`
      SELECT b.*, p.name as product_name, p.code as product_code
      FROM boms b
      JOIN products p ON b.product_id = p.id
      WHERE b.product_id = ? AND b.status = 'ACTIVE' AND b.tenant_id = ?
    `).get(productId, tenantId) as any

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found for this product',
      })
    }

    const bomMaterials = db.prepare(`
      SELECT bi.*, m.name as material_name, m.code as material_code, m.unit_cost
      FROM bom_items bi
      JOIN materials m ON bi.material_id = m.id
      WHERE bi.bom_id = ?
    `).all(bom.id) as any[]

    const totalCost = bomMaterials.reduce((sum, mat) => {
      return sum + Number(mat.quantity) * Number(mat.unit_cost)
    }, 0)

    res.json({
      success: true,
      data: {
        ...bom,
        productName: bom.product_name,
        productCode: bom.product_code,
        materials: bomMaterials,
        totalCost,
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
