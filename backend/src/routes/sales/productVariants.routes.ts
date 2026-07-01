import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId } from '../../utils/id'

const router = Router()

// GET all product variants
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const variants = db.prepare(`
      SELECT pv.*, p.name as product_name, p.code as product_code
      FROM product_variants pv
      LEFT JOIN products p ON pv.product_id = p.id
      WHERE pv.tenant_id = ?
      ORDER BY pv.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: variants })
  } catch (error) {
    console.error('Get product variants error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch product variants' })
  }
})

// GET variants by product
router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const variants = db.prepare(`
      SELECT * FROM product_variants 
      WHERE product_id = ? AND tenant_id = ? AND status = 'ACTIVE'
    `).all(req.params.productId, tenantId)

    res.json({ success: true, data: variants })
  } catch (error) {
    console.error('Get product variants error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch product variants' })
  }
})

// POST create product variant
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { productId, sku, variantName, attributes, unitPrice, costPrice } = req.body
    
    if (!productId || !sku || !variantName) {
      return res.status(400).json({ success: false, message: 'Product, SKU and variant name are required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO product_variants (id, tenant_id, product_id, sku, variant_name, attributes, unit_price, cost_price, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, tenantId, productId, sku, variantName, JSON.stringify(attributes || {}), unitPrice || 0, costPrice || 0, now, now)

    const variant = db.prepare('SELECT * FROM product_variants WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.status(201).json({ success: true, data: variant })
  } catch (error) {
    console.error('Create product variant error:', error)
    res.status(500).json({ success: false, message: 'Failed to create product variant' })
  }
})

export default router
