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

// ============================================
// QUOTATIONS
// ============================================

// GET all quotations
router.get('/quotations', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const quotations = db.prepare(`
      SELECT q.*, c.name as customer_name, c.code as customer_code,
        (SELECT COUNT(*) FROM quotation_items WHERE quotation_id = q.id) as item_count
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      WHERE q.tenant_id = ?
      ORDER BY q.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: quotations })
  } catch (error) {
    console.error('Get quotations error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotations' })
  }
})

// GET single quotation
router.get('/quotations/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const quotation = db.prepare(`
      SELECT q.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone
      FROM quotations q
      LEFT JOIN customers c ON q.customer_id = c.id
      WHERE q.id = ? AND q.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }

    const items = db.prepare(`
      SELECT qi.*, p.name as product_name, p.code as product_code
      FROM quotation_items qi
      LEFT JOIN products p ON qi.product_id = p.id
      WHERE qi.quotation_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...quotation, items } })
  } catch (error) {
    console.error('Get quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation' })
  }
})

// POST create quotation
router.post('/quotations', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, expiryDate, notes, items, taxRate, discountAmount, templateId } = req.body
    
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    const id = generateId()
    const quotationNumber = generateNumber('QT', tenantId, 'quotations')
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
        INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, quotationNumber, customerId, now, expiryDate || null,
        subtotal, discount, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO quotation_items (id, tenant_id, quotation_id, product_id, quantity, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          insertItem.run(generateId(), tenantId, id, item.productId, item.quantity,
            item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }
    })

    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Create quotation error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation' })
  }
})

// PUT update quotation status
router.put('/quotations/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM quotations WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Quotation not found' })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE quotations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: quotation })
  } catch (error) {
    console.error('Update quotation status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// SALES ORDERS
// ============================================

// GET all sales orders
router.get('/sales-orders', async (req: Request, res: Response) => {
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
router.get('/sales-orders/:id', async (req: Request, res: Response) => {
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
      SELECT soi.*, p.name as product_name, p.code as product_code
      FROM sales_order_items soi
      LEFT JOIN products p ON soi.product_id = p.id
      WHERE soi.sales_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...salesOrder, items } })
  } catch (error) {
    console.error('Get sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch sales order' })
  }
})

// POST create sales order from quotation
router.post('/sales-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { quotationId, customerId, deliveryDate, notes, items, taxRate, discountAmount } = req.body
    
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    const id = generateId()
    const soNumber = generateNumber('SO', tenantId, 'sales_orders')
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
          INSERT INTO sales_order_items (id, tenant_id, sales_order_id, product_id, quotation_item_id, quantity, unit_price, discount_percent, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const itemTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100)
          insertItem.run(generateId(), tenantId, id, item.productId, item.quotationItemId || null,
            item.quantity, item.unitPrice, item.discountPercent || 0, itemTotal, item.notes || '')
        }
      }

      // Update quotation status if created from quotation
      if (quotationId) {
        db.prepare("UPDATE quotations SET status = 'ACCEPTED', updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(now, quotationId, tenantId)
      }
    })

    transaction()

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)
    const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...salesOrder, items: salesOrderItems } })
  } catch (error) {
    console.error('Create sales order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create sales order' })
  }
})

// PUT update sales order status
router.put('/sales-orders/:id/status', async (req: Request, res: Response) => {
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

    const now = new Date().toISOString()
    db.prepare("UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const salesOrder = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: salesOrder })
  } catch (error) {
    console.error('Update sales order status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// DELIVERY ORDERS (with Partial Delivery Support)
// ============================================

// GET all delivery orders
router.get('/delivery-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const deliveryOrders = db.prepare(`
      SELECT do.*, c.name as customer_name, c.code as customer_code,
        so.so_number, so.total_amount
      FROM delivery_orders do
      LEFT JOIN customers c ON do.customer_id = c.id
      LEFT JOIN sales_orders so ON do.sales_order_id = so.id
      WHERE do.tenant_id = ?
      ORDER BY do.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: deliveryOrders })
  } catch (error) {
    console.error('Get delivery orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch delivery orders' })
  }
})

