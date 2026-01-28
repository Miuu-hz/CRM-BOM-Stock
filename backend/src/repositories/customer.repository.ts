import db, { generateId, snakeToCamel } from '../db/database'

export const getAllCustomers = () => {
  const customers = db.prepare(`
    SELECT c.*,
      COUNT(o.id) as total_orders,
      COALESCE(SUM(o.total_amount), 0) as total_revenue
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all()
  return snakeToCamel(customers)
}

export const getCustomerById = (id: string) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
  return snakeToCamel(customer)
}

export const getCustomerWithOrders = (id: string) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
  if (!customer) return null

  const orders = db.prepare(`
    SELECT * FROM orders WHERE customer_id = ? ORDER BY order_date DESC
  `).all(id)

  return {
    ...snakeToCamel(customer),
    orders: snakeToCamel(orders),
  }
}

export const createCustomer = (data: {
  code: string
  name: string
  type: string
  contactName: string
  email: string
  phone: string
  address?: string
  city: string
  creditLimit?: number
  status?: string
}) => {
  const id = generateId()
  const stmt = db.prepare(`
    INSERT INTO customers (id, code, name, type, contact_name, email, phone, address, city, credit_limit, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    data.code,
    data.name,
    data.type,
    data.contactName,
    data.email,
    data.phone,
    data.address || null,
    data.city,
    data.creditLimit || 0,
    data.status || 'ACTIVE'
  )

  return getCustomerById(id)
}

export const updateCustomer = (id: string, data: any) => {
  const existing = getCustomerById(id)
  if (!existing) return null

  const fields = ['code', 'name', 'type', 'contactName', 'email', 'phone', 'address', 'city', 'creditLimit', 'status']
  const updates: string[] = []
  const params: any[] = []

  fields.forEach((field) => {
    if (data[field] !== undefined) {
      const snakeField = field.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
      updates.push(`${snakeField} = ?`)
      params.push(data[field])
    }
  })

  if (updates.length === 0) return existing

  updates.push("updated_at = datetime('now')")
  params.push(id)

  db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getCustomerById(id)
}

export const deleteCustomer = (id: string) => {
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id)
  return result.changes > 0
}

export const countCustomers = (status?: string) => {
  if (status) {
    return db.prepare('SELECT COUNT(*) as count FROM customers WHERE status = ?').get(status).count
  }
  return db.prepare('SELECT COUNT(*) as count FROM customers').get().count
}

export const getCustomerSummary = () => {
  const totalCustomers = countCustomers()
  const activeCustomers = countCustomers('ACTIVE')

  const ordersAgg = db.prepare(`
    SELECT COUNT(id) as count, COALESCE(SUM(total_amount), 0) as total
    FROM orders
  `).get()

  const recentOrders = db.prepare(`
    SELECT o.*, c.name as customer_name, c.contact_name
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    ORDER BY o.order_date DESC
    LIMIT 10
  `).all()

  return {
    totalCustomers,
    activeCustomers,
    totalRevenue: ordersAgg.total,
    totalOrders: ordersAgg.count,
    avgOrderValue: ordersAgg.count > 0 ? ordersAgg.total / ordersAgg.count : 0,
    recentOrders: snakeToCamel(recentOrders),
  }
}
