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

function generateOrderNumber() {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `ORD-${dateStr}-${random}`
}

// Get all orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const orders = db.prepare(`
      SELECT o.*, c.name as customer_name, c.code as customer_code
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE c.tenant_id = ?
      ORDER BY o.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: orders })
  } catch (error) {
    console.error('Get orders error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch orders' })
  }
})

// Get order by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const order = db.prepare(`
      SELECT o.*, c.name as customer_name, c.code as customer_code
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.id = ? AND c.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }

    // Get order items
    const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.code as product_code
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(req.params.id)

    res.json({ success: true, data: { ...order, items } })
  } catch (error) {
    console.error('Get order error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch order' })
  }
})

// Create order
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, orderDate, deliveryDate, items, notes } = req.body

    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer is required' })
    }

    // Verify customer belongs to tenant
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId)
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' })
    }

    const id = generateId()
    const orderNumber = generateOrderNumber()
    const now = new Date().toISOString()

    // Calculate totals
    let subtotal = 0
    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    }

    const insertOrder = db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (id, tenant_id, customer_id, order_number, order_date, delivery_date, 
          status, subtotal, total_amount, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)
      `).run(id, tenantId, customerId, orderNumber, orderDate || now, deliveryDate || null, 
        subtotal, subtotal, notes || '', now, now)

      if (items && items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const item of items) {
          insertItem.run(generateId(), tenantId, id, item.productId, item.quantity, 
            item.unitPrice, item.quantity * item.unitPrice)
        }
      }
    })

    insertOrder()

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id)
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id)

    res.status(201).json({ success: true, data: { ...order, items: orderItems } })
  } catch (error) {
    console.error('Create order error:', error)
    res.status(500).json({ success: false, message: 'Failed to create order' })
  }
})

// Update order
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { customerId, orderDate, deliveryDate, status, items, notes } = req.body

    // Check if order exists and belongs to tenant
    const existing = db.prepare(`
      SELECT o.id FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.id = ? AND c.tenant_id = ?
    `).get(req.params.id, tenantId)
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }

    const now = new Date().toISOString()

    const updateOrder = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET
          customer_id = COALESCE(?, customer_id),
          order_date = COALESCE(?, order_date),
          delivery_date = ?,
          status = COALESCE(?, status),
          notes = COALESCE(?, notes),
          updated_at = ?
        WHERE id = ?
      `).run(customerId, orderDate, deliveryDate || null, status, notes, now, req.params.id)

      if (items) {
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id)
        const insertItem = db.prepare(`
          INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, unit_price, total_price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        let subtotal = 0
        for (const item of items) {
          const total = item.quantity * item.unitPrice
          subtotal += total
          insertItem.run(generateId(), tenantId, req.params.id, item.productId, 
            item.quantity, item.unitPrice, total)
        }
        db.prepare('UPDATE orders SET subtotal = ?, total_amount = ? WHERE id = ?')
          .run(subtotal, subtotal, req.params.id)
      }
    })

    updateOrder()

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id)

    res.json({ success: true, data: { ...order, items: orderItems } })
  } catch (error) {
    console.error('Update order error:', error)
    res.status(500).json({ success: false, message: 'Failed to update order' })
  }
})

// Delete order
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    // Check if order exists and belongs to tenant
    const existing = db.prepare(`
      SELECT o.id FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.id = ? AND c.tenant_id = ?
    `).get(req.params.id, tenantId)
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }

    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id)
    db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id)

    res.json({ success: true, message: 'Order deleted' })
  } catch (error) {
    console.error('Delete order error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete order' })
  }
})

export default router
