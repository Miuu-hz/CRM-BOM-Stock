import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function generateNumber(prefix: string, tenantId: string, table: string) {
  const count = (db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ?`).get(tenantId) as any).count
  const year = new Date().getFullYear()
  return `${prefix}-${year}-${String(count + 1).padStart(5, '0')}`
}

function generateEntryNumber(tenantId: string, date: string): string {
  const year = new Date(date).getFullYear()
  const count = (db.prepare(
    "SELECT COUNT(*) as count FROM journal_entries WHERE strftime('%Y', date) = ? AND tenant_id = ?"
  ).get(year.toString(), tenantId) as any).count
  return `JV-${year}-${String(count + 1).padStart(5, '0')}`
}

function getOrCreateAccount(tenantId: string, code: string, name: string, type: string, category: string, normalBalance: string): string {
  const existing = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as any
  if (existing) return existing.id
  const id = generateId()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, code, name, type, category, normalBalance, now, now)
  return id
}

// ============================================
// PURCHASE REQUESTS (PR)
// ============================================

// GET all purchase requests
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const requests = db.prepare(`
      SELECT pr.*, 
        (SELECT COUNT(*) FROM purchase_request_items WHERE purchase_request_id = pr.id) as item_count
      FROM purchase_requests pr
      WHERE pr.tenant_id = ?
      ORDER BY pr.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: requests })
  } catch (error) {
    console.error('Get purchase requests error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase requests' })
  }
})

// GET single purchase request
router.get('/requests/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const request = db.prepare(`
      SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
    }

    const items = db.prepare(`
      SELECT pri.*, m.name as material_name, m.code as material_code
      FROM purchase_request_items pri
      LEFT JOIN materials m ON pri.material_id = m.id
      WHERE pri.purchase_request_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...request, items } })
  } catch (error) {
    console.error('Get purchase request error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase request' })
  }
})

// DELETE purchase request (DRAFT only)
router.delete('/requests/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase request not found' })
    if (pr.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'Only DRAFT requests can be deleted' })
    db.transaction(() => {
      db.prepare('DELETE FROM purchase_request_items WHERE purchase_request_id = ?').run(req.params.id)
      db.prepare('DELETE FROM purchase_requests WHERE id = ?').run(req.params.id)
    })()
    res.json({ success: true, message: 'Purchase request deleted' })
  } catch (error) {
    console.error('Delete purchase request error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete purchase request' })
  }
})

// POST create purchase request
router.post('/requests', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { department, requiredDate, priority, notes, items } = req.body
    
    const id = generateId()
    const prNumber = generateNumber('PR', tenantId, 'purchase_requests')
    const now = new Date().toISOString()

    // Calculate total
    let totalAmount = 0
    if (items && items.length > 0) {
      totalAmount = items.reduce((sum: number, item: any) => sum + (item.estimatedTotalPrice || 0), 0)
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, department, 
          request_date, required_date, total_amount, status, priority, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
      `).run(id, tenantId, prNumber, req.user!.userId, req.user!.email, department || '', 
        now, requiredDate || null, totalAmount, priority || 'NORMAL', notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_request_items (id, tenant_id, purchase_request_id, material_id, description, 
            quantity, unit, estimated_unit_price, estimated_total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(generateId(), tenantId, id, item.materialId || null, item.description,
            item.quantity, item.unit || '', item.estimatedUnitPrice || 0, item.estimatedTotalPrice || 0, item.notes || '')
        }
      }
    })

    transaction()

    const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id)
    const requestItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...request, items: requestItems } })
  } catch (error) {
    console.error('Create purchase request error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase request' })
  }
})

