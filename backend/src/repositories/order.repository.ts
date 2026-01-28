import db, { generateId, snakeToCamel } from '../db/database'

export const getAllOrders = () => {
  const orders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.contact_name, c.code as customer_code
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    ORDER BY o.order_date DESC
  `).all()

  return orders.map((order: any) => {
    const items = getOrderItems(order.id)
    return {
      ...snakeToCamel(order),
      customer: {
        id: order.customer_id,
        name: order.customer_name,
        contactName: order.contact_name,
        code: order.customer_code,
      },
      items,
    }
  })
}

export const getOrderById = (id: string) => {
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.contact_name, c.code as customer_code
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.id = ?
  `).get(id)

  if (!order) return null

  const items = getOrderItems(id)

  return {
    ...snakeToCamel(order),
    customer: {
      id: order.customer_id,
      name: order.customer_name,
      contactName: order.contact_name,
      code: order.customer_code,
    },
    items,
  }
}

export const getOrderItems = (orderId: string) => {
  const items = db.prepare(`
    SELECT oi.*, p.name as product_name, p.code as product_code, p.category as product_category
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId)

  return items.map((item: any) => ({
    ...snakeToCamel(item),
    product: {
      id: item.product_id,
      name: item.product_name,
      code: item.product_code,
      category: item.product_category,
    },
  }))
}

export const getOrdersByCustomerId = (customerId: string) => {
  const orders = db.prepare(`
    SELECT * FROM orders WHERE customer_id = ? ORDER BY order_date DESC
  `).all(customerId)

  return orders.map((order: any) => {
    const items = getOrderItems(order.id)
    return {
      ...snakeToCamel(order),
      items,
    }
  })
}

export const createOrder = (data: {
  orderNumber: string
  customerId: string
  orderDate?: string
  deliveryDate?: string
  totalAmount: number
  status?: string
  notes?: string
  items?: Array<{
    productId: string
    quantity: number
    unitPrice: number
    totalPrice: number
  }>
}) => {
  const id = generateId()

  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, order_date, delivery_date, total_amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.orderNumber,
    data.customerId,
    data.orderDate || new Date().toISOString(),
    data.deliveryDate || null,
    data.totalAmount,
    data.status || 'PENDING',
    data.notes || null
  )

  // Add order items if provided
  if (data.items && data.items.length > 0) {
    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((items: any[]) => {
      for (const item of items) {
        insertItem.run(generateId(), id, item.productId, item.quantity, item.unitPrice, item.totalPrice)
      }
    })

    insertMany(data.items)
  }

  return getOrderById(id)
}

export const updateOrder = (id: string, data: any) => {
  const existing = getOrderById(id)
  if (!existing) return null

  const fieldMap: Record<string, string> = {
    orderNumber: 'order_number',
    customerId: 'customer_id',
    orderDate: 'order_date',
    deliveryDate: 'delivery_date',
    totalAmount: 'total_amount',
    status: 'status',
    notes: 'notes',
  }

  const updates: string[] = []
  const params: any[] = []

  Object.entries(fieldMap).forEach(([camel, snake]) => {
    if (data[camel] !== undefined) {
      updates.push(`${snake} = ?`)
      params.push(data[camel])
    }
  })

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')")
    params.push(id)
    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  // Update items if provided
  if (data.items) {
    // Delete existing items
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)

    // Insert new items
    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((items: any[]) => {
      for (const item of items) {
        insertItem.run(generateId(), id, item.productId, item.quantity, item.unitPrice, item.totalPrice)
      }
    })

    insertMany(data.items)
  }

  return getOrderById(id)
}

export const deleteOrder = (id: string) => {
  // Delete order items first
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)
  // Delete order
  const result = db.prepare('DELETE FROM orders WHERE id = ?').run(id)
  return result.changes > 0
}

export const countOrders = (status?: string) => {
  if (status) {
    return db.prepare('SELECT COUNT(*) as count FROM orders WHERE status = ?').get(status).count
  }
  return db.prepare('SELECT COUNT(*) as count FROM orders').get().count
}

export const getOrdersAggregate = () => {
  const result = db.prepare(`
    SELECT COUNT(id) as count, COALESCE(SUM(total_amount), 0) as total
    FROM orders
  `).get()
  return { count: result.count, total: result.total }
}

export const getRecentOrders = (limit: number = 10) => {
  const orders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.contact_name
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    ORDER BY o.order_date DESC
    LIMIT ?
  `).all(limit)
  return snakeToCamel(orders)
}

export const getProductPopularity = () => {
  const result = db.prepare(`
    SELECT product_id, SUM(quantity) as total_quantity
    FROM order_items
    GROUP BY product_id
  `).all()
  return result.map((r: any) => ({
    productId: r.product_id,
    totalQuantity: r.total_quantity,
  }))
}
