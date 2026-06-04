import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

// หมวดหมู่สินค้าสำเร็จรูป (ไม่ใช้เป็นวัตถุดิบใน BOM)
// รองรับทั้งภาษาไทยและอังกฤษ
const FINISHED_CATEGORIES = `('[สินค้า]', 'finished', 'FINISHED')`

/**
 * GET /api/data/products
 * ดึงรายการสินค้าจาก stock_items สำหรับสร้าง BOM
 * เฉพาะสินค้าสำเร็จรูปและกึ่งสำเร็จรูป
 */
router.get('/products', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    // ดึงจาก stock_items เฉพาะประเภทที่ใช้เป็น BOM product ได้
    // รองรับ category ภาษาไทย: [สินค้า], [สินค้าสำเร็จรูป], [สินค้ากึ่งสำเร็จรูป]
    // และภาษาอังกฤษ: finished, wip
    const rows = db.prepare(`
      SELECT
        id,
        tenant_id,
        sku as code,
        name,
        category,
        unit,
        unit_cost,
        quantity as current_stock,
        status,
        created_at,
        updated_at
      FROM stock_items
      WHERE tenant_id = ?
        AND category IN (
          '[สินค้า]', '[สินค้าสำเร็จรูป]', '[สินค้ากึ่งสำเร็จรูป]',
          'finished', 'wip', 'FINISHED', 'WIP', 'material'
        )
      ORDER BY
        CASE category
          WHEN '[สินค้า]' THEN 1
          WHEN '[สินค้าสำเร็จรูป]' THEN 1
          WHEN 'finished' THEN 1
          WHEN 'FINISHED' THEN 1
          WHEN '[สินค้ากึ่งสำเร็จรูป]' THEN 2
          WHEN 'wip' THEN 2
          WHEN 'WIP' THEN 2
          ELSE 3
        END,
        name ASC
    `).all(tenantId) as any[]

    const products = rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      unit: p.unit,
      unitCost: Number(p.unit_cost) || 0,
      currentStock: p.current_stock,
      status: p.status || 'ACTIVE',
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }))

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
 * ดึงรายการวัตถุดิบจาก stock_items
 * เลือกได้ทุก category ยกเว้นสินค้าสำเร็จรูป [สินค้า]
 */
router.get('/materials', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    // ดึงจาก stock_items ทุก category ยกเว้นสินค้าสำเร็จรูป
    // ไม่รวม [สินค้า], [สินค้าสำเร็จรูป], finished
    const rows = db.prepare(`
      SELECT
        id,
        sku as code,
        name,
        unit,
        unit_cost,
        category,
        quantity as current_stock,
        min_stock,
        max_stock,
        status,
        created_at,
        updated_at
      FROM stock_items
      WHERE tenant_id = ?
        AND category NOT IN ('[สินค้า]', '[สินค้าสำเร็จรูป]', 'finished', 'FINISHED')
      ORDER BY name ASC
    `).all(tenantId) as any[]

    const materials = rows.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      unit: m.unit,
      unitCost: Number(m.unit_cost) || 0,
      category: m.category,
      currentStock: m.current_stock,
      minStock: m.min_stock,
      maxStock: m.max_stock,
      status: m.status,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }))

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
 * PATCH /api/data/products/:id/category
 * เปลี่ยนประเภทสินค้าเป็น Finished Good หรือ Semi-Finished Good
 */
router.patch('/products/:id/category', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { category } = req.body
    const validCategories = ['finished', 'wip', '[สินค้าสำเร็จรูป]', '[สินค้ากึ่งสำเร็จรูป]']
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid category. Must be finished or wip.' })
    }
    const now = new Date().toISOString()
    const result = db.prepare('UPDATE stock_items SET category = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(category, now, req.params.id, tenantId)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' })
    }
    const updated = db.prepare('SELECT id, sku as code, name, category, unit, unit_cost FROM stock_items WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update product category error:', error)
    res.status(500).json({ success: false, message: 'Failed to update category' })
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
      SELECT b.*, p.name as product_name, p.sku as product_code
      FROM boms b
      JOIN stock_items p ON b.product_id = p.id
      WHERE b.tenant_id = ?
      ORDER BY b.updated_at DESC
    `).all(tenantId) as any[]

    // Enrich BOM with calculated data
    const enrichedBOMs = boms.map((bom) => {
      const bomMaterials = db.prepare(`
        SELECT bi.*, m.name as material_name, m.sku as material_code, m.unit_cost
        FROM bom_items bi
        JOIN stock_items m ON bi.material_id = m.id
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
      SELECT b.*, p.name as product_name, p.sku as product_code
      FROM boms b
      JOIN stock_items p ON b.product_id = p.id
      WHERE b.product_id = ? AND b.status = 'ACTIVE' AND b.tenant_id = ?
    `).get(productId, tenantId) as any

    if (!bom) {
      return res.status(404).json({
        success: false,
        message: 'BOM not found for this product',
      })
    }

    const bomMaterials = db.prepare(`
      SELECT bi.*, m.name as material_name, m.sku as material_code, m.unit_cost
      FROM bom_items bi
      JOIN stock_items m ON bi.material_id = m.id
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