// PUT update PR status (approve/reject)
router.put('/requests/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
    }

    const now = new Date().toISOString()
    const updates: any = { status, updated_at: now }
    
    if (status === 'APPROVED') {
      updates.approved_by = req.user!.userId
      updates.approved_date = now
    }

    db.prepare(`
      UPDATE purchase_requests SET status = ?, approved_by = ?, approved_date = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(status, updates.approved_by || null, updates.approved_date || null, now, req.params.id, tenantId)

    const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: request })
  } catch (error) {
    console.error('Update PR status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// POST create PO from PR
router.post('/requests/:id/convert-to-po', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, expectedDate } = req.body
    
    // Get PR
    const pr = db.prepare('SELECT * FROM purchase_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!pr) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' })
    }

    if (pr.status !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Purchase request must be approved first' })
    }

    const prItems = db.prepare('SELECT * FROM purchase_request_items WHERE purchase_request_id = ?').all(req.params.id) as any[]
    
    const now = new Date().toISOString()
    const poId = generateId()
    const poNumber = generateNumber('PO', tenantId, 'purchase_orders')

    // Calculate totals
    let subtotal = 0
    for (const item of prItems) {
      subtotal += item.estimated_unit_price * item.quantity
    }
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      // Create PO
      db.prepare(`
        INSERT INTO purchase_orders (id, tenant_id, po_number, supplier_id, status, order_date, expected_date,
          subtotal, tax_rate, tax_amount, total_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(poId, tenantId, poNumber, supplierId, now, expectedDate || null,
        subtotal, taxRate, taxAmount, totalAmount, `Created from PR: ${pr.pr_number}`, now, now)

      // Create PO items
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (id, tenant_id, purchase_order_id, material_id, description, 
          quantity, unit_price, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of prItems) {
        const total = item.estimated_unit_price * item.quantity
        insertItem.run(generateId(), tenantId, poId, item.material_id, item.description,
          item.quantity, item.estimated_unit_price, total, item.notes || '')
      }

      // Update PR status
      db.prepare("UPDATE purchase_requests SET status = 'CONVERTED', updated_at = ? WHERE id = ?")
        .run(now, req.params.id)
    })

    transaction()

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId)
    const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(poId)

    res.status(201).json({ 
      success: true, 
      data: { ...po, items: poItems },
      message: 'Purchase order created successfully'
    })
  } catch (error) {
    console.error('Convert PR to PO error:', error)
    res.status(500).json({ success: false, message: 'Failed to convert to purchase order' })
  }
})

// ============================================
// GOODS RECEIPTS (GRN)
// ============================================

// GET all goods receipts
router.get('/goods-receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const receipts = db.prepare(`
      SELECT gr.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number,
        (SELECT COUNT(*) FROM goods_receipt_items WHERE goods_receipt_id = gr.id) as item_count
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      WHERE gr.tenant_id = ?
      ORDER BY gr.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: receipts })
  } catch (error) {
    console.error('Get goods receipts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch goods receipts' })
  }
})