// GET single delivery order
router.get('/delivery-orders/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const deliveryOrder = db.prepare(`
      SELECT do.*, c.name as customer_name, c.code as customer_code,
        so.so_number, so.total_amount
      FROM delivery_orders do
      LEFT JOIN customers c ON do.customer_id = c.id
      LEFT JOIN sales_orders so ON do.sales_order_id = so.id
      WHERE do.id = ? AND do.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!deliveryOrder) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }

    const items = db.prepare(`
      SELECT doi.*, p.name as product_name, p.code as product_code, soi.quantity as ordered_qty
      FROM delivery_order_items doi
      LEFT JOIN sales_order_items soi ON doi.sales_order_item_id = soi.id
      LEFT JOIN products p ON doi.product_id = p.id
      WHERE doi.delivery_order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...deliveryOrder, items } })
  } catch (error) {
    console.error('Get delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch delivery order' })
  }
})

// POST create delivery order (with partial delivery support)
router.post('/delivery-orders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, deliveryDate, deliveryAddress, driverName, vehiclePlate, notes, items, isPartial } = req.body
    
    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // Get customer from sales order
    const salesOrder = db.prepare('SELECT customer_id FROM sales_orders WHERE id = ? AND tenant_id = ?').get(salesOrderId, tenantId) as any
    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const id = generateId()
    const doNumber = generateNumber('DO', tenantId, 'delivery_orders')
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO delivery_orders (id, tenant_id, do_number, sales_order_id, customer_id, delivery_date, delivery_address,
          driver_name, vehicle_plate, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, doNumber, salesOrderId, salesOrder.customer_id, deliveryDate || now, 
        deliveryAddress || '', driverName || '', vehiclePlate || '', notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO delivery_order_items (id, tenant_id, delivery_order_id, sales_order_item_id, product_id, quantity, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(generateId(), tenantId, id, item.salesOrderItemId, item.productId, item.quantity, item.notes || '')
        }
      }

      // If partial delivery, update SO status to PARTIAL
      if (isPartial) {
        db.prepare("UPDATE sales_orders SET status = 'PARTIAL', updated_at = ? WHERE id = ?")
          .run(now, salesOrderId)
      }
    })

    transaction()

    const deliveryOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id)
    const deliveryOrderItems = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...deliveryOrder, items: deliveryOrderItems } })
  } catch (error) {
    console.error('Create delivery order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create delivery order' })
  }
})

// PUT update delivery order status (and auto update stock)
router.put('/delivery-orders/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const deliveryOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!deliveryOrder) {
      return res.status(404).json({ success: false, message: 'Delivery order not found' })
    }

    const now = new Date().toISOString()

    // When delivered, deduct stock
    if (status === 'DELIVERED' && deliveryOrder.status !== 'DELIVERED') {
      const items = db.prepare('SELECT * FROM delivery_order_items WHERE delivery_order_id = ?').all(req.params.id) as any[]

      const transaction = db.transaction(() => {
        db.prepare("UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
          .run(status, now, req.params.id, tenantId)

        // Update sales order delivered quantity
        for (const item of items) {
          db.prepare('UPDATE sales_order_items SET delivered_qty = delivered_qty + ? WHERE id = ?')
            .run(item.quantity, item.sales_order_item_id)

          // Deduct stock
          const stockItem = db.prepare('SELECT * FROM stock_items WHERE product_id = ? AND tenant_id = ?').get(item.product_id, tenantId) as any
          if (stockItem) {
            db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
              .run(Math.floor(item.quantity), now, stockItem.id)

            // Record stock movement
            db.prepare(`
              INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
              VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?)
            `).run(generateId(), tenantId, stockItem.id, Math.floor(item.quantity), `DO: ${deliveryOrder.do_number}`, 
              `Delivered to customer`, now, req.user!.userId)
          }
        }

        // Check if all items delivered and update sales order status
        const salesOrderItems = db.prepare('SELECT * FROM sales_order_items WHERE sales_order_id = ?').all(deliveryOrder.sales_order_id) as any[]
        const allDelivered = salesOrderItems.every((item: any) => item.delivered_qty >= item.quantity)
        if (allDelivered) {
          db.prepare("UPDATE sales_orders SET status = 'DELIVERED', updated_at = ? WHERE id = ?")
            .run(now, deliveryOrder.sales_order_id)
        }
      })

      transaction()
    } else {
      db.prepare("UPDATE delivery_orders SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(status, now, req.params.id, tenantId)
    }

    const updatedDO = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updatedDO })
  } catch (error) {
    console.error('Update delivery order status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// BACKORDERS (Partial Delivery)
// ============================================

// GET all backorders
router.get('/backorders', async (req: Request, res: Response) => {
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
router.post('/backorders', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, originalDoId, customerId, notes, items } = req.body
    
    if (!salesOrderId || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Sales order and items are required' })
    }

    const id = generateId()
    const boNumber = generateNumber('BO', tenantId, 'backorders')
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

    const backorder = db.prepare('SELECT * FROM backorders WHERE id = ?').get(id)
    const backorderItems = db.prepare('SELECT * FROM backorder_items WHERE backorder_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...backorder, items: backorderItems } })
  } catch (error) {
    console.error('Create backorder error:', error)
    res.status(500).json({ success: false, message: 'Failed to create backorder' })
  }
})

// GET pending items for backorder
router.get('/backorders/pending-items/:salesOrderId', async (req: Request, res: Response) => {
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

// ============================================
// INVOICES
// ============================================

// GET all invoices
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoices = db.prepare(`
      SELECT i.*, c.name as customer_name, c.code as customer_code,
        so.so_number
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id
      WHERE i.tenant_id = ?
      ORDER BY i.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: invoices })
  } catch (error) {
    console.error('Get invoices error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoices' })
  }
})

