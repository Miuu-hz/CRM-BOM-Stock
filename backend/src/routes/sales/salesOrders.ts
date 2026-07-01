import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { convertQuantityBidirectional } from '../../services/unitConversion.service'
import { deductStockForSO } from './shared'

const router = Router()

// GET all sales orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const salesOrders = db.prepare(`
      SELECT so.*, c.name as customer_name, c.code as customer_code,
        q.quotation_number,
        (SELECT COUNT(*) FROM sales_order_items WHERE sales_order_id = so.id) as item_count,
        (SELECT SUM(quantity - delivered_qty) FROM sales_order_items WHERE sales_order_id = so.id AND quantity > delivered_qty) as pending_qty
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN quotations q ON so.quotation_id = q.id
      WHERE so.tenant_id = ?
      ORDER BY so.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: salesOrders })
  } catch (error) {
    console.error('Get sales orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch sales orders' })
  }
})

// GET single sales order
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const salesOrder = db.prepare(`
      SELECT so.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone,
        q.quotation_number
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN quotations q ON so.quotation_id = q.id
      WHERE so.id = ? AND so.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const items = db.prepare(`
      SELECT soi.*,
        COALESCE(soi.product_name, si.name) as product_name,
        COALESCE(si.sku, si.name) as product_code,
        si.quantity as stock_qty
      FROM sales_order_items soi
      LEFT JOIN stock_items si ON soi.stock_item_id = si.id
      WHERE soi.sales_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...salesOrder, items } })
  } catch (error) {
    console.error('Get sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch sales order' })
  }
})

// POST create sales order from quotation
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { quotationId, customerId, deliveryDate, notes, items, taxRate, discountAmount } = req.body
    
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    const id = generateId()
    const soNumber = formatDocumentNumber('SO', tenantId, 'SALES_ORDER', new Date().getFullYear(), 5)
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => {
        const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
        return sum + itemTotal
      }, 0)
    }
    const discount = discountAmount || 0
    const tax = taxRate || 0
    const afterDiscount = subtotal - discount
    const taxAmount = afterDiscount * (tax / 100)
    const totalAmount = afterDiscount + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, order_date, delivery_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, payment_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?)
      `).run(id, tenantId, soNumber, quotationId || null, customerId, now, deliveryDate || null,
        subtotal, discount, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quotation_item_id, quantity, unit, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          insertItem.run(generateId(), tenantId, id,
            item.productId || null, null, item.productName || null,
            item.quotationItemId || null,
            item.quantity, item.unit || '', item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }

      // Update quotation status if created from quotation
      if (quotationId) {
        db.prepare("UPDATE quotations SET status = 'ACCEPTED', updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(now, quotationId, tenantId)
      }
    })

    transaction()

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...salesOrder, items: salesOrderItems } })
  } catch (error) {
    console.error('Create sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create sales order' })
  }
})

// PUT update sales order content (DRAFT only)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, deliveryDate, notes, items, taxRate, discountAmount } = req.body
    const now = new Date().toISOString()

    const existing = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) return res.status(404).json({ success: false, message: 'Sales order not found' })
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ success: false, message: `ไม่สามารถแก้ไขได้ — สถานะ ${existing.status} (ต้องเป็น DRAFT เท่านั้น)` })
    }

    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => {
        return sum + item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
      }, 0)
    }
    const discount = discountAmount || 0
    const tax = taxRate ?? existing.tax_rate ?? 0
    const afterDiscount = subtotal - discount
    const taxAmount = afterDiscount * (tax / 100)
    const totalAmount = afterDiscount + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE sales_orders
        SET customer_id = COALESCE(?, customer_id), delivery_date = ?,
            subtotal = ?, discount_amount = ?, tax_rate = ?, tax_amount = ?, total_amount = ?,
            notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(customerId || null, deliveryDate || null, subtotal, discount, tax, taxAmount, totalAmount, notes ?? null, now, req.params.id, tenantId)

      if (items) {
        db.prepare('DELETE FROM sales_order_items WHERE sales_order_id = ?').run(req.params.id)
        const ins = db.prepare(`
          INSERT INTO sales_order_items (id, tenant_id, sales_order_id, stock_item_id, product_id, product_name, quantity, unit, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          ins.run(generateId(), tenantId, req.params.id,
            item.productId || null, null, item.productName || null,
            item.quantity, item.unit || '', item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }
    })
    transaction()

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(req.params.id)
    res.json({ success: true, data: { ...salesOrder, items: salesOrderItems } })
  } catch (error) {
    console.error('Update sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to update sales order' })
  }
})

// PUT update sales order status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'CONFIRMED', 'PROCESSING', 'READY', 'DELIVERED', 'PARTIAL', 'COMPLETED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM sales_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    // เช็ค stock ก่อน CONFIRMED
    if (status === 'CONFIRMED') {
      const soItems = db.prepare(`
        SELECT soi.*, si.quantity as stock_qty, si.unit as stock_unit, COALESCE(soi.product_name, si.name) as item_name
        FROM sales_order_items soi
        LEFT JOIN stock_items si ON soi.stock_item_id = si.id
        WHERE soi.sales_order_id = ?
      `).all(req.params.id) as any[]

      const shortItems = soItems.filter(it => {
        if (!it.stock_item_id) return false
        let needQty = Number(it.quantity || 0)
        const soUnit = it.unit || ''
        const stockUnit = it.stock_unit || ''
        if (soUnit && stockUnit && soUnit !== stockUnit) {
          const converted = convertQuantityBidirectional(needQty, soUnit, stockUnit, tenantId, it.stock_item_id)
          if (converted) needQty = converted.converted
        }
        return (it.stock_qty ?? 0) < needQty
      })
      if (shortItems.length > 0) {
        const details = shortItems.map((it: any) => `${it.item_name || 'สินค้า'}: ต้องการ ${it.quantity} ${it.unit || ''} มีในสต็อก ${it.stock_qty ?? 0} ${it.stock_unit || ''}`).join(', ')
        return res.status(400).json({ success: false, message: `สต็อกไม่เพียงพอ: ${details}` })
      }
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any

    // ตัด stock เมื่อยืนยัน SO
    if (status === 'CONFIRMED' && salesOrder) {
      deductStockForSO(tenantId, salesOrder.id, salesOrder.so_number)
    }

    res.json({ success: true, data: salesOrder })
  } catch (error) {
    console.error('Update sales order status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

export default router