// GET single goods receipt
router.get('/goods-receipts/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const receipt = db.prepare(`
      SELECT gr.*, s.name as supplier_name, s.code as supplier_code, s.email as supplier_email,
        po.po_number
      FROM goods_receipts gr
      LEFT JOIN suppliers s ON gr.supplier_id = s.id
      LEFT JOIN purchase_orders po ON gr.purchase_order_id = po.id
      WHERE gr.id = ? AND gr.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found' })
    }

    const items = db.prepare(`
      SELECT gri.*, m.name as material_name, m.code as material_code, m.unit
      FROM goods_receipt_items gri
      LEFT JOIN materials m ON gri.material_id = m.id
      WHERE gri.goods_receipt_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...receipt, items } })
  } catch (error) {
    console.error('Get goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch goods receipt' })
  }
})

// POST create goods receipt from PO
router.post('/goods-receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { purchaseOrderId, receiptDate, receivedBy, notes, items, deliveryNoteNo } = req.body
    
    if (!purchaseOrderId) {
      return res.status(400).json({ success: false, message: 'Purchase order is required' })
    }

    // Get PO details
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    // Block if PO already fully received
    if (po.status === 'RECEIVED') {
      return res.status(400).json({ success: false, message: 'ใบสั่งซื้อนี้รับสินค้าครบแล้ว' })
    }

    // Block if there is already a DRAFT GR waiting to be confirmed for this PO
    const existingDraft = db.prepare(
      "SELECT id, gr_number FROM goods_receipts WHERE purchase_order_id = ? AND tenant_id = ? AND status = 'DRAFT'"
    ).get(purchaseOrderId, tenantId) as any
    if (existingDraft) {
      return res.status(400).json({
        success: false,
        message: `มีใบรับสินค้าร่าง ${existingDraft.gr_number} รออยู่ — กรุณายืนยันหรือลบก่อนสร้างใหม่`,
      })
    }

    const id = generateId()
    const grNumber = generateNumber('GR', tenantId, 'goods_receipts')
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // Create GR
      db.prepare(`
        INSERT INTO goods_receipts (id, tenant_id, gr_number, purchase_order_id, supplier_id, receipt_date,
          received_by, status, notes, delivery_note_no, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
      `).run(id, tenantId, grNumber, purchaseOrderId, po.supplier_id, receiptDate || now,
        receivedBy || req.user!.email, notes || '', deliveryNoteNo || null, now, now)

      // Create GR items
      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO goods_receipt_items (id, tenant_id, goods_receipt_id, purchase_order_item_id, material_id,
            ordered_qty, received_qty, accepted_qty, rejected_qty, lot_number, location, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(
            generateId(), tenantId, id, item.poItemId, item.materialId,
            item.orderedQty, item.receivedQty, item.acceptedQty || item.receivedQty,
            item.rejectedQty || 0, item.lotNumber || null, item.location || null, item.notes || ''
          )
        }
      }
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM goods_receipts WHERE id = ?').get(id)
    const receiptItems = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...receipt, items: receiptItems } })
  } catch (error) {
    console.error('Create goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to create goods receipt' })
  }
})

// DELETE GR (DRAFT only)
router.delete('/goods-receipts/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) return res.status(404).json({ success: false, message: 'Not found' })
    if (gr.status !== 'DRAFT') return res.status(400).json({ success: false, message: 'ลบได้เฉพาะ GR ที่ยังเป็นร่างเท่านั้น' })
    db.transaction(() => {
      db.prepare('DELETE FROM goods_receipt_items WHERE goods_receipt_id = ?').run(req.params.id)
      db.prepare('DELETE FROM goods_receipts WHERE id = ?').run(req.params.id)
    })()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete goods receipt' })
  }
})

// PUT confirm goods receipt (update stock)
router.put('/goods-receipts/:id/confirm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const gr = db.prepare('SELECT * FROM goods_receipts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!gr) {
      return res.status(404).json({ success: false, message: 'Goods receipt not found' })
    }

    if (gr.status === 'CONFIRMED') {
      return res.status(400).json({ success: false, message: 'Goods receipt already confirmed' })
    }

    const items = db.prepare('SELECT * FROM goods_receipt_items WHERE goods_receipt_id = ?').all(req.params.id) as any[]
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // Update GR status
      db.prepare("UPDATE goods_receipts SET status = 'CONFIRMED', updated_at = ? WHERE id = ?")
        .run(now, req.params.id)

      // Update stock and PO received qty
      for (const item of items) {
        if (item.material_id && item.accepted_qty > 0) {
          // Get actual unit_price from PO item to update stock cost
          const poItem = db.prepare('SELECT unit_price FROM purchase_order_items WHERE id = ?').get(item.purchase_order_item_id) as any
          const unitPrice = poItem?.unit_price || 0

          // Find stock item: first by material_id (BOM flow), then directly by id (standalone stock flow)
          let stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          if (!stockItem) {
            stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          }

          if (stockItem) {
            // Update quantity + unit_cost (latest purchase price)
            db.prepare('UPDATE stock_items SET quantity = quantity + ?, unit_cost = ?, updated_at = ? WHERE id = ?')
              .run(Math.floor(item.accepted_qty), unitPrice || stockItem.unit_cost, now, stockItem.id)
          } else {
            // Create new stock item (BOM material not yet in stock)
            const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(item.material_id) as any
            if (material) {
              const newStockId = generateId()
              db.prepare(`
                INSERT INTO stock_items (id, tenant_id, sku, name, category, material_id, quantity, unit, unit_cost, location, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STOCK', 'ACTIVE', ?, ?)
              `).run(newStockId, tenantId, material.code, material.name, 'RAW_MATERIAL', item.material_id,
                Math.floor(item.accepted_qty), material.unit || 'pcs', unitPrice, now, now)
              stockItem = { id: newStockId }
            }
          }

          if (stockItem) {
            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, Math.floor(item.accepted_qty), `GR: ${gr.gr_number}`,
              `Received from purchase`, now, req.user!.userId)
          }

          // Update PO item received qty
          db.prepare('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE id = ?')
            .run(item.accepted_qty, item.purchase_order_item_id)
        }
      }

      // Check if PO fully received
      const poItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(gr.purchase_order_id) as any[]
      const allReceived = poItems.every((item: any) => item.received_qty >= item.quantity)
      
      if (allReceived) {
        db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_date = ?, updated_at = ? WHERE id = ?")
          .run(now, now, gr.purchase_order_id)
      } else {
        db.prepare("UPDATE purchase_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ?")
          .run(now, gr.purchase_order_id)
      }
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM goods_receipts WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: receipt, message: 'Goods receipt confirmed and stock updated' })
  } catch (error) {
    console.error('Confirm goods receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to confirm goods receipt' })
  }
})

// GET pending PO items for GR
router.get('/goods-receipts/pending-items/:poId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const items = db.prepare(`
      SELECT
        poi.id, poi.purchase_order_id, poi.material_id,
        poi.description, poi.quantity, poi.unit_price, poi.total_price,
        poi.received_qty,
        (poi.quantity - poi.received_qty) AS pending_qty,
        si.name  AS material_name,
        si.sku   AS material_code,
        si.unit  AS unit
      FROM purchase_order_items poi
      LEFT JOIN stock_items si ON poi.material_id = si.id
      WHERE poi.purchase_order_id = ?
        AND poi.quantity > poi.received_qty
    `).all(req.params.poId)

    res.json({ success: true, data: items })
  } catch (error) {
    console.error('Get pending items error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending items' })
  }
})

// ============================================
// PURCHASE INVOICES
// ============================================

// GET all purchase invoices
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoices = db.prepare(`
      SELECT pi.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number, gr.gr_number
      FROM purchase_invoices pi
      LEFT JOIN suppliers s ON pi.supplier_id = s.id
      LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
      LEFT JOIN goods_receipts gr ON pi.goods_receipt_id = gr.id
      WHERE pi.tenant_id = ?
      ORDER BY pi.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: invoices })
  } catch (error) {
    console.error('Get purchase invoices error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase invoices' })
  }
})