// GET single invoice
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const invoice = db.prepare(`
      SELECT i.*, c.name as customer_name, c.code as customer_code, c.email as customer_email, c.phone as customer_phone,
        c.address as customer_address, so.so_number
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN sales_orders so ON i.sales_order_id = so.id
      WHERE i.id = ? AND i.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    const items = db.prepare(`
      SELECT ii.*, p.name as product_name, p.code as product_code
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
      WHERE ii.invoice_id = ?
    `).all(req.params.id)

    const receipts = db.prepare(`
      SELECT r.* FROM receipts r WHERE r.invoice_id = ? ORDER BY r.created_at DESC
    `).all(req.params.id)

    const withholdingTax = db.prepare(`
      SELECT * FROM withholding_tax WHERE invoice_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...invoice, items, receipts, withholdingTax } })
  } catch (error) {
    console.error('Get invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' })
  }
})

// POST create invoice from sales order
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { salesOrderId, dueDate, notes, items: customItems } = req.body
    
    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales order is required' })
    }

    // Get sales order details
    const salesOrder = db.prepare(`
      SELECT so.*, c.id as customer_id
      FROM sales_orders so
      JOIN customers c ON so.customer_id = c.id
      WHERE so.id = ? AND so.tenant_id = ?
    `).get(salesOrderId, tenantId) as any

    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales order not found' })
    }

    const id = generateId()
    const invoiceNumber = generateNumber('INV', tenantId, 'invoices')
    const now = new Date().toISOString()

    // Get sales order items for invoice items
    const salesOrderItems = db.prepare(`
      SELECT * FROM sales_order_items WHERE sales_order_id = ?
    `).all(salesOrderId) as any[]

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO invoices (id, tenant_id, invoice_number, sales_order_id, customer_id, invoice_date, due_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, balance_amount, status, payment_status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'UNPAID', ?, ?, ?)
      `).run(id, tenantId, invoiceNumber, salesOrderId, salesOrder.customer_id, now, dueDate || null,
        salesOrder.subtotal, salesOrder.discount_amount, salesOrder.tax_rate, salesOrder.tax_amount,
        salesOrder.total_amount, salesOrder.total_amount, notes || '', now, now)

      // Create invoice items from sales order items
      const insertItem = db.prepare(`
        INSERT INTO invoice_items (id, tenant_id, invoice_id, sales_order_item_id, product_id, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of salesOrderItems) {
        insertItem.run(generateId(), tenantId, id, item.id, item.product_id, item.quantity, item.unit_price, item.total_price)
      }
    })

    transaction()

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
    const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...invoice, items: invoiceItems } })
  } catch (error) {
    console.error('Create invoice error:', error)
    res.status(500).json({ success: false, message: 'Failed to create invoice' })
  }
})

