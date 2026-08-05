import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { formatDocumentNumber } from '../utils/id'

// Additive multi-currency columns. Guarded so it only runs once per fresh DB, same
// pattern as tax.routes.ts's wht_form column.
function ensurePOCurrencyColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(purchase_orders)').all() as { name: string }[]
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('currency_code')) db.exec("ALTER TABLE purchase_orders ADD COLUMN currency_code TEXT DEFAULT 'THB'")
    if (!names.has('exchange_rate')) db.exec('ALTER TABLE purchase_orders ADD COLUMN exchange_rate REAL DEFAULT 1')
    if (!names.has('foreign_amount')) db.exec('ALTER TABLE purchase_orders ADD COLUMN foreign_amount REAL')
  } catch (error) {
    console.error('Failed to ensure PO currency columns:', error)
  }
}
ensurePOCurrencyColumns()

const router = Router()

// ทุก Route ต้องมี Authentication
router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

const round2 = (n: number) => Math.round(n * 100) / 100

function generatePONumber(tenantId: string) {
  return formatDocumentNumber('PO', tenantId, 'PO', undefined, 5)
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
    const { supplierId, expectedDate, notes, items, taxRate, linkedPrId, currencyCode, exchangeRate } = req.body
    const id = generateId()
    const poNumber = generatePONumber(tenantId)
    const now = new Date().toISOString()

    // Calculate totals (in whatever currency the items were entered in)
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const tax = taxRate || 0
    let taxAmount = subtotal * (tax / 100)
    let totalAmount = subtotal + taxAmount

    // ponytail: only the document header (subtotal/tax/total) is converted to THB — line
    // items keep whatever unit price was entered. No ledger/stock changes here; THB (default)
    // path is untouched (currency_code stays 'THB', exchange_rate 1, foreign_amount null).
    let currency_code = 'THB'
    let exchange_rate = 1
    let foreign_amount: number | null = null
    if (currencyCode && currencyCode !== 'THB') {
      const currency = db.prepare('SELECT code FROM currencies WHERE tenant_id = ? AND code = ? AND is_active = 1')
        .get(tenantId, currencyCode) as { code: string } | undefined
      if (!currency) {
        return res.status(400).json({ success: false, message: 'ไม่พบสกุลเงินที่ระบุ หรือสกุลเงินถูกปิดใช้งาน' })
      }
      const rate = Number(exchangeRate)
      if (!Number.isFinite(rate) || rate <= 0) {
        return res.status(400).json({ success: false, message: 'อัตราแลกเปลี่ยนไม่ถูกต้อง' })
      }
      currency_code = currencyCode
      exchange_rate = rate
      foreign_amount = round2(totalAmount)
      subtotal = round2(subtotal * rate)
      taxAmount = round2(taxAmount * rate)
      totalAmount = round2(totalAmount * rate)
    }

    const insertPO = db.prepare(`
      INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
        subtotal, tax_rate, tax_amount, total_amount, notes, linked_pr_id, created_at, updated_at,
        currency_code, exchange_rate, foreign_amount)
      VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, 
        quantity, unit, unit_price, total_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = db.transaction(() => {
      insertPO.run(id, tenantId, poNumber, supplierId, now, expectedDate || null,
        subtotal, tax, taxAmount, totalAmount, notes || '', linkedPrId || null, now, now,
        currency_code, exchange_rate, foreign_amount)

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

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
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

    // Cancelling a PO posts no journal of its own — the real AP/inventory entries
    // are booked at GR confirm and PI creation (see purchase.routes.ts), which now
    // have their own CANCELLED reversal logic. Block a PO cancel while those
    // downstream documents are still active so a cancel here can never leave
    // stock/AP without a matching reversal.
    if (status === 'CANCELLED') {
      const activeGR = db.prepare(
        "SELECT id, gr_number FROM goods_receipts WHERE tenant_id = ? AND purchase_order_id = ? AND status = 'CONFIRMED'"
      ).get(tenantId, req.params.id) as any
      if (activeGR) {
        return res.status(400).json({
          success: false,
          message: `ไม่สามารถยกเลิกใบสั่งซื้อได้ — มีใบรับสินค้า ${activeGR.gr_number} ที่ยืนยันแล้ว กรุณายกเลิกใบรับสินค้าก่อน`,
        })
      }
      const activeInvoice = db.prepare(
        "SELECT id, pi_number FROM purchase_invoices WHERE tenant_id = ? AND purchase_order_id = ? AND status != 'CANCELLED'"
      ).get(tenantId, req.params.id) as any
      if (activeInvoice) {
        return res.status(400).json({
          success: false,
          message: `ไม่สามารถยกเลิกใบสั่งซื้อได้ — มีใบแจ้งหนี้ ${activeInvoice.pi_number} อ้างอิงอยู่ กรุณายกเลิกใบแจ้งหนี้ก่อน`,
        })
      }
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
            const stockItem = (db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId)
              || db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId)) as any
            if (stockItem) {
              db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
                .run(Math.floor(item.quantity), now, stockItem.id, tenantId)

              // Record movement
              db.prepare(`
                INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
                VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, 'system')
              `).run(generateId(), tenantId, stockItem.id, Math.floor(item.quantity), `PO: ${req.params.id}`, `Received from PO`, now)
            }
          }
          // Update received qty
          db.prepare('UPDATE purchase_order_items SET received_qty = ? WHERE id = ? AND tenant_id = ?')
            .run(item.quantity, item.id, tenantId)
        }
      })

      updateStock()

      // No accounting entry here on purpose: this simple status endpoint and
      // the goods-receipt flow (purchase.routes.ts, /goods-receipts/:id/confirm)
      // both set purchase_orders.status = 'RECEIVED', but only the latter is
      // actually used in practice, and the real AP/inventory entry is booked
      // later at Purchase Invoice creation (purchase.routes.ts, POST /invoices).
      // Posting here too would double-book the same purchase when an invoice
      // is created afterward — see postPurchaseOrderReceived() for why it's
      // unused, kept only as a documented reference for a future "book at
      // receiving instead of at invoice" redesign if that's ever wanted.
    } else {
      db.prepare("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updatedPO = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
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

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
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

    db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    db.prepare('DELETE FROM purchase_orders WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Purchase order deleted' })
  } catch (error) {
    console.error('Delete PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete purchase order' })
  }
})


// -- POST /api/purchase-orders/:id/approve
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId, email, role } = req.user!
    const po = db.prepare("SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ? AND status = 'SUBMITTED'")
      .get(req.params.id, tenantId) as any
    if (!po) return res.status(404).json({ success: false, message: 'PO not found or not in SUBMITTED status' })

    if (role !== 'MASTER' && role !== 'ADMIN') {
      const setting = db.prepare("SELECT * FROM approval_settings WHERE tenant_id = ? AND role = ? AND module_type = 'purchase_order'")
        .get(tenantId, role) as any
      const poAmount = po.total_amount || 0
      const autoApprove = setting && setting.auto_approve_threshold > 0 && poAmount <= setting.auto_approve_threshold
      if (!autoApprove) {
        const perm = db.prepare("SELECT * FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND module_type = 'purchase_order'")
          .get(tenantId, userId) as any
        if (!perm || perm.can_approve !== 1)
          return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์อนุมัติ PO กรุณาติดต่อ Admin' })
        if (perm.can_approve_unlimited !== 1 && perm.approval_limit > 0 && poAmount > perm.approval_limit)
          return res.status(403).json({ success: false, message: 'วงเงินอนุมัติของคุณไม่เพียงพอ (limit: ' + perm.approval_limit.toLocaleString() + ', ยอด PO: ' + poAmount.toLocaleString() + ')' })
      }
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(userId, now, now, req.params.id, tenantId)

    try {
      const { randomUUID } = require('crypto')
      const logId = randomUUID().replace(/-/g, '').substring(0, 25)
      const existingReq = db.prepare("SELECT id FROM approval_requests WHERE tenant_id = ? AND reference_type = 'purchase_orders' AND reference_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(tenantId, po.id) as any
      if (existingReq) {
        db.prepare('INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role, comment, old_status, new_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(logId, tenantId, existingReq.id, 'APPROVED', userId, email, role, 'Approved', 'PENDING', 'APPROVED', now)
        db.prepare("UPDATE approval_requests SET status = 'APPROVED', updated_at = ? WHERE id = ?").run(now, existingReq.id)
      }
    } catch (_) {}

    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated, message: 'PO approved' })
  } catch (error) {
    console.error('Approve PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to approve PO' })
  }
})

// -- POST /api/purchase-orders/:id/reject
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { tenantId, userId, email, role } = req.user!
    const { reason } = req.body
    if (!reason || !String(reason).trim())
      return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผลการปฏิเสธ' })

    const po = db.prepare("SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ? AND status = 'SUBMITTED'")
      .get(req.params.id, tenantId) as any
    if (!po) return res.status(404).json({ success: false, message: 'PO not found or not in SUBMITTED status' })

    if (role !== 'MASTER' && role !== 'ADMIN') {
      const perm = db.prepare("SELECT * FROM user_approval_permissions WHERE tenant_id = ? AND user_id = ? AND module_type = 'purchase_order'")
        .get(tenantId, userId) as any
      if (!perm || perm.can_approve !== 1)
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ปฏิเสธ PO กรุณาติดต่อ Admin' })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE purchase_orders SET status = 'REJECTED', approved_by = ?, approved_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(userId, now, String(reason).trim(), now, req.params.id, tenantId)

    try {
      const { randomUUID } = require('crypto')
      const logId = randomUUID().replace(/-/g, '').substring(0, 25)
      const existingReq = db.prepare("SELECT id FROM approval_requests WHERE tenant_id = ? AND reference_type = 'purchase_orders' AND reference_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(tenantId, po.id) as any
      if (existingReq) {
        db.prepare('INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role, comment, old_status, new_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(logId, tenantId, existingReq.id, 'REJECTED', userId, email, role, String(reason).trim(), 'PENDING', 'REJECTED', now)
        db.prepare("UPDATE approval_requests SET status = 'REJECTED', updated_at = ? WHERE id = ?").run(now, existingReq.id)
      }
    } catch (_) {}

    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated, message: 'PO rejected' })
  } catch (error) {
    console.error('Reject PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to reject PO' })
  }
})



export default router