// GET single purchase invoice
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoice = db.prepare(`
      SELECT pi.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number, gr.gr_number
      FROM purchase_invoices pi
      LEFT JOIN suppliers s ON pi.supplier_id = s.id
      LEFT JOIN purchase_orders po ON pi.purchase_order_id = po.id
      LEFT JOIN goods_receipts gr ON pi.goods_receipt_id = gr.id
      WHERE pi.id = ? AND pi.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Purchase invoice not found' })
    }

    const items = db.prepare(`
      SELECT pii.*, m.name as material_name, m.code as material_code
      FROM purchase_invoice_items pii
      LEFT JOIN materials m ON pii.material_id = m.id
      WHERE pii.purchase_invoice_id = ?
    `).all(req.params.id)

    const payments = db.prepare(`
      SELECT * FROM supplier_payments WHERE purchase_invoice_id = ? ORDER BY payment_date DESC
    `).all(req.params.id)

    res.json({ success: true, data: { ...invoice, items, payments } })
  } catch (error) {
    console.error('Get purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase invoice' })
  }
})

// POST create purchase invoice from GR
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { purchaseOrderId, goodsReceiptId, goodsReceiptIds, supplierInvoiceNumber, invoiceDate, dueDate, notes, items, drAccountId } = req.body
    // Support both multi-select (goodsReceiptIds array) and legacy single (goodsReceiptId)
    const grIds: string[] = Array.isArray(goodsReceiptIds) && goodsReceiptIds.length > 0
      ? goodsReceiptIds
      : (goodsReceiptId ? [goodsReceiptId] : [])
    const grIdsJson = JSON.stringify(grIds)
    
    if (!purchaseOrderId) {
      return res.status(400).json({ success: false, message: 'Purchase order is required' })
    }

    // Get PO and Supplier
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    const id = generateId()
    const piNumber = generateNumber('PI', tenantId, 'purchase_invoices')
    const now = new Date().toISOString()

    // Calculate totals from items or use PO totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    } else {
      subtotal = po.subtotal
    }
    
    const taxRate = po.tax_rate || 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    // Resolve accounts before transaction (auto-create if not yet in chart of accounts)
    // drAccountId: optional override — if supplied, use it; otherwise default to 1107 สต็อกวัตถุดิบ
    const resolvedDrAccId = drAccountId
      ? (db.prepare('SELECT id FROM accounts WHERE id = ? AND tenant_id = ?').get(drAccountId, tenantId) as any)?.id ?? null
      : null
    const inventoryAccId = resolvedDrAccId
      ?? getOrCreateAccount(tenantId, '1107', 'สต็อกวัตถุดิบ', 'ASSET', 'CURRENT_ASSET', 'DEBIT')
    const payableAccId   = getOrCreateAccount(tenantId, '2101', 'เจ้าหนี้การค้า', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT')
    const vatAccId       = taxAmount > 0 ? getOrCreateAccount(tenantId, '1110', 'ภาษีซื้อ', 'ASSET', 'CURRENT_ASSET', 'DEBIT') : null
    const journalId      = generateId()
    const journalNumber  = generateEntryNumber(tenantId, invoiceDate || now)

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_invoices (id, tenant_id, pi_number, supplier_invoice_number, purchase_order_id,
          supplier_id, goods_receipt_id, goods_receipt_ids, invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount,
          balance_amount, status, payment_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', 'UNPAID', ?, ?, ?)
      `).run(id, tenantId, piNumber, supplierInvoiceNumber || '', purchaseOrderId, po.supplier_id,
        grIds[0] || null, grIdsJson, invoiceDate || now, dueDate || null, subtotal, taxRate, taxAmount,
        totalAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_invoice_items (id, tenant_id, purchase_invoice_id, purchase_order_item_id,
            material_id, quantity, unit_price, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.poItemId, item.materialId,
            item.quantity, item.unitPrice, total)
        }
      }

      // === POST JOURNAL ENTRY ===
      // Dr สต็อกวัตถุดิบ (1107)   + Dr ภาษีซื้อ (1110) if VAT
      // Cr เจ้าหนี้การค้า (2101)
      db.prepare(`
        INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PURCHASE_INVOICE', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(journalId, tenantId, journalNumber, (invoiceDate || now).substring(0, 10),
        id, `รับใบแจ้งหนี้ซื้อ ${piNumber}`, totalAmount, totalAmount, notes || null,
        req.user!.email, now, now)

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let lineNo = 1
      const drAccLabel = resolvedDrAccId
        ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(resolvedDrAccId) as any)?.name ?? 'ค่าใช้จ่าย'
        : 'สต็อกวัตถุดิบ'
      insertLine.run(generateId(), tenantId, journalId, inventoryAccId, lineNo++, `${drAccLabel} - ${piNumber}`, subtotal, 0)
      if (vatAccId && taxAmount > 0) {
        insertLine.run(generateId(), tenantId, journalId, vatAccId, lineNo++, `ภาษีซื้อ - ${piNumber}`, taxAmount, 0)
      }
      insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${piNumber}`, 0, totalAmount)
    })

    transaction()

    const invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id)
    const invoiceItems = db.prepare('SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...invoice, items: invoiceItems } })
  } catch (error) {
    console.error('Create purchase invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase invoice' })
  }
})

