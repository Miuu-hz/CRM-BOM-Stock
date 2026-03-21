import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// GET all suppliers
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const suppliers = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id) as total_orders,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders WHERE supplier_id = s.id AND status != 'CANCELLED') as total_spent
      FROM suppliers s
      WHERE s.tenant_id = ?
      ORDER BY s.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: suppliers })
  } catch (error) {
    console.error('Get suppliers error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers' })
  }
})

// GET supplier stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const totalSuppliers = db.prepare('SELECT COUNT(*) as count FROM suppliers WHERE tenant_id = ?').get(tenantId) as any
    const activeSuppliers = db.prepare("SELECT COUNT(*) as count FROM suppliers WHERE tenant_id = ? AND status = 'ACTIVE'").get(tenantId) as any
    const totalPOs = db.prepare(`
      SELECT COUNT(*) as count FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE s.tenant_id = ?
    `).get(tenantId) as any
    const totalSpent = db.prepare(`
      SELECT COALESCE(SUM(po.total_amount), 0) as total 
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      WHERE s.tenant_id = ? AND po.status != 'CANCELLED'
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        totalSuppliers: totalSuppliers.count,
        activeSuppliers: activeSuppliers.count,
        totalPOs: totalPOs.count,
        totalSpent: totalSpent.total,
      },
    })
  } catch (error) {
    console.error('Supplier stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// GET single supplier
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' })
    }

    const purchaseOrders = db.prepare(`
      SELECT * FROM purchase_orders WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(req.params.id)

    res.json({ success: true, data: { ...supplier, purchaseOrders } })
  } catch (error) {
    console.error('Get supplier error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch supplier' })
  }
})

// POST create supplier
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { code, name, type, contactName, email, phone, address, city, taxId, paymentTerms, notes } = req.body
    
    // Validate required fields
    if (!code || !name || !contactName) {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณากรอกข้อมูลให้ครบ: รหัสผู้จัดจำหน่าย, ชื่อบริษัท, ชื่อผู้ติดต่อ' 
      })
    }
    
    // Check for duplicate code in this tenant
    const existing = db.prepare('SELECT id FROM suppliers WHERE tenant_id = ? AND code = ?').get(tenantId, code)
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: `รหัสผู้จัดจำหน่าย "${code}" ถูกใช้แล้ว กรุณาใช้รหัสอื่น` 
      })
    }
    
    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO suppliers (id, tenant_id, code, name, type, contact_name, email, phone, address, city, tax_id, payment_terms, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, code, name, type || 'RAW_MATERIAL', contactName, email || '', phone || '', address || '', city || '', taxId || '', paymentTerms || 'NET30', notes || '', now, now)

    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: supplier })
  } catch (error: any) {
    console.error('Create supplier error:', error)
    res.status(500).json({ success: false, message: 'Failed to create supplier' })
  }
})