// PUT update invoice status
router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { status } = req.body
    const validStatuses = ['DRAFT', 'ISSUED', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED']
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const existing = db.prepare('SELECT id FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    const now = new Date().toISOString()
    db.prepare("UPDATE invoices SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, req.params.id, tenantId)

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: invoice })
  } catch (error) {
    console.error('Update invoice status error:', error)
    res.status(500).json({ success: false, message: 'Failed to update status' })
  }
})

// ============================================
// WITHHOLDING TAX
// ============================================

// POST add withholding tax to invoice
router.post('/invoices/:id/withholding-tax', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { taxType, taxRate, taxBase, description } = req.body
    
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    const id = generateId()
    const taxAmount = taxBase * (taxRate / 100)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO withholding_tax (id, tenant_id, invoice_id, tax_type, tax_rate, tax_base, tax_amount, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, req.params.id, taxType, taxRate, taxBase, taxAmount, description || '', now)

    // Update invoice net amount (deduct withholding tax)
    const whtTotal = (db.prepare('SELECT COALESCE(SUM(tax_amount), 0) as total FROM withholding_tax WHERE invoice_id = ?').get(req.params.id) as any).total
    const netAmount = invoice.total_amount - whtTotal

    res.json({ 
      success: true, 
      data: { 
        withholdingTax: { id, taxType, taxRate, taxBase, taxAmount },
        invoiceTotal: invoice.total_amount,
        withholdingTaxTotal: whtTotal,
        netAmount: netAmount
      }
    })
  } catch (error) {
    console.error('Add withholding tax error:', error)
    res.status(500).json({ success: false, message: 'Failed to add withholding tax' })
  }
})

// GET withholding tax for invoice
router.get('/invoices/:id/withholding-tax', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const wht = db.prepare(`
      SELECT * FROM withholding_tax WHERE invoice_id = ? AND tenant_id = ?
    `).all(req.params.id, tenantId)

    res.json({ success: true, data: wht })
  } catch (error) {
    console.error('Get withholding tax error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch withholding tax' })
  }
})

// ============================================
// CREDIT NOTES
// ============================================

