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

function generatePONumber(tenantId: string) {
  const count = (db.prepare('SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id = ?').get(tenantId) as any).count
  return `PO-${String(count + 1).padStart(5, '0')}`
}

// GET all purchase orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const orders = db.prepare(`
      SELECT po.*, s.name as supplier_name, s.code as supplier_code,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.tenant_id = ?
      ORDER BY po.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: orders })
  } catch (error) {
    console.error('Get POs error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase orders' })
  }
})

// GET PO stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const total = db.prepare('SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id = ?').get(tenantId) as any
    const draft = db.prepare("SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id = ? AND status = 'DRAFT'").get(tenantId) as any
    const pending = db.prepare("SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id = ? AND status IN ('SUBMITTED', 'APPROVED')").get(tenantId) as any
    const received = db.prepare("SELECT COUNT(*) as count FROM purchase_orders WHERE tenant_id = ? AND status = 'RECEIVED'").get(tenantId) as any
    const totalValue = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM purchase_orders WHERE tenant_id = ? AND status != 'CANCELLED'").get(tenantId) as any

    res.json({
      success: true,
      data: {
        totalOrders: total.count,
        draftOrders: draft.count,
        pendingOrders: pending.count,
        receivedOrders: received.count,
        totalValue: totalValue.total,
      },
    })
  } catch (error) {
    console.error('PO stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

// GET single PO with items
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const po = db.prepare(`
      SELECT po.*, s.name as supplier_name, s.code as supplier_code, s.email as supplier_email, s.phone as supplier_phone
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = ? AND po.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(req.params.id)

    res.json({ success: true, data: { ...po, items } })
  } catch (error) {
    console.error('Get PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase order' })
  }
})

// POST create PO
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, expectedDate, notes, items, taxRate, linkedPrId } = req.body
    const id = generateId()
    const poNumber = generatePONumber(tenantId)
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const tax = taxRate || 0
    const taxAmount = subtotal * (tax / 100)
    const totalAmount = subtotal + taxAmount

    const insertPO = db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
        subtotal, tax_rate, tax_amount, total_amount, notes, linked_pr_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, 
        quantity, unit, unit_price, total_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = db.transaction(() => {
      insertPO.run(id, tenantId, poNumber, supplierId, now, expectedDate || null,
        subtotal, tax, taxAmount, totalAmount, notes || '', linkedPrId || null, now, now)

      if (items && items.length > 0) {
        for (const item of items) {
          insertItem.run(
            generateId(), tenantId, id, item.materialId || null, item.description || '',
            item.quantity, item.unit || '', item.unitPrice, item.quantity * item.unitPrice,
            item.notes || ''
          )
        }
      }
    })

    transaction()

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id)
    const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...po, items: poItems } })
  } catch (error) {
    console.error('Create PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase order' })
  }
})

// PUT update PO status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'PARTIAL', 'CANCELLED']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    // Check PO exists and belongs to tenant
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    const now = new Date().toISOString()
    const updates: any = { status, updated_at: now }

    if (status === 'RECEIVED') {
      updates.received_date = now
      // Auto update stock when received
      const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(req.params.id) as any[]

      const updateStock = db.transaction(() => {
        db.prepare("UPDATE purchase_orders SET status = ?, received_date = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, now, req.params.id, tenantId)

        for (const item of items) {
          if (item.material_id) {
            // Update stock item quantity if exists
            const stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
            if (stockItem) {
              db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
                .run(Math.floor(item.quantity), now, stockItem.id)

              // Record movement
              db.prepare(`
                INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, 'system')
              `).run(generateId(), tenantId, stockItem.id, Math.floor(item.quantity), `PO: ${req.params.id}`, `Received from PO`, now)
            }
          }
          // Update received qty
          db.prepare('UPDATE purchase_order_items SET received_qty = ? WHERE id = ?')
            .run(item.quantity, item.id)
        }
      })

      updateStock()
    } else {
      db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updatedPO = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updatedPO })
  } catch (error) {
    console.error('Update PO status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// PUT update PO
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, expectedDate, notes, items, taxRate } = req.body
    const now = new Date().toISOString()

    // Check PO exists and belongs to tenant
    const existing = db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const tax = taxRate || 0
    const taxAmount = subtotal * (tax / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE purchase_orders SET supplier_id = COALESCE(?, supplier_id), expected_date = ?,
        subtotal = ?, tax_rate = ?, tax_amount = ?, total_amount = ?, notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(supplierId, expectedDate || null, subtotal, tax, taxAmount, totalAmount, notes, now, req.params.id, tenantId)

      if (items) {
        db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(req.params.id)
        const insertItem = db.prepare(`
          INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, 
            quantity, unit, unit_price, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(
            generateId(), tenantId, req.params.id, item.materialId || null, item.description || '',
            item.quantity, item.unit || '', item.unitPrice, item.quantity * item.unitPrice,
            item.notes || ''
          )
        }
      }
    })

    transaction()

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id)
    const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(req.params.id)
    res.json({ success: true, data: { ...po, items: poItems } })
  } catch (error) {
    console.error('Update PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to update purchase order' })
  }
})

// DELETE PO
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }
    if (po.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: 'Can only delete draft purchase orders' })
    }

    db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(req.params.id)
    db.prepare('DELETE FROM purchase_orders WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Purchase order deleted' })
  } catch (error) {
    console.error('Delete PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete purchase order' })
  }
})

export default router