// PUT update supplier
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, type, contactName, email, phone, address, city, taxId, paymentTerms, rating, status, notes } = req.body
    const now = new Date().toISOString()

    // Check if supplier exists and belongs to this tenant
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Supplier not found' })
    }

    db.prepare(`
      UPDATE suppliers SET
        name = COALESCE(?, name), type = COALESCE(?, type), contact_name = COALESCE(?, contact_name),
        email = COALESCE(?, email), phone = COALESCE(?, phone), address = COALESCE(?, address),
        city = COALESCE(?, city), tax_id = COALESCE(?, tax_id), payment_terms = COALESCE(?, payment_terms),
        rating = COALESCE(?, rating), status = COALESCE(?, status), notes = COALESCE(?, notes),
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(name, type, contactName, email, phone, address, city, taxId, paymentTerms, rating, status, notes, now, req.params.id, tenantId)

    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: supplier })
  } catch (error) {
    console.error('Update supplier error:', error)
    res.status(500).json({ success: false, message: 'Failed to update supplier' })
  }
})

// GET supplier insights (purchase orders, materials, performance)
router.get('/:id/insights', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    
    // Check supplier exists and belongs to tenant
    const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' })
    }
    
    // Get purchase order stats
    const poStats = db.prepare(`
      SELECT 
        COUNT(*) as totalOrders,
        COALESCE(SUM(total_amount), 0) as totalSpent,
        MAX(order_date) as lastOrderDate,
        CASE 
          WHEN MAX(order_date) IS NOT NULL 
          THEN julianday('now') - julianday(MAX(order_date))
          ELSE NULL 
        END as daysSinceLastOrder,
        CASE 
          WHEN COUNT(*) > 0 THEN COALESCE(SUM(total_amount), 0) / COUNT(*)
          ELSE 0 
        END as avgOrderValue
      FROM purchase_orders 
      WHERE supplier_id = ? AND status != 'CANCELLED'
    `).get(id) as any
    
    // Get recent purchase orders with items
    const recentOrders = db.prepare(`
      SELECT 
        id, po_number as poNumber, order_date as orderDate, 
        total_amount as totalAmount, status, notes
      FROM purchase_orders
      WHERE supplier_id = ? AND status != 'CANCELLED'
      ORDER BY order_date DESC
      LIMIT 10
    `).all(id) as any[]
    
    // Get PO items for each order
    for (const order of recentOrders) {
      order.items = db.prepare(`
        SELECT
          poi.material_id as materialId,
          COALESCE(m.name, poi.description, poi.material_id) as materialName,
          poi.quantity,
          poi.unit_price as unitPrice,
          poi.total_price as totalPrice
        FROM purchase_order_items poi
        LEFT JOIN materials m ON poi.material_id = m.id
        WHERE poi.purchase_order_id = ?
      `).all(order.id) || []
    }
    
    // Get most purchased materials from this supplier
    const topMaterials = db.prepare(`
      SELECT
        poi.material_id as materialId,
        COALESCE(m.name, MAX(poi.description), poi.material_id) as materialName,
        SUM(poi.quantity) as totalQuantity,
        SUM(poi.total_price) as totalSpent,
        AVG(poi.unit_price) as avgUnitPrice
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      LEFT JOIN materials m ON poi.material_id = m.id
      WHERE po.supplier_id = ? AND po.status != 'CANCELLED'
      GROUP BY poi.material_id
      ORDER BY totalQuantity DESC
      LIMIT 10
    `).all(id) || []
    
    // Get yearly spending trend
    const spendingTrend = db.prepare(`
      SELECT 
        strftime('%Y-%m', order_date) as month,
        COUNT(*) as orderCount,
        COALESCE(SUM(total_amount), 0) as totalAmount
      FROM purchase_orders
      WHERE supplier_id = ? 
        AND status != 'CANCELLED'
        AND order_date >= date('now', '-12 months')
      GROUP BY strftime('%Y-%m', order_date)
      ORDER BY month
    `).all(id) || []
    
    res.json({
      success: true,
      data: {
        stats: {
          totalOrders: poStats.totalOrders || 0,
          totalSpent: poStats.totalSpent || 0,
          lastOrderDate: poStats.lastOrderDate,
          daysSinceLastOrder: poStats.daysSinceLastOrder ? Math.floor(poStats.daysSinceLastOrder) : undefined,
          avgOrderValue: poStats.avgOrderValue || 0
        },
        recentOrders: recentOrders.map(o => ({
          ...o,
          items: o.items || []
        })),
        topMaterials,
        spendingTrend
      }
    })
  } catch (error) {
    console.error('Get supplier insights error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch supplier insights' })
  }
})

// DELETE supplier
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Check if supplier exists and belongs to this tenant
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Supplier not found' })
    }
    
    const poCount = db.prepare('SELECT COUNT(*) as count FROM purchase_orders WHERE supplier_id = ?').get(req.params.id) as any
    if (poCount.count > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete supplier with existing purchase orders' })
    }

    db.prepare('DELETE FROM suppliers WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Supplier deleted' })
  } catch (error) {
    console.error('Delete supplier error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete supplier' })
  }
})

export default router