// GET all credit notes
router.get('/credit-notes', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const creditNotes = db.prepare(`
      SELECT cn.*, c.name as customer_name, c.code as customer_code,
        i.invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      WHERE cn.tenant_id = ?
      ORDER BY cn.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: creditNotes })
  } catch (error) {
    console.error('Get credit notes error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit notes' })
  }
})

// GET single credit note
router.get('/credit-notes/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const creditNote = db.prepare(`
      SELECT cn.*, c.name as customer_name, c.code as customer_code,
        i.invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      WHERE cn.id = ? AND cn.tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' })
    }

    const items = db.prepare(`
      SELECT cni.*, p.name as product_name, p.code as product_code
      FROM credit_note_items cni
      LEFT JOIN products p ON cni.product_id = p.id
      WHERE cni.credit_note_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...creditNote, items } })
  } catch (error) {
    console.error('Get credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch credit note' })
  }
})

// POST create credit note
router.post('/credit-notes', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, customerId, reason, notes, items, taxRate } = req.body
    
    if (!invoiceId || !reason) {
      return res.status(400).json({ success: false, message: 'Invoice and reason are required' })
    }

    const id = generateId()
    const cnNumber = generateNumber('CN', tenantId, 'credit_notes')
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }
    const tax = taxRate || 7
    const taxAmount = subtotal * (tax / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO credit_notes (id, tenant_id, cn_number, invoice_id, customer_id, credit_date, reason,
          subtotal, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, cnNumber, invoiceId, customerId, now, reason,
        subtotal, tax, taxAmount, totalAmount, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO credit_note_items (id, tenant_id, credit_note_id, invoice_item_id, product_id, quantity, unit_price, reason, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          insertItem.run(generateId(), tenantId, id, item.invoiceItemId, item.productId,
            item.quantity, item.unitPrice, item.reason || '', total)
        }
      }

      // Update invoice balance if credit note issued
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any
      if (invoice) {
        const newBalance = Math.max(0, invoice.balance_amount - totalAmount)
        db.prepare('UPDATE invoices SET balance_amount = ?, updated_at = ? WHERE id = ?')
          .run(newBalance, now, invoiceId)
      }
    })

    transaction()

    const creditNote = db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(id)
    const creditNoteItems = db.prepare('SELECT * FROM credit_note_items WHERE credit_note_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...creditNote, items: creditNoteItems } })
  } catch (error) {
    console.error('Create credit note error:', error)
    res.status(500).json({ success: false, message: 'Failed to create credit note' })
  }
})

// ============================================
// RECEIPTS / PAYMENTS
// ============================================

// POST create receipt (payment)
router.post('/receipts', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { invoiceId, receiptDate, paymentMethod, paymentReference, amount, notes } = req.body
    
    if (!invoiceId || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invoice and valid amount are required' })
    }

    // Get invoice details
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, tenantId) as any
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' })
    }

    if (amount > invoice.balance_amount) {
      return res.status(400).json({ success: false, message: 'Payment amount exceeds balance' })
    }

    const id = generateId()
    const receiptNumber = generateNumber('RC', tenantId, 'receipts')
    const now = new Date().toISOString()
    const date = receiptDate || now

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO receipts (id, tenant_id, receipt_number, invoice_id, customer_id, receipt_date, payment_method,
          payment_reference, amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, receiptNumber, invoiceId, invoice.customer_id, date, paymentMethod || 'CASH',
        paymentReference || '', amount, notes || '', now, now)

      // Update invoice paid and balance
      const newPaid = invoice.paid_amount + amount
      const newBalance = invoice.total_amount - newPaid
      let paymentStatus = 'PARTIAL'
      let invoiceStatus = 'PARTIAL'
      
      if (newBalance <= 0) {
        paymentStatus = 'PAID'
        invoiceStatus = 'PAID'
      }

      db.prepare(`
        UPDATE invoices SET paid_amount = ?, balance_amount = ?, payment_status = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(newPaid, newBalance, paymentStatus, invoiceStatus, now, invoiceId)

      // Update sales order payment status
      db.prepare("UPDATE sales_orders SET payment_status = ?, updated_at = ? WHERE id = ?")
        .run(paymentStatus, now, invoice.sales_order_id)
    })

    transaction()

    const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id)
    const updatedInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)

    res.status(201).json({ 
      success: true, 
      data: { receipt, invoice: updatedInvoice },
      message: 'Payment recorded successfully'
    })
  } catch (error) {
    console.error('Create receipt error:', error)
    res.status(500).json({ success: false, message: 'Failed to record payment' })
  }
})

// ============================================
// PRODUCT VARIANTS
// ============================================

