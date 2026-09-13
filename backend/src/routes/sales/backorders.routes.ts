import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'

const router = Router()

// GET all backorders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const backorders = db.prepare(`
      SELECT bo.*, c.name as customer_name, c.code as customer_code,
        so.so_number, do.do_number as original_do
      FROM backorders bo
      LEFT JOIN customers c ON bo.customer_id = c.id
      LEFT JOIN sales_orders so ON bo.sales_order_id = so.id
      LEFT JOIN delivery_orders do ON bo.original_do_id = do.id
      WHERE bo.tenant_id = ?
      ORDER BY bo.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: backorders })
  } catch (error) {
    console.error('Get backorders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch backorders' })
  }
})

// POST create backorder from partial delivery
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, originalDoId, customerId, notes, items } = req.body
    
    if (!salesOrderId || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Sales order and items are required' })
    }

    const id = generateId()
    const boNumber = formatDocumentNumber('BO', tenantId, 'BACKORDER', new Date().getFullYear(), 5)
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO backorders (id, tenant_id, bo_number, sales_order_id, original_do_id, customer_id, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
      `).run(id, tenantId, boNumber, salesOrderId, originalDoId || null, customerId, notes || '', now, now)

      const insertItem = db.prepare(`
        INSERT INTO backorder_items (id, tenant_id, backorder_id, sales_order_item_id, product_id, ordered_qty, delivered_qty, remaining_qty, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const item of items) {
        const remaining = item.orderedQty - item.deliveredQty
        insertItem.run(generateId(), tenantId, id, item.salesOrderItemId, item.productId,
          item.orderedQty, item.deliveredQty, remaining, item.notes || '')
      }
    })

    transaction()

    const backorder = db.prepare('SELECT * FROM backorders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const backorderItems = db.prepare('SELECT * FROM backorder_items WHERE backorder_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...backorder, items: backorderItems } })
  } catch (error) {
    console.error('Create backorder error:', error)
    res.status(500).json({ success: false, message: 'Failed to create backorder' })
  }
})

// GET single backorder with items (product name falls back to sales_order_items.product_name —
// product_id is almost always NULL, see reference_erp_dead_products_table)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const backorder = db.prepare(`
      SELECT bo.*, c.name as customer_name, c.code as customer_code,
        so.so_number, do.do_number as original_do
      FROM backorders bo
      LEFT JOIN customers c ON bo.customer_id = c.id
      LEFT JOIN sales_orders so ON bo.sales_order_id = so.id
      LEFT JOIN delivery_orders do ON bo.original_do_id = do.id
      WHERE bo.id = ? AND bo.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!backorder) {
      return res.status(404).json({ success: false, message: 'Backorder not found' })
    }

    const items = db.prepare(`
      SELECT boi.*, COALESCE(p.name, soi.product_name) as product_name, soi.unit
      FROM backorder_items boi
      LEFT JOIN sales_order_items soi ON boi.sales_order_item_id = soi.id
      LEFT JOIN products p ON boi.product_id = p.id
      WHERE boi.backorder_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...backorder, items } })
  } catch (error) {
    console.error('Get backorder error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch backorder' })
  }
})

// PUT update backorder status (PENDING -> FULFILLED / CANCELLED)
// ปิดของค้างส่งไม่แตะสต็อกและไม่แตะ sales_order_items.delivered_qty เด็ดขาด —
// ทั้งสองอย่างนี้อัปเดตแล้วตอนยิง DO เป็น DELIVERED (deliveryOrders.ts) การ "ปิด"
// ที่นี่แค่บันทึกว่าของค้างส่งเรื่องนี้จบแล้ว (ส่งครบหรือลูกค้ายกเลิกส่วนที่เหลือ)
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['FULFILLED', 'CANCELLED']

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const backorder = db.prepare('SELECT * FROM backorders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!backorder) {
      return res.status(404).json({ success: false, message: 'Backorder not found' })
    }
    if (backorder.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Only pending backorders can be updated' })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE backorders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const updated = db.prepare('SELECT * FROM backorders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update backorder status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// GET pending items for backorder
router.get('/pending-items/:salesOrderId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId } = req.params
    
    const items = db.prepare(`
      SELECT soi.*, p.name as product_name, p.code as product_code,
        (soi.quantity - soi.delivered_qty) as remaining_qty
      FROM sales_order_items soi
      LEFT JOIN products p ON soi.product_id = p.id
      WHERE soi.sales_order_id = ? AND soi.quantity > soi.delivered_qty
    `).all(salesOrderId)

    res.json({ success: true, data: items })
  } catch (error) {
    console.error('Get pending items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending items' })
  }
})

export default router