// ============================================
// SUPPLIER PAYMENTS
// ============================================

// GET all supplier payments
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const payments = db.prepare(`
      SELECT sp.*, s.name as supplier_name, s.code as supplier_code,
        pi.pi_number
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.tenant_id = ?
      ORDER BY sp.payment_date DESC
    `).all(tenantId)

    res.json({ success: true, data: payments })
  } catch (error) {
    console.error('Get supplier payments error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch supplier payments' })
  }
})

// GET single supplier payment
router.get('/payments/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const payment = db.prepare(`
      SELECT sp.*, s.name as supplier_name, s.code as supplier_code,
        pi.pi_number, pi.supplier_invoice_number
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.id = ? AND sp.tenant_id = ?
    `).get(req.params.id, tenantId)
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' })
    res.json({ success: true, data: payment })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment' })
  }
})

// POST create supplier payment
router.post('/payments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { supplierId, purchaseInvoiceId, paymentDate, paymentMethod, paymentReference, amount, withholdingTax, notes } = req.body
    
    if (!supplierId || !amount) {
      return res.status(400).json({ success: false, message: 'Supplier and amount are required' })
    }

    // Check invoice if provided
    let invoice: any = null
    if (purchaseInvoiceId) {
      invoice = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND tenant_id = ?').get(purchaseInvoiceId, tenantId)
      if (!invoice) {
        return res.status(404).json({ success: false, message: 'Purchase invoice not found' })
      }
      if (amount > invoice.balance_amount) {
        return res.status(400).json({ success: false, message: 'Payment amount exceeds invoice balance' })
      }
    }

    const id = generateId()
    const paymentNumber = generateNumber('SP', tenantId, 'supplier_payments')
    const now = new Date().toISOString()
    const wht = withholdingTax || 0
    const netAmount = amount - wht

    // Resolve accounts before transaction
    const payableAccId = getOrCreateAccount(tenantId, '2101', 'เจ้าหนี้การค้า', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT')
    const cashAccId    = getOrCreateAccount(tenantId, '1101', 'เงินสด', 'ASSET', 'CURRENT_ASSET', 'DEBIT')
    const whtAccId     = wht > 0 ? getOrCreateAccount(tenantId, '2180', 'ภาษีหัก ณ ที่จ่าย', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT') : null
    const journalId    = generateId()
    const journalNumber = generateEntryNumber(tenantId, paymentDate || now)

    const transaction = db.transaction(() => {
      // Create payment
      db.prepare(`
        INSERT INTO supplier_payments (id, tenant_id, payment_number, supplier_id, purchase_invoice_id,
          payment_date, payment_method, payment_reference, amount, withholding_tax, net_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, paymentNumber, supplierId, purchaseInvoiceId || null, paymentDate || now,
        paymentMethod || 'TRANSFER', paymentReference || '', amount, wht, netAmount, notes || '', now, now)

      // Update invoice if provided
      if (invoice) {
        const newPaid = invoice.paid_amount + amount
        const newBalance = invoice.total_amount - newPaid
        let paymentStatus = 'PARTIAL'
        if (newBalance <= 0) paymentStatus = 'PAID'

        db.prepare(`
          UPDATE purchase_invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, updated_at = ?
          WHERE id = ?
        `).run(newPaid, newBalance, paymentStatus, now, purchaseInvoiceId)
      }

      // === POST JOURNAL ENTRY ===
      // Dr เจ้าหนี้การค้า (2101)
      // Cr เงินสด/ธนาคาร (1101)   + Cr ภาษีหัก ณ ที่จ่าย (2180) if WHT > 0
      db.prepare(`
        INSERT INTO journal_entries (id, tenant_id, entry_number, date, reference_type, reference_id,
          description, total_debit, total_credit, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'SUPPLIER_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(journalId, tenantId, journalNumber, (paymentDate || now).substring(0, 10),
        id, `จ่ายชำระ ${paymentNumber}`, amount, amount, notes || null,
        req.user!.email, now, now)

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let lineNo = 1
      insertLine.run(generateId(), tenantId, journalId, payableAccId, lineNo++, `เจ้าหนี้การค้า - ${paymentNumber}`, amount, 0)
      insertLine.run(generateId(), tenantId, journalId, cashAccId, lineNo++, `จ่ายเงิน - ${paymentNumber}`, 0, netAmount)
      if (whtAccId && wht > 0) {
        insertLine.run(generateId(), tenantId, journalId, whtAccId, lineNo++, `ภาษีหัก ณ ที่จ่าย - ${paymentNumber}`, 0, wht)
      }
    })

    transaction()

    const payment = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: payment, message: 'Payment recorded successfully' })
  } catch (error) {
    console.error('Create supplier payment error:', error)
    res.status(500).json({ success: false, message: 'Failed to record payment' })
  }
})

// ============================================
// PURCHASE RETURNS
// ============================================

// GET all purchase returns
router.get('/returns', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const returns = db.prepare(`
      SELECT pr.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.tenant_id = ?
      ORDER BY pr.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: returns })
  } catch (error) {
    console.error('Get purchase returns error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase returns' })
  }
})