// GET all product variants
router.get('/product-variants', async (req: Request, res: Response) => {
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
router.get('/product-variants/product/:productId', async (req: Request, res: Response) => {
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
router.post('/product-variants', async (req: Request, res: Response) => {
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

    const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: variant })
  } catch (error) {
    console.error('Create product variant error:', error)
    res.status(500).json({ success: false, message: 'Failed to create product variant' })
  }
})

// ============================================
// QUOTATION TEMPLATES
// ============================================

// GET all quotation templates
router.get('/quotation-templates', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const templates = db.prepare(`
      SELECT qt.*, 
        (SELECT COUNT(*) FROM quotation_template_items WHERE template_id = qt.id) as item_count
      FROM quotation_templates qt
      WHERE qt.tenant_id = ?
      ORDER BY qt.is_default DESC, qt.name ASC
    `).all(tenantId)

    res.json({ success: true, data: templates })
  } catch (error) {
    console.error('Get quotation templates error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation templates' })
  }
})

// GET single quotation template
router.get('/quotation-templates/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const template = db.prepare(`
      SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const items = db.prepare(`
      SELECT qti.*, p.name as product_name, p.code as product_code
      FROM quotation_template_items qti
      LEFT JOIN products p ON qti.product_id = p.id
      WHERE qti.template_id = ?
      ORDER BY qti.sort_order ASC
    `).all(req.params.id)

    res.json({ success: true, data: { ...template, items } })
  } catch (error) {
    console.error('Get quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch quotation template' })
  }
})

// POST create quotation template
router.post('/quotation-templates', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, description, expirationDays, headerText, footerText, termsConditions, isDefault, items } = req.body
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Template name is required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // If setting as default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE quotation_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`
        INSERT INTO quotation_templates (id, tenant_id, name, description, expiration_days, header_text, footer_text, terms_conditions, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tenantId, name, description || '', expirationDays || 30, headerText || '', footerText || '', termsConditions || '', isDefault ? 1 : 0, now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO quotation_template_items (id, tenant_id, template_id, product_id, quantity, unit_price, discount_percent, sort_order, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        items.forEach((item: any, index: number) => {
          insertItem.run(generateId(), tenantId, id, item.productId, item.quantity || 1,
            item.unitPrice || 0, item.discountPercent || 0, index, item.notes || '')
        })
      }
    })

    transaction()

    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: template })
  } catch (error) {
    console.error('Create quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation template' })
  }
})

// PUT update quotation template
router.put('/quotation-templates/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { name, description, expirationDays, headerText, footerText, termsConditions, isDefault } = req.body
    
    const existing = db.prepare('SELECT id FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE quotation_templates SET is_default = 0 WHERE tenant_id = ?').run(tenantId)
      }

      db.prepare(`
        UPDATE quotation_templates SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          expiration_days = COALESCE(?, expiration_days),
          header_text = COALESCE(?, header_text),
          footer_text = COALESCE(?, footer_text),
          terms_conditions = COALESCE(?, terms_conditions),
          is_default = COALESCE(?, is_default),
          updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(name, description, expirationDays, headerText, footerText, termsConditions, isDefault !== undefined ? (isDefault ? 1 : 0) : undefined, now, req.params.id, tenantId)
    })

    transaction()

    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: template })
  } catch (error) {
    console.error('Update quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to update quotation template' })
  }
})

// DELETE quotation template
router.delete('/quotation-templates/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const existing = db.prepare('SELECT id FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    db.prepare('DELETE FROM quotation_templates WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)

    res.json({ success: true, message: 'Template deleted' })
  } catch (error) {
    console.error('Delete quotation template error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete template' })
  }
})

// POST create quotation from template
router.post('/quotations/from-template', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { templateId, customerId, expiryDate, notes } = req.body
    
    if (!templateId || !customerId) {
      return res.status(400).json({ success: false, message: 'Template and customer are required' })
    }

    // Get template
    const template = db.prepare('SELECT * FROM quotation_templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId) as any
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' })
    }

    // Get template items
    const templateItems = db.prepare('SELECT * FROM quotation_template_items WHERE template_id = ?').all(templateId) as any[]

    const id = generateId()
    const quotationNumber = generateNumber('QT', tenantId, 'quotations')
    const now = new Date().toISOString()
    const expiry = expiryDate || new Date(Date.now() + (template.expiration_days * 24 * 60 * 60 * 1000)).toISOString()

    // Calculate totals
    let subtotal = 0
    for (const item of templateItems) {
      const itemTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100)
      subtotal += itemTotal
    }
    const taxRate = 7
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + taxAmount

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO quotations (id, tenant_id, quotation_number, customer_id, quotation_date, expiry_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
      `).run(id, tenantId, quotationNumber, customerId, now, expiry,
        subtotal, 0, taxRate, taxAmount, totalAmount, notes || template.header_text, now, now)

      const insertItem = db.prepare(`
        INSERT INTO quotation_items (id, tenant_id, quotation_id, product_id, quantity, unit_price, discount_percent, total_price, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of templateItems) {
        const itemTotal = item.quantity * item.unit_price * (1 - (item.discount_percent || 0) / 100)
        insertItem.run(generateId(), tenantId, id, item.product_id, item.quantity,
          item.unit_price, item.discount_percent || 0, itemTotal, item.notes || '')
      }
    })

    transaction()

    const quotation = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id)
    const quotationItems = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...quotation, items: quotationItems } })
  } catch (error) {
    console.error('Create quotation from template error:', error)
    res.status(500).json({ success: false, message: 'Failed to create quotation from template' })
  }
})

// ============================================
// SALES SUMMARY / STATS
// ============================================

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Sales order stats
    const soStats = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft_orders,
        SUM(CASE WHEN status IN ('CONFIRMED', 'PROCESSING', 'READY') THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_orders,
        SUM(CASE WHEN status IN ('DELIVERED', 'COMPLETED') THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(total_amount), 0) as total_sales
      FROM sales_orders
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Invoice stats
    const invStats = db.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN payment_status = 'UNPAID' THEN 1 ELSE 0 END) as unpaid_invoices,
        SUM(CASE WHEN payment_status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_invoices,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) as paid_invoices,
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(balance_amount), 0) as outstanding_balance
      FROM invoices
      WHERE tenant_id = ?
    `).get(tenantId) as any

    // Today's receipts
    const todayReceipts = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as today_received
      FROM receipts
      WHERE tenant_id = ? AND DATE(receipt_date) = DATE('now')
    `).get(tenantId) as any

    // Credit notes
    const cnStats = db.prepare(`
      SELECT COUNT(*) as total_cn, COALESCE(SUM(total_amount), 0) as total_cn_amount
      FROM credit_notes
      WHERE tenant_id = ? AND status != 'CANCELLED'
    `).get(tenantId) as any

    // Backorders
    const boStats = db.prepare(`
      SELECT COUNT(*) as pending_backorders
      FROM backorders
      WHERE tenant_id = ? AND status = 'PENDING'
    `).get(tenantId) as any

    res.json({
      success: true,
      data: {
        salesOrders: {
          total: soStats.total_orders,
          draft: soStats.draft_orders,
          processing: soStats.processing_orders,
          partial: soStats.partial_orders,
          completed: soStats.completed_orders,
          totalSales: soStats.total_sales
        },
        invoices: {
          total: invStats.total_invoices,
          unpaid: invStats.unpaid_invoices,
          partial: invStats.partial_invoices,
          paid: invStats.paid_invoices,
          totalInvoiced: invStats.total_invoiced,
          outstanding: invStats.outstanding_balance
        },
        receipts: {
          todayReceived: todayReceipts.today_received
        },
        creditNotes: {
          total: cnStats.total_cn,
          totalAmount: cnStats.total_cn_amount
        },
        backorders: {
          pending: boStats.pending_backorders
        }
      }
    })
  } catch (error) {
    console.error('Get sales summary error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch summary' })
  }
})

export default router