// GET single purchase return
router.get('/returns/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const ret = db.prepare(`
      SELECT pr.*, s.name as supplier_name, s.code as supplier_code,
        po.po_number
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.id = ? AND pr.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!ret) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' })
    }

    const items = db.prepare(`
      SELECT pri.*, m.name as material_name, m.code as material_code
      FROM purchase_return_items pri
      LEFT JOIN materials m ON pri.material_id = m.id
      WHERE pri.purchase_return_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...ret, items } })
  } catch (error) {
    console.error('Get purchase return error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch purchase return' })
  }
})

// POST create purchase return
router.post('/returns', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { purchaseOrderId, goodsReceiptId, reason, notes, items } = req.body
    
    if (!purchaseOrderId || !reason) {
      return res.status(400).json({ success: false, message: 'Purchase order and reason are required' })
    }

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND tenant_id = ?').get(purchaseOrderId, tenantId) as any
    if (!po) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' })
    }

    const id = generateId()
    const prNumber = generateNumber('PRT', tenantId, 'purchase_returns')
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_returns (id, tenant_id, pr_number, purchase_order_id, goods_receipt_id, 
          supplier_id, return_date, reason, subtotal, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, prNumber, purchaseOrderId, goodsReceiptId || null, po.supplier_id,
        now, reason, subtotal, taxRate, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO purchase_return_items (id, tenant_id, purchase_return_id, goods_receipt_item_id, 
            material_id, quantity, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.grItemId || null, item.materialId,
            item.quantity, item.unitPrice, item.reason || '', total)
        }
      }
    })

    transaction()

    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(id)
    const retItems = db.prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...ret, items: retItems } })
  } catch (error) {
    console.error('Create purchase return error:', error)
    res.status(500).json({ success: false, message: 'Failed to create purchase return' })
  }
})

// PUT update return status (DRAFT→SUBMITTED, SUBMITTED→APPROVED)
router.put('/returns/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const allowed = ['SUBMITTED', 'APPROVED', 'CANCELLED']
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) return res.status(404).json({ success: false, message: 'Not found' })
    if (ret.status === 'CONFIRMED') return res.status(400).json({ success: false, message: 'Already confirmed' })

    db.prepare('UPDATE purchase_returns SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), req.params.id)

    res.json({ success: true, data: { id: req.params.id, status } })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update return status' })
  }
})

// PUT confirm return (deduct stock) — requires APPROVED status
router.put('/returns/:id/confirm', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ret) {
      return res.status(404).json({ success: false, message: 'Purchase return not found' })
    }

    if (ret.status === 'CONFIRMED') {
      return res.status(400).json({ success: false, message: 'Purchase return already confirmed' })
    }
    if (ret.status !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'ต้องอนุมัติใบคืนสินค้าก่อนยืนยัน' })
    }

    const items = db.prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?').all(req.params.id) as any[]
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // Update return status
      db.prepare("UPDATE purchase_returns SET status = 'CONFIRMED', updated_at = ? WHERE id = ?")
        .run(now, req.params.id)

      // Deduct stock
      for (const item of items) {
        if (item.material_id && item.quantity > 0) {
          const stockItem = db.prepare('SELECT * FROM stock_items WHERE material_id = ? AND tenant_id = ?').get(item.material_id, tenantId) as any
          
          if (stockItem) {
            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
              .run(Math.floor(item.quantity), now, stockItem.id)

            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, Math.floor(item.quantity), `PRT: ${ret.pr_number}`, 
              `Returned to supplier: ${ret.reason}`, now, req.user!.userId)
          }
        }
      }
    })

    transaction()

    const updated = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updated, message: 'Purchase return confirmed and stock deducted' })
  } catch (error) {
    console.error('Confirm purchase return error:', error)
    res.status(500).json({ success: false, message: 'Failed to confirm purchase return' })
  }
})

// ============================================
// PURCHASE SUMMARY / STATS
// ============================================

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // PR Stats
    const prStats = db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_requests,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_requests,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved_requests,
        COALESCE(SUM(total_amount), 0) as total_request_amount
      FROM purchase_requests
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // PO Stats
    const poStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_orders,
        SUM(CASE WHEN status IN ('SUBMITTED', 'APPROVED') THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'RECEIVED' THEN 1 ELSE 0 END) as received_orders,
        SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_orders,
        COALESCE(SUM(total_amount), 0) as total_order_amount
      FROM purchase_orders
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // GR Stats
    const grStats = db.prepare(`
      SELECT COUNT(*) as total_receipts
      FROM goods_receipts
      WHERE tenant_id = ? AND status = 'CONFIRMED'
    `).get(tenantId) as any

    // Invoice Stats
    const invStats = db.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN payment_status = 'UNPAID' THEN 1 ELSE 0 END) as unpaid_invoices,
        SUM(CASE WHEN payment_status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_invoices,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(balance_amount), 0) as outstanding_balance
      FROM purchase_invoices
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Payment Stats
    const paymentStats = db.prepare(`
      SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(amount), 0) as total_paid,
        COALESCE(SUM(withholding_tax), 0) as total_wht
      FROM supplier_payments
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Return Stats
    const returnStats = db.prepare(`
      SELECT COUNT(*) as total_returns, COALESCE(SUM(total_amount), 0) as total_return_amount
      FROM purchase_returns
      WHERE tenant_id = ? AND status = 'CONFIRMED'
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        purchaseRequests: {
          total: prStats.total_requests,
          draft: prStats.draft_requests,
          pending: prStats.pending_requests,
          approved: prStats.approved_requests,
          totalAmount: prStats.total_request_amount
        },
        purchaseOrders: {
          total: poStats.total_orders,
          draft: poStats.draft_orders,
          pending: poStats.pending_orders,
          received: poStats.received_orders,
          partial: poStats.partial_orders,
          totalAmount: poStats.total_order_amount
        },
        goodsReceipts: {
          confirmed: grStats.total_receipts
        },
        invoices: {
          total: invStats.total_invoices,
          unpaid: invStats.unpaid_invoices,
          partial: invStats.partial_invoices,
          paid: invStats.paid_invoices,
          totalInvoiced: invStats.total_invoiced,
          outstanding: invStats.outstanding_balance
        },
        payments: {
          total: paymentStats.total_payments,
          totalPaid: paymentStats.total_paid,
          totalWHT: paymentStats.total_wht
        },
        returns: {
          total: returnStats.total_returns,
          totalAmount: returnStats.total_return_amount
        }
      }
    })
  } catch (error) {
    console.error('Get purchase summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch summary' })
  }
})

export default router
